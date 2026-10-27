package model

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

type CheckinRewardSnapshot struct {
	Configuration CheckinConfiguration `json:"configuration"`
	Eligibility   CheckinEligibility   `json:"eligibility"`
	BaseQuota     int                  `json:"base_quota"`
}

type CheckinUser struct {
	ID          int                 `json:"id"`
	Username    string              `json:"username"`
	DisplayName string              `json:"display_name"`
	CreatedAt   int64               `json:"created_at"`
	Eligibility *CheckinEligibility `json:"eligibility"`
	Balance     *CheckinUserBalance `json:"balance,omitempty"`
}

type CheckinUserBalance struct {
	CheckinBalances
	ExpiredQuota int64 `json:"expired_quota"`
	NextExpiryAt int64 `json:"next_expiry_at"`
	AsOf         int64 `json:"as_of"`
}

// Balances are read for the displayed page, independently of cached activity
// snapshots and policy previews. Expiry uses one timestamp for the whole page.
func populateCheckinUserBalances(tx *gorm.DB, rows []CheckinUser, asOf int64) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]int, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
	}
	var users []User
	if err := tx.Select("id", "quota").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return err
	}
	balances := make(map[int]*CheckinUserBalance, len(users))
	for _, user := range users {
		quota := user.Quota
		if common.RedisEnabled {
			var err error
			quota, err = GetUserQuota(user.Id, false)
			if err != nil {
				return err
			}
		}
		balances[user.Id] = &CheckinUserBalance{CheckinBalances: CheckinBalances{WalletQuota: quota}, AsOf: asOf}
	}
	var accounts []CheckinAccount
	if err := tx.Where("user_id IN ?", ids).Find(&accounts).Error; err != nil {
		return err
	}
	for _, account := range accounts {
		balance := balances[account.UserID]
		if balance == nil {
			continue
		}
		gift := min(max(account.GiftRemaining, 0), int64(max(balance.WalletQuota, 0)))
		balance.WalletQuota -= int(gift)
		balance.CheckinQuota = gift
	}
	var grants []struct {
		UserID       int
		Available    int64
		ExpiredQuota int64
		NextExpiryAt int64
	}
	if err := tx.Model(&CheckinGrant{}).Where("user_id IN ?", ids).
		Select("user_id, COALESCE(SUM(CASE WHEN expires_at > ? THEN remaining ELSE 0 END), 0) AS available, COALESCE(SUM(CASE WHEN expires_at <= ? THEN remaining ELSE 0 END), 0) AS expired_quota, COALESCE(MIN(CASE WHEN expires_at > ? AND remaining > 0 THEN expires_at END), 0) AS next_expiry_at", asOf, asOf, asOf).
		Group("user_id").Scan(&grants).Error; err != nil {
		return err
	}
	for _, grant := range grants {
		balance := balances[grant.UserID]
		if balance == nil {
			continue
		}
		balance.CheckinQuota += grant.Available
		balance.ExpiredQuota = grant.ExpiredQuota
		balance.NextExpiryAt = grant.NextExpiryAt
	}
	for i := range rows {
		rows[i].Balance = balances[rows[i].ID]
	}
	return nil
}

type CheckinUserQuery struct {
	Page     int                               `json:"page"`
	PageSize int                               `json:"page_size"`
	Search   string                            `json:"search"`
	Filter   string                            `json:"filter"`
	Sort     string                            `json:"sort"`
	Preview  *operation_setting.CheckinSetting `json:"preview"`
}

type CheckinUserPage struct {
	Mode          int           `json:"mode"`
	Items         []CheckinUser `json:"items"`
	Total         int64         `json:"total"`
	Page          int           `json:"page"`
	PageSize      int           `json:"page_size"`
	AsOf          int64         `json:"as_of"`
	ConfigVersion int64         `json:"config_version"`
	Updating      bool          `json:"updating"`
	Preview       bool          `json:"preview"`
}

type CheckinDistribution struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type CheckinOverview struct {
	AsOf          int64                 `json:"as_of"`
	ConfigVersion int64                 `json:"config_version"`
	Updating      bool                  `json:"updating"`
	Total         int64                 `json:"total"`
	Grace         int64                 `json:"grace"`
	Active        int64                 `json:"active"`
	LowActivity   int64                 `json:"low_activity"`
	ZeroActivity  int64                 `json:"zero_activity"`
	Incomplete    int64                 `json:"incomplete"`
	Pending       int64                 `json:"pending"`
	Distribution  []CheckinDistribution `json:"distribution"`
	Days          []CheckinUsageDay     `json:"days"`
}

// Batch facts avoid running the transactional single-user endpoint per row.
// Full UTC buckets come from the summary, with both boundary days read exactly
// from the journal. Pending and month totals use indexed, grouped queries.
func checkinUserRows(tx *gorm.DB, users []User, config CheckinConfiguration, now time.Time) ([]CheckinUser, error) {
	rows := make([]CheckinUser, 0, len(users))
	if len(users) == 0 {
		return rows, nil
	}
	ids := make([]int, len(users))
	for i := range users {
		ids[i] = users[i].Id
	}
	accounts := []CheckinAccount{}
	if err := tx.Where("user_id IN ?", ids).Find(&accounts).Error; err != nil {
		return nil, err
	}
	accountByUser := make(map[int]CheckinAccount, len(accounts))
	for _, account := range accounts {
		accountByUser[account.UserID] = account
	}
	facts := make(map[int]checkinFacts, len(users))
	start, end := now.AddDate(0, 0, -config.Settings.Limits.ActivityDays).Unix(), now.Unix()
	firstFullDay := start - start%86400 + 86400
	lastDay := end - end%86400
	var sums []checkinFacts
	if err := tx.Model(&CheckinUsageDay{}).Where("user_id IN ? AND day >= ? AND day < ?", ids, firstFullDay, lastDay).Select("user_id, SUM(quota) AS recent_spend").Group("user_id").Scan(&sums).Error; err != nil {
		return nil, err
	}
	for _, sum := range sums {
		facts[sum.UserID] = sum
	}
	for _, edge := range [][2]int64{{start, firstFullDay - 1}, {lastDay, end}} {
		sums = nil
		if err := tx.Model(&CheckinUsage{}).Where("user_id IN ? AND pending = ? AND created_at >= ? AND created_at <= ?", ids, false, edge[0], edge[1]).Select("user_id, SUM(quota) AS recent_spend").Group("user_id").Scan(&sums).Error; err != nil {
			return nil, err
		}
		for _, sum := range sums {
			f := facts[sum.UserID]
			f.RecentSpend += sum.RecentSpend
			facts[sum.UserID] = f
		}
	}
	sums = nil
	if err := tx.Model(&CheckinUsage{}).Where("user_id IN ? AND pending = ?", ids, true).Select("user_id, COUNT(*) AS pending").Group("user_id").Scan(&sums).Error; err != nil {
		return nil, err
	}
	for _, sum := range sums {
		f := facts[sum.UserID]
		f.Pending = sum.Pending
		facts[sum.UserID] = f
	}
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	sums = nil
	if err := tx.Model(&Checkin{}).Where("user_id IN ? AND checkin_date >= ? AND checkin_date < ?", ids, month.Format("2006-01-02"), month.AddDate(0, 1, 0).Format("2006-01-02")).Where("mode IS NULL OR mode <> ?", 2).Select("user_id, SUM(quota_awarded) AS monthly_awarded").Group("user_id").Scan(&sums).Error; err != nil {
		return nil, err
	}
	for _, sum := range sums {
		f := facts[sum.UserID]
		f.MonthlyAwarded = sum.MonthlyAwarded
		facts[sum.UserID] = f
	}
	for _, user := range users {
		account := accountByUser[user.Id]
		rows = append(rows, CheckinUser{ID: user.Id, Username: user.Username, DisplayName: user.DisplayName, CreatedAt: user.CreatedAt, Eligibility: calculateCheckin(&user, &account, config, facts[user.Id], now)})
	}
	return rows, nil
}

// One bounded-lifetime snapshot per instance. Full-population work is coalesced
// and only triggered by admin analytics requests, never by configuration writes
// or ordinary check-in traffic. Previews never populate this shared snapshot.
var checkinAnalytics struct {
	sync.Mutex
	version  int64
	builtAt  time.Time
	running  bool
	overview *CheckinOverview
	rows     []CheckinUser
	err      error
}

func checkinSnapshot(config CheckinConfiguration) (*CheckinOverview, []CheckinUser, error) {
	checkinAnalytics.Lock()
	defer checkinAnalytics.Unlock()
	matches := checkinAnalytics.version == config.Version
	if matches && !checkinAnalytics.running && time.Since(checkinAnalytics.builtAt) < 30*time.Second {
		if checkinAnalytics.err != nil {
			return nil, nil, checkinAnalytics.err
		}
		return checkinAnalytics.overview, checkinAnalytics.rows, nil
	}
	if !checkinAnalytics.running {
		checkinAnalytics.running = true
		db := DB
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			overview, rows, err := buildCheckinSnapshot(db.WithContext(ctx), config, time.Now())
			checkinAnalytics.Lock()
			defer checkinAnalytics.Unlock()
			checkinAnalytics.version = config.Version
			checkinAnalytics.builtAt = time.Now()
			checkinAnalytics.running = false
			checkinAnalytics.overview, checkinAnalytics.rows, checkinAnalytics.err = overview, rows, err
		}()
	}
	if matches && checkinAnalytics.overview != nil {
		overview := *checkinAnalytics.overview
		overview.Updating = true
		return &overview, checkinAnalytics.rows, nil
	}
	return &CheckinOverview{ConfigVersion: config.Version, Updating: true, Distribution: []CheckinDistribution{}, Days: []CheckinUsageDay{}}, nil, nil
}

func buildCheckinSnapshot(tx *gorm.DB, config CheckinConfiguration, now time.Time) (*CheckinOverview, []CheckinUser, error) {
	overview := &CheckinOverview{AsOf: now.Unix(), ConfigVersion: config.Version, Distribution: []CheckinDistribution{{Label: "0%"}, {Label: "0–25%"}, {Label: "25–50%"}, {Label: "50–75%"}, {Label: "75–100%"}, {Label: "100%"}}, Days: []CheckinUsageDay{}}
	rows := []CheckinUser{}
	lastID := 0
	for {
		var users []User
		if err := tx.Select("id", "username", "display_name", "created_at").Where("id > ?", lastID).Order("id").Limit(500).Find(&users).Error; err != nil {
			return nil, nil, err
		}
		if len(users) == 0 {
			break
		}
		batch, err := checkinUserRows(tx, users, config, now)
		if err != nil {
			return nil, nil, err
		}
		rows = append(rows, batch...)
		lastID = users[len(users)-1].Id
	}
	overview.Total = int64(len(rows))
	for _, row := range rows {
		e := row.Eligibility
		if slices.Contains(e.Reasons, "new_user_grace") {
			overview.Grace++
		}
		if e.PendingCount > 0 {
			overview.Pending++
		}
		if !e.HistoryComplete {
			overview.Incomplete++
			continue
		}
		bucket := 0
		switch {
		case e.ActivityPercent >= 100:
			overview.Active++
			bucket = 5
		case e.ActivityPercent == 0:
			overview.ZeroActivity++
		default:
			overview.LowActivity++
			bucket = min(int(e.ActivityPercent/25)+1, 4)
		}
		overview.Distribution[bucket].Count++
	}
	start, end := now.AddDate(0, 0, -config.Settings.Limits.ActivityDays).Unix(), now.Unix()
	// The chart excludes deleted users just like the list and distribution.
	activeUsers := tx.Model(&User{}).Select("id")
	firstFullDay, lastDay := start-start%86400+86400, end-end%86400
	if err := tx.Model(&CheckinUsageDay{}).Where("user_id IN (?) AND day >= ? AND day < ?", activeUsers, firstFullDay, lastDay).Select("day, SUM(quota) AS quota").Group("day").Order("day").Scan(&overview.Days).Error; err != nil {
		return nil, nil, err
	}
	const dayExpression = "created_at - (created_at % 86400)"
	for _, edge := range [][2]int64{{start, firstFullDay - 1}, {lastDay, end}} {
		var edges []CheckinUsageDay
		if err := tx.Model(&CheckinUsage{}).Where("user_id IN (?) AND pending = ? AND created_at >= ? AND created_at <= ?", activeUsers, false, edge[0], edge[1]).Select(dayExpression + " AS day, SUM(quota) AS quota").Group(dayExpression).Scan(&edges).Error; err != nil {
			return nil, nil, err
		}
		overview.Days = append(overview.Days, edges...)
	}
	slices.SortFunc(overview.Days, func(a, b CheckinUsageDay) int { return cmp.Compare(a.Day, b.Day) })
	return overview, rows, nil
}

func GetCheckinOverview() (*CheckinOverview, error) {
	config, err := CurrentCheckinConfiguration()
	if err != nil {
		return nil, err
	}
	overview, _, err := checkinSnapshot(config)
	return overview, err
}

func ListCheckinUsers(query CheckinUserQuery) (*CheckinUserPage, error) {
	if query.Page < 1 || query.Page > 1000000 || query.PageSize < 1 || query.PageSize > 100 || len(query.Search) > 100 || !slices.Contains([]string{"", "grace", "active", "low_activity", "zero_activity", "incomplete", "pending"}, query.Filter) || !slices.Contains([]string{"", "activity_asc", "activity_desc"}, query.Sort) {
		return nil, errors.New("Invalid check-in query")
	}
	config, err := CurrentCheckinConfiguration()
	if err != nil {
		return nil, err
	}
	if query.Preview != nil {
		if err := query.Preview.Validate(); err != nil {
			return nil, err
		}
		if query.Filter != "" || query.Sort != "" {
			return nil, errors.New("Preview supports the current unfiltered page only")
		}
		config.Settings = *query.Preview
	}
	now := time.Now()
	result := &CheckinUserPage{Mode: max(config.Settings.Mode, 1), Items: []CheckinUser{}, Page: query.Page, PageSize: query.PageSize, AsOf: now.Unix(), ConfigVersion: config.Version, Preview: query.Preview != nil}
	offset := (query.Page - 1) * query.PageSize
	if query.Filter != "" || query.Sort != "" {
		overview, all, err := checkinSnapshot(config)
		if err != nil {
			return nil, err
		}
		result.AsOf, result.Updating = overview.AsOf, overview.Updating
		candidates := make([]CheckinUser, 0, len(all))
		search := strings.ToLower(strings.TrimSpace(query.Search))
		for _, row := range all {
			if search != "" && !strings.Contains(strings.ToLower(row.Username+" "+row.DisplayName), search) {
				continue
			}
			e := row.Eligibility
			matches := query.Filter == ""
			switch query.Filter {
			case "grace":
				matches = slices.Contains(e.Reasons, "new_user_grace")
			case "active":
				matches = e.HistoryComplete && e.ActivityPercent >= 100
			case "low_activity":
				matches = e.HistoryComplete && e.ActivityPercent > 0 && e.ActivityPercent < 100
			case "zero_activity":
				matches = e.HistoryComplete && e.ActivityPercent == 0
			case "incomplete":
				matches = !e.HistoryComplete
			case "pending":
				matches = e.PendingCount > 0
			}
			if matches {
				candidates = append(candidates, row)
			}
		}
		slices.SortFunc(candidates, func(a, b CheckinUser) int {
			if query.Sort != "" {
				if n := cmp.Compare(a.Eligibility.ActivityPercent, b.Eligibility.ActivityPercent); n != 0 {
					if query.Sort == "activity_desc" {
						return -n
					}
					return n
				}
			}
			return cmp.Compare(b.ID, a.ID)
		})
		result.Total = int64(len(candidates))
		result.Items = candidates[min(offset, len(candidates)):min(offset+query.PageSize, len(candidates))]
		err = DB.Transaction(func(tx *gorm.DB) error {
			return populateCheckinUserBalances(tx, result.Items, now.Unix())
		})
		return result, err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		usersQuery := tx.Model(&User{})
		if search := strings.TrimSpace(query.Search); search != "" {
			pattern := "%" + strings.ToLower(search) + "%"
			usersQuery = usersQuery.Where("LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?", pattern, pattern)
		}
		if err := usersQuery.Count(&result.Total).Error; err != nil {
			return err
		}
		var users []User
		if err := usersQuery.Select("id", "username", "display_name", "created_at").Order("id DESC").Offset(offset).Limit(query.PageSize).Find(&users).Error; err != nil {
			return err
		}
		result.Items, err = checkinUserRows(tx, users, config, now)
		if err != nil {
			return err
		}
		return populateCheckinUserBalances(tx, result.Items, now.Unix())
	})
	return result, err
}

type CheckinHistoryEntry struct {
	CheckinDate  string                 `json:"checkin_date"`
	QuotaAwarded int                    `json:"quota_awarded"`
	Snapshot     *CheckinRewardSnapshot `json:"snapshot"`
}

type CheckinUserDetail struct {
	Grants  *CheckinGrantSummary  `json:"grants"`
	User    CheckinUser           `json:"user"`
	Days    []CheckinUsageDay     `json:"days"`
	Records []CheckinHistoryEntry `json:"records"`
}

func GetCheckinUserDetail(userID int) (*CheckinUserDetail, error) {
	result := &CheckinUserDetail{Days: []CheckinUsageDay{}, Records: []CheckinHistoryEntry{}}
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := readCheckinConfiguration(tx)
		if err != nil {
			return err
		}
		var user User
		if err := tx.Select("id", "username", "display_name", "created_at").First(&user, userID).Error; err != nil {
			return err
		}
		now := time.Now()
		rows, err := checkinUserRows(tx, []User{user}, config, now)
		if err != nil {
			return err
		}
		if err := populateCheckinUserBalances(tx, rows, now.Unix()); err != nil {
			return err
		}
		result.User = rows[0]
		const dayExpression = "created_at - (created_at % 86400)"
		if err := tx.Model(&CheckinUsage{}).Where("user_id = ? AND pending = ? AND created_at >= ? AND created_at <= ?", userID, false, rows[0].Eligibility.WindowStart, now.Unix()).Select(dayExpression + " AS day, SUM(quota) AS quota").Group(dayExpression).Order("day").Scan(&result.Days).Error; err != nil {
			return err
		}
		var records []Checkin
		if err := tx.Where("user_id = ?", userID).Order("checkin_date DESC").Limit(31).Find(&records).Error; err != nil {
			return err
		}
		for _, record := range records {
			entry := CheckinHistoryEntry{CheckinDate: record.CheckinDate, QuotaAwarded: record.QuotaAwarded}
			var snapshot CheckinRewardSnapshot
			if record.Policy != "" && common.UnmarshalJsonStr(record.Policy, &snapshot) == nil && snapshot.Configuration.Version > 0 {
				entry.Snapshot = &snapshot
			}
			result.Records = append(result.Records, entry)
		}
		return nil
	})
	if err == nil {
		result.Grants, err = GetCheckinGrants(userID)
	}
	return result, err
}
