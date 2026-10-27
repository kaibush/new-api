package model

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

// Usage analytics reads settled accounting independently of reward eligibility.
// Neither the selected window nor a cached snapshot changes check-in settings.
type UserActivityAmounts struct {
	ConsumedQuota     int64 `json:"consumed_quota"`
	WalletQuota       int64 `json:"wallet_quota"`
	CheckinQuota      int64 `json:"checkin_quota"`
	SubscriptionQuota int64 `json:"subscription_quota"`
}

type UserActivityRow struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	UserActivityAmounts
	ChargedRecords  int64 `json:"charged_records"`
	ActiveDays      int64 `json:"active_days"`
	LastUsedAt      int64 `json:"last_used_at"`
	PendingRecords  int64 `json:"pending_records"`
	CoverageSince   int64 `json:"coverage_since"`
	HistoryComplete bool  `json:"history_complete"`
}

type UserActivityOverview struct {
	UserActivityAmounts
	TotalUsers      int64             `json:"total_users"`
	ConsumingUsers  int64             `json:"consuming_users"`
	IncompleteUsers int64             `json:"incomplete_users"`
	PendingRecords  int64             `json:"pending_records"`
	WindowStart     int64             `json:"window_start"`
	AsOf            int64             `json:"as_of"`
	Days            []CheckinUsageDay `json:"days"`
}

type UserActivityQuery struct {
	Days     int    `json:"days"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Search   string `json:"search"`
	Filter   string `json:"filter"`
	Sort     string `json:"sort"`
}

type UserActivityPage struct {
	Items       []UserActivityRow `json:"items"`
	Total       int               `json:"total"`
	WindowStart int64             `json:"window_start"`
	AsOf        int64             `json:"as_of"`
}

type UserActivityDetail struct {
	User        UserActivityRow   `json:"user"`
	WindowStart int64             `json:"window_start"`
	AsOf        int64             `json:"as_of"`
	Days        []CheckinUsageDay `json:"days"`
}

type userActivitySnapshot struct {
	Overview UserActivityOverview
	Users    []UserActivityRow
}

type userActivityCacheEntry struct {
	db       *gorm.DB
	builtAt  time.Time
	snapshot *userActivitySnapshot
}

var userActivityCache = struct {
	sync.Mutex
	entries map[int]userActivityCacheEntry
	loads   singleflight.Group
}{entries: make(map[int]userActivityCacheEntry)}

func userActivityWindow(days int, now time.Time) (int64, error) {
	if !slices.Contains([]int{7, 30, 90}, days) {
		return 0, errors.New("Invalid activity window")
	}
	end := now.Unix()
	return end - end%86400 - int64(days-1)*86400, nil
}

func readUserActivityRows(tx *gorm.DB, users []User, start, end, observedSince int64) ([]UserActivityRow, error) {
	rows := make([]UserActivityRow, 0, len(users))
	if len(users) == 0 {
		return rows, nil
	}
	ids := make([]int, len(users))
	for i := range users {
		ids[i] = users[i].Id
	}
	var accounts []CheckinAccount
	if err := tx.Where("user_id IN ?", ids).Find(&accounts).Error; err != nil {
		return nil, err
	}
	coverage := make(map[int]int64, len(accounts))
	for _, account := range accounts {
		coverage[account.UserID] = account.ObservedSince
	}
	var totals []struct {
		UserID int
		UserActivityAmounts
		ChargedRecords int64
		ActiveDays     int64
		LastUsedAt     int64
		PendingRecords int64
	}
	// Zero charges (including full refunds) are not counted as usage. Pending
	// entries are shown separately and never enter consumption or funding totals.
	if err := tx.Model(&CheckinUsage{}).Where("user_id IN ? AND created_at >= ? AND created_at <= ?", ids, start, end).
		Select(`user_id,
		COALESCE(SUM(CASE WHEN pending = ? THEN quota ELSE 0 END), 0) AS consumed_quota,
		COALESCE(SUM(CASE WHEN pending = ? AND wallet = ? THEN quota - gift_used - COALESCE(expiring_used, 0) ELSE 0 END), 0) AS wallet_quota,
		COALESCE(SUM(CASE WHEN pending = ? THEN gift_used + COALESCE(expiring_used, 0) ELSE 0 END), 0) AS checkin_quota,
		COALESCE(SUM(CASE WHEN pending = ? AND wallet = ? THEN quota ELSE 0 END), 0) AS subscription_quota,
		COUNT(CASE WHEN pending = ? AND quota > 0 THEN 1 END) AS charged_records,
		COUNT(DISTINCT CASE WHEN pending = ? AND quota > 0 THEN created_at - (created_at % 86400) END) AS active_days,
		COALESCE(MAX(CASE WHEN pending = ? AND quota > 0 THEN created_at ELSE 0 END), 0) AS last_used_at,
		COUNT(CASE WHEN pending = ? THEN 1 END) AS pending_records`, false, false, true, false, false, false, false, false, false, true).
		Group("user_id").Scan(&totals).Error; err != nil {
		return nil, err
	}
	byUser := make(map[int]UserActivityRow, len(totals))
	for _, total := range totals {
		byUser[total.UserID] = UserActivityRow{UserActivityAmounts: total.UserActivityAmounts, ChargedRecords: total.ChargedRecords, ActiveDays: total.ActiveDays, LastUsedAt: total.LastUsedAt, PendingRecords: total.PendingRecords}
	}
	for _, user := range users {
		row := byUser[user.Id]
		row.ID, row.Username, row.DisplayName = user.Id, user.Username, user.DisplayName
		since := observedSince
		if accountSince := coverage[user.Id]; accountSince > 0 && (since == 0 || accountSince < since) {
			since = accountSince
		}
		row.CoverageSince = max(since, user.CreatedAt)
		row.HistoryComplete = since > 0 && row.CoverageSince <= max(start, user.CreatedAt)
		rows = append(rows, row)
	}
	return rows, nil
}

func readUserActivityDays(tx *gorm.DB, start, end int64, userID int) ([]CheckinUsageDay, error) {
	query := tx.Model(&CheckinUsage{}).Where("pending = ? AND created_at >= ? AND created_at <= ?", false, start, end)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	} else {
		query = query.Where("user_id IN (?)", tx.Model(&User{}).Select("id"))
	}
	var totals []CheckinUsageDay
	const dayExpression = "created_at - (created_at % 86400)"
	if err := query.Select(dayExpression + " AS day, SUM(quota) AS quota").Group(dayExpression).Order("day").Scan(&totals).Error; err != nil {
		return nil, err
	}
	byDay := make(map[int64]int64, len(totals))
	for _, day := range totals {
		byDay[day.Day] = day.Quota
	}
	days := make([]CheckinUsageDay, 0, (end-start)/86400+1)
	for day := start; day <= end; day += 86400 {
		days = append(days, CheckinUsageDay{Day: day, Quota: byDay[day]})
	}
	return days, nil
}

func buildUserActivitySnapshot(tx *gorm.DB, days int, now time.Time) (*userActivitySnapshot, error) {
	start, err := userActivityWindow(days, now)
	if err != nil {
		return nil, err
	}
	var state CheckinPolicyState
	if err := tx.Where("id = ?", 1).Find(&state).Error; err != nil {
		return nil, err
	}
	result := &userActivitySnapshot{Overview: UserActivityOverview{WindowStart: start, AsOf: now.Unix()}, Users: []UserActivityRow{}}
	lastID := 0
	for {
		var users []User
		if err := tx.Select("id", "username", "display_name", "created_at").Where("id > ?", lastID).Order("id").Limit(500).Find(&users).Error; err != nil {
			return nil, err
		}
		if len(users) == 0 {
			break
		}
		rows, err := readUserActivityRows(tx, users, start, now.Unix(), state.ObservedSince)
		if err != nil {
			return nil, err
		}
		result.Users = append(result.Users, rows...)
		lastID = users[len(users)-1].Id
	}
	for _, row := range result.Users {
		result.Overview.TotalUsers++
		if row.ConsumedQuota > 0 {
			result.Overview.ConsumingUsers++
		}
		if !row.HistoryComplete {
			result.Overview.IncompleteUsers++
		}
		result.Overview.ConsumedQuota += row.ConsumedQuota
		result.Overview.WalletQuota += row.WalletQuota
		result.Overview.CheckinQuota += row.CheckinQuota
		result.Overview.SubscriptionQuota += row.SubscriptionQuota
		result.Overview.PendingRecords += row.PendingRecords
	}
	result.Overview.Days, err = readUserActivityDays(tx, start, now.Unix(), 0)
	return result, err
}

func loadUserActivitySnapshot(days int) (*userActivitySnapshot, error) {
	if _, err := userActivityWindow(days, time.Now()); err != nil {
		return nil, err
	}
	db := DB
	value, err, _ := userActivityCache.loads.Do(fmt.Sprintf("%p:%d", db, days), func() (any, error) {
		userActivityCache.Lock()
		cached := userActivityCache.entries[days]
		userActivityCache.Unlock()
		if cached.db == db && time.Since(cached.builtAt) < 30*time.Second {
			return cached.snapshot, nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		var snapshot *userActivitySnapshot
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			snapshot, err = buildUserActivitySnapshot(tx, days, time.Now())
			return err
		})
		if err != nil {
			return nil, err
		}
		userActivityCache.Lock()
		userActivityCache.entries[days] = userActivityCacheEntry{db: db, builtAt: time.Now(), snapshot: snapshot}
		userActivityCache.Unlock()
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*userActivitySnapshot), nil
}

func GetUserActivityOverview(days int) (*UserActivityOverview, error) {
	snapshot, err := loadUserActivitySnapshot(days)
	if err != nil {
		return nil, err
	}
	return &snapshot.Overview, nil
}

func ListUserActivity(query UserActivityQuery) (*UserActivityPage, error) {
	if query.Page < 1 || query.Page > 1000000 || query.PageSize < 1 || query.PageSize > 100 || len(query.Search) > 100 || !slices.Contains([]string{"", "used", "unused", "incomplete"}, query.Filter) || !slices.Contains([]string{"", "spend_desc", "last_used_desc", "id_desc"}, query.Sort) {
		return nil, errors.New("Invalid activity query")
	}
	snapshot, err := loadUserActivitySnapshot(query.Days)
	if err != nil {
		return nil, err
	}
	rows := make([]UserActivityRow, 0, len(snapshot.Users))
	search := strings.ToLower(strings.TrimSpace(query.Search))
	for _, row := range snapshot.Users {
		if search != "" && !strings.Contains(strings.ToLower(row.Username+" "+row.DisplayName), search) {
			continue
		}
		if query.Filter == "used" && row.ConsumedQuota == 0 || query.Filter == "unused" && row.ConsumedQuota > 0 || query.Filter == "incomplete" && row.HistoryComplete {
			continue
		}
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b UserActivityRow) int {
		var n int
		switch query.Sort {
		case "last_used_desc":
			n = cmp.Compare(b.LastUsedAt, a.LastUsedAt)
		case "id_desc":
		default:
			n = cmp.Compare(b.ConsumedQuota, a.ConsumedQuota)
		}
		if n != 0 {
			return n
		}
		return cmp.Compare(b.ID, a.ID)
	})
	offset := (query.Page - 1) * query.PageSize
	return &UserActivityPage{Items: rows[min(offset, len(rows)):min(offset+query.PageSize, len(rows))], Total: len(rows), WindowStart: snapshot.Overview.WindowStart, AsOf: snapshot.Overview.AsOf}, nil
}

func GetUserActivityDetail(userID, days int) (*UserActivityDetail, error) {
	now := time.Now()
	start, err := userActivityWindow(days, now)
	if userID <= 0 || err != nil {
		return nil, errors.New("Invalid activity query")
	}
	result := &UserActivityDetail{WindowStart: start, AsOf: now.Unix()}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Select("id", "username", "display_name", "created_at").First(&user, userID).Error; err != nil {
			return err
		}
		var state CheckinPolicyState
		if err := tx.Where("id = ?", 1).Find(&state).Error; err != nil {
			return err
		}
		rows, err := readUserActivityRows(tx, []User{user}, start, now.Unix(), state.ObservedSince)
		if err != nil {
			return err
		}
		result.User = rows[0]
		result.Days, err = readUserActivityDays(tx, start, now.Unix(), userID)
		return err
	})
	return result, err
}
