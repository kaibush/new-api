package model

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errCheckinPoolLimit = errors.New("check-in daily pool limit reached")

type CheckinDailyBucket struct {
	StatDate      string `gorm:"type:varchar(10);primaryKey" json:"stat_date"`
	BucketType    string `gorm:"type:varchar(16);primaryKey" json:"bucket_type"`
	BucketKey     string `gorm:"type:varchar(32);primaryKey" json:"bucket_key"`
	BucketLabel   string `gorm:"type:varchar(64);not null" json:"bucket_label"`
	CheckinCount  int64  `gorm:"not null" json:"checkin_count"`
	TotalQuota    int64  `gorm:"not null" json:"total_quota"`
	FallbackCount int64  `gorm:"not null" json:"fallback_count"`
	MaxAwardQuota int    `gorm:"not null" json:"max_award_quota"`
	UpdatedAt     int64  `gorm:"not null" json:"updated_at"`
}
type CheckinDrawLog struct {
	ID              int64  `gorm:"primaryKey" json:"id"`
	CheckinID       int    `gorm:"not null;uniqueIndex:idx_checkin_draw_checkin_id" json:"checkin_id"`
	UserID          int    `gorm:"not null;index:idx_checkin_draw_user_date,priority:1" json:"user_id"`
	CheckinDate     string `gorm:"type:varchar(10);not null;index:idx_checkin_draw_date_quota,priority:1;index:idx_checkin_draw_user_date,priority:2" json:"checkin_date"`
	CheckinHour     int    `gorm:"not null" json:"checkin_hour"`
	RewardMode      string `gorm:"type:varchar(16);not null" json:"reward_mode"`
	TierKey         string `gorm:"type:varchar(32);not null;index:idx_checkin_draw_date_tier,priority:2" json:"tier_key"`
	TierName        string `gorm:"type:varchar(64);not null" json:"tier_name"`
	TierRank        int    `gorm:"not null;index:idx_checkin_draw_date_tier,priority:1" json:"tier_rank"`
	OriginalTierKey string `gorm:"type:varchar(32);not null" json:"original_tier_key"`
	PoolFallback    bool   `gorm:"not null" json:"pool_fallback"`
	SlotKey         string `gorm:"type:varchar(32);not null" json:"slot_key"`
	SlotName        string `gorm:"type:varchar(64);not null" json:"slot_name"`
	SlotQuotaBps    int    `gorm:"not null" json:"slot_quota_bps"`
	RollBps         int    `gorm:"not null" json:"roll_bps"`
	RawTierQuota    int    `gorm:"not null" json:"raw_tier_quota"`
	BaseQuota       int    `gorm:"not null" json:"base_quota"`
	RewardPercent   int    `gorm:"not null" json:"reward_percent"`
	QuotaAwarded    int    `gorm:"not null;index:idx_checkin_draw_date_quota,priority:2" json:"quota_awarded"`
	CreatedAt       int64  `gorm:"not null;index:idx_checkin_draw_created_at" json:"created_at"`
}
type CheckinDailyPool struct {
	StatDate  string `gorm:"type:varchar(10);primaryKey"`
	PoolKey   string `gorm:"type:varchar(48);primaryKey"`
	UsedQuota int64  `gorm:"not null"`
	WinCount  int64  `gorm:"not null"`
	UpdatedAt int64  `gorm:"not null"`
}

type checkinDraw struct {
	Mode            string `json:"reward_mode"`
	TierKey         string `json:"tier_key"`
	TierName        string `json:"tier_name"`
	TierRank        int    `json:"tier_rank"`
	OriginalTierKey string `json:"original_tier_key"`
	Fallback        bool   `json:"pool_fallback"`
	SlotKey         string `json:"slot_key"`
	SlotName        string `json:"slot_name"`
	SlotBps         int    `json:"slot_quota_bps"`
	Roll            int    `json:"roll_bps"`
	RawQuota        int    `json:"raw_tier_quota"`
	BaseQuota       int    `json:"base_quota"`
	Hour            int    `json:"-"`
}

func checkinRandom(n int64) (int64, error) {
	if n <= 1 {
		return 0, nil
	}
	v, err := rand.Int(rand.Reader, big.NewInt(n))
	if err != nil {
		return 0, err
	}
	return v.Int64(), nil
}

func activeCheckinRewardRange(settings operation_setting.CheckinSetting, now time.Time) (int, int) {
	pool := settings.Pool
	if pool.RewardMode != "tiered" {
		return settings.MinQuota, settings.MaxQuota
	}
	multiplier := 10000
	weights := make(map[string]int, len(pool.Tiers))
	for _, tier := range pool.Tiers {
		weights[tier.Key] = tier.WeightBps
	}
	if pool.TimeSlotsEnabled {
		multiplier = pool.DefaultSlotQuotaBps
		minute := now.Hour()*60 + now.Minute()
		for _, slot := range pool.TimeSlots {
			if minute < slot.StartMinute || minute >= slot.EndMinute {
				continue
			}
			multiplier = slot.QuotaBps
			if slot.OverrideTiers {
				for _, weight := range slot.TierWeights {
					weights[weight.TierKey] = weight.WeightBps
				}
			}
			break
		}
	}
	minimum, maximum := settings.MaxQuota, 0
	for i, tier := range pool.Tiers {
		if weights[tier.Key] == 0 && i != 0 {
			continue
		}
		minimum = min(minimum, int(min(int64(tier.MinQuota)*int64(multiplier)/10000, int64(settings.MaxQuota))))
		maximum = max(maximum, int(min(int64(tier.MaxQuota)*int64(multiplier)/10000, int64(settings.MaxQuota))))
	}
	return minimum, maximum
}

func drawCheckinReward(tx *gorm.DB, settings operation_setting.CheckinSetting, eligibility *CheckinEligibility, now time.Time) (int, checkinDraw, error) {
	pool := settings.Pool
	location, err := time.LoadLocation(pool.Timezone)
	if err != nil {
		location = time.Local
	}
	local := now.In(location)
	if pool.RewardMode != "tiered" {
		value, err := checkinRandom(int64(settings.MaxQuota-settings.MinQuota) + 1)
		quota := settings.MinQuota + int(value)
		return quota, checkinDraw{RawQuota: quota, BaseQuota: quota, Mode: "uniform", TierKey: "uniform", TierName: "Uniform", SlotKey: "default", SlotName: "Standard", SlotBps: 10000, Hour: local.Hour()}, err
	}
	minute := local.Hour()*60 + local.Minute()
	slotKey, slotName, quotaBps := "default", "Standard", 10000
	var slot *operation_setting.CheckinTimeSlot
	if pool.TimeSlotsEnabled {
		quotaBps = pool.DefaultSlotQuotaBps
		for i := range pool.TimeSlots {
			candidate := &pool.TimeSlots[i]
			if minute >= candidate.StartMinute && minute < candidate.EndMinute {
				slot = candidate
				slotKey, slotName, quotaBps = candidate.Key, candidate.Name, candidate.QuotaBps
				break
			}
		}
	}
	weights := make(map[string]int, len(pool.Tiers))
	for _, tier := range pool.Tiers {
		weights[tier.Key] = tier.WeightBps
	}
	if slot != nil && slot.OverrideTiers {
		for _, weight := range slot.TierWeights {
			weights[weight.TierKey] = weight.WeightBps
		}
	}
	roll64, err := checkinRandom(10000)
	if err != nil {
		return 0, checkinDraw{}, err
	}
	roll := int(roll64)
	selected := 0
	cumulative := 0
	for i, tier := range pool.Tiers {
		cumulative += weights[tier.Key]
		if roll < cumulative {
			selected = i
			break
		}
	}
	initial := pool.Tiers[selected]
	for {
		tier := pool.Tiers[selected]
		raw, err := checkinRandom(int64(tier.MaxQuota-tier.MinQuota) + 1)
		if err != nil {
			return 0, checkinDraw{}, err
		}
		scaled := (int64(tier.MinQuota) + raw) * int64(quotaBps) / 10000
		scaled = min(max(scaled, 0), int64(settings.MaxQuota))
		if selected > 0 {
			awarded := checkinReward(int(scaled), eligibility)
			if err := consumeCheckinPool(tx, local.Format("2006-01-02"), tier, pool.DailyPool, awarded, now.Unix()); err != nil {
				if !errors.Is(err, errCheckinPoolLimit) {
					return 0, checkinDraw{}, err
				}
				selected = 0
				continue
			}
		}
		return int(scaled), checkinDraw{Mode: "tiered", TierKey: tier.Key, TierName: tier.Name, TierRank: selected, OriginalTierKey: initial.Key, Fallback: selected == 0 && initial.Key != tier.Key, SlotKey: slotKey, SlotName: slotName, SlotBps: quotaBps, Roll: roll, RawQuota: tier.MinQuota + int(raw), BaseQuota: int(scaled), Hour: local.Hour()}, nil
	}
}

func consumeCheckinPool(tx *gorm.DB, day string, tier operation_setting.CheckinRewardTier, config operation_setting.CheckinDailyPoolConfig, awarded int, now int64) error {
	// Always account for high-tier awards, including while limits are disabled.
	keys := []string{"__bonus_quota__", "tier:" + tier.Key}
	if err := seedCheckinDailyPool(tx, day, now); err != nil {
		return err
	}
	for _, key := range keys {
		row := CheckinDailyPool{StatDate: day, PoolKey: key, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
	}
	var rows []CheckinDailyPool
	if err := lockForUpdate(tx).Where("stat_date = ? AND pool_key IN ?", day, keys).Order("pool_key").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if row.PoolKey == "__bonus_quota__" && config.Enabled && config.DailyBonusCap > 0 && int64(awarded) > config.DailyBonusCap-row.UsedQuota {
			return errCheckinPoolLimit
		}
		if row.PoolKey == "tier:"+tier.Key && tier.DailyMaxCount > 0 && row.WinCount >= int64(tier.DailyMaxCount) {
			return errCheckinPoolLimit
		}
	}
	for _, row := range rows {
		if err := tx.Model(&row).Updates(map[string]any{"used_quota": gorm.Expr("used_quota + ?", awarded), "win_count": gorm.Expr("win_count + 1"), "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}

// seedCheckinDailyPool reconciles counters from pre-upgrade draw logs once per
// day. Every high-tier draw takes the total-pool lock before touching tier rows.
func seedCheckinDailyPool(tx *gorm.DB, day string, now int64) error {
	total := CheckinDailyPool{StatDate: day, PoolKey: "__bonus_quota__", UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&total).Error; err != nil {
		return err
	}
	if err := lockForUpdate(tx).Where("stat_date = ? AND pool_key = ?", day, total.PoolKey).First(&total).Error; err != nil {
		return err
	}
	var seeded []CheckinDailyPool
	if err := lockForUpdate(tx).Where("stat_date = ? AND pool_key = ?", day, "__ledger_seeded__").Find(&seeded).Error; err != nil {
		return err
	}
	if len(seeded) != 0 {
		return nil
	}
	// Locking reads see committed draws even if this MySQL transaction established
	// its repeatable-read snapshot before waiting for the total-pool lock.
	var draws []CheckinDrawLog
	if err := lockForUpdate(tx).Select("id", "tier_key", "quota_awarded").Where("checkin_date = ? AND tier_rank > 0", day).Order("id").Find(&draws).Error; err != nil {
		return err
	}
	counters := map[string]CheckinDailyPool{
		total.PoolKey: {StatDate: day, PoolKey: total.PoolKey, UpdatedAt: now},
	}
	for _, draw := range draws {
		for _, key := range []string{total.PoolKey, "tier:" + draw.TierKey} {
			row := counters[key]
			row.StatDate, row.PoolKey, row.UpdatedAt = day, key, now
			row.UsedQuota += int64(draw.QuotaAwarded)
			row.WinCount++
			counters[key] = row
		}
	}
	keys := make([]string, 0, len(counters))
	for key := range counters {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		row := counters[key]
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "stat_date"}, {Name: "pool_key"}},
			DoUpdates: clause.AssignmentColumns([]string{"used_quota", "win_count", "updated_at"}),
		}).Create(&row).Error; err != nil {
			return err
		}
	}
	return tx.Create(&CheckinDailyPool{StatDate: day, PoolKey: "__ledger_seeded__", UpdatedAt: now}).Error
}

func writeCheckinDraw(tx *gorm.DB, record *Checkin, draw checkinDraw) error {
	log := CheckinDrawLog{CheckinID: record.Id, UserID: record.UserId, CheckinDate: record.CheckinDate, CheckinHour: draw.Hour, RewardMode: draw.Mode, TierKey: draw.TierKey, TierName: draw.TierName, TierRank: draw.TierRank, OriginalTierKey: draw.OriginalTierKey, PoolFallback: draw.Fallback, SlotKey: draw.SlotKey, SlotName: draw.SlotName, SlotQuotaBps: draw.SlotBps, RollBps: draw.Roll, RawTierQuota: draw.RawQuota, BaseQuota: draw.BaseQuota, RewardPercent: record.RewardPercent, QuotaAwarded: record.QuotaAwarded, CreatedAt: record.CreatedAt}
	if err := tx.Create(&log).Error; err != nil {
		return err
	}
	date := record.CheckinDate
	hour := fmt.Sprintf("%02d", draw.Hour)
	buckets := []CheckinDailyBucket{
		{StatDate: date, BucketType: "hour", BucketKey: hour, BucketLabel: hour + ":00", UpdatedAt: record.CreatedAt},
		{StatDate: date, BucketType: "slot", BucketKey: draw.SlotKey, BucketLabel: draw.SlotName, UpdatedAt: record.CreatedAt},
		{StatDate: date, BucketType: "summary", BucketKey: "all", BucketLabel: "All check-ins", UpdatedAt: record.CreatedAt},
		{StatDate: date, BucketType: "tier", BucketKey: draw.TierKey, BucketLabel: draw.TierName, UpdatedAt: record.CreatedAt},
	}
	for _, bucket := range buckets {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&bucket).Error; err != nil {
			return err
		}
		fallback := 0
		if draw.Fallback {
			fallback = 1
		}
		updates := map[string]any{"checkin_count": gorm.Expr("checkin_count + 1"), "total_quota": gorm.Expr("total_quota + ?", record.QuotaAwarded), "fallback_count": gorm.Expr("fallback_count + ?", fallback), "max_award_quota": gorm.Expr("CASE WHEN max_award_quota < ? THEN ? ELSE max_award_quota END", record.QuotaAwarded, record.QuotaAwarded), "updated_at": record.CreatedAt}
		if err := tx.Model(&CheckinDailyBucket{}).Where("stat_date = ? AND bucket_type = ? AND bucket_key = ?", date, bucket.BucketType, bucket.BucketKey).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}

type CheckinLeaderboardEntry struct {
	Rank         int    `json:"rank"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	QuotaAwarded int64  `json:"quota_awarded"`
	CheckinDate  string `json:"checkin_date"`
	TierName     string `json:"tier_name"`
}

type checkinPublicLeaderboard struct {
	Top                   []CheckinLeaderboardEntry
	Highlights            []CheckinLeaderboardEntry
	Totals                []CheckinLeaderboardEntry
	TodayCheckins         int64
	YesterdayCheckins     int64
	TodayPeakHour         *int
	TodayPeakHourCheckins int64
	RecentParticipants    int64
	RecentCheckins        int64
}

var checkinLeaderboardCache struct {
	sync.Mutex
	db      *gorm.DB
	version int64
	date    string
	builtAt time.Time
	data    checkinPublicLeaderboard
}

func publicCheckinLeaderboard(config CheckinConfiguration, today, yesterday, cutoff string) (checkinPublicLeaderboard, error) {
	checkinLeaderboardCache.Lock()
	defer checkinLeaderboardCache.Unlock()
	if checkinLeaderboardCache.db == DB && checkinLeaderboardCache.version == config.Version && checkinLeaderboardCache.date == today && time.Since(checkinLeaderboardCache.builtAt) < 15*time.Second {
		return checkinLeaderboardCache.data, nil
	}
	setting := config.Settings.Pool.Leaderboard
	result := checkinPublicLeaderboard{Top: []CheckinLeaderboardEntry{}, Highlights: []CheckinLeaderboardEntry{}, Totals: []CheckinLeaderboardEntry{}}
	query := DB.Table("checkin_draw_logs AS d").Joins("JOIN users u ON u.id = d.user_id").Where("u.deleted_at IS NULL")
	if err := query.Session(&gorm.Session{}).Select("u.username, u.display_name, d.quota_awarded, d.checkin_date, d.tier_name").Where("d.checkin_date = ?", today).Order("d.quota_awarded DESC, d.created_at ASC, d.id ASC").Limit(setting.TopN).Scan(&result.Top).Error; err != nil {
		return result, err
	}
	if err := query.Session(&gorm.Session{}).Where("d.checkin_date = ?", today).Count(&result.TodayCheckins).Error; err != nil {
		return result, err
	}
	if config.Settings.Pool.StatsRetentionDays >= 2 {
		if err := query.Session(&gorm.Session{}).Where("d.checkin_date = ?", yesterday).Count(&result.YesterdayCheckins).Error; err != nil {
			return result, err
		}
	}
	if result.TodayCheckins > 0 {
		var peak struct {
			CheckinHour int   `gorm:"column:checkin_hour"`
			Count       int64 `gorm:"column:cnt"`
		}
		if err := query.Session(&gorm.Session{}).
			Select("d.checkin_hour, COUNT(*) AS cnt").
			Where("d.checkin_date = ?", today).
			Group("d.checkin_hour").
			Order("COUNT(*) DESC, d.checkin_hour ASC").
			Limit(1).
			Scan(&peak).Error; err != nil {
			return result, err
		}
		if peak.Count > 0 {
			hour := peak.CheckinHour
			result.TodayPeakHour = &hour
			result.TodayPeakHourCheckins = peak.Count
		}
	}
	var recentSummary struct {
		TotalCheckins int64 `gorm:"column:total_checkins"`
		Participants  int64 `gorm:"column:participants"`
	}
	if err := query.Session(&gorm.Session{}).
		Select("COUNT(*) AS total_checkins, COUNT(DISTINCT d.user_id) AS participants").
		Where("d.checkin_date >= ? AND d.checkin_date <= ?", cutoff, today).
		Scan(&recentSummary).Error; err != nil {
		return result, err
	}
	result.RecentCheckins = recentSummary.TotalCheckins
	result.RecentParticipants = recentSummary.Participants
	if setting.ShowRecentJackpots {
		if err := query.Session(&gorm.Session{}).Select("u.username, u.display_name, d.quota_awarded, d.checkin_date, d.tier_name").Where("d.checkin_date >= ? AND d.checkin_date <= ? AND d.tier_rank > 0", cutoff, today).Order("d.quota_awarded DESC, d.created_at DESC, d.id ASC").Limit(setting.TopN).Scan(&result.Highlights).Error; err != nil {
			return result, err
		}
	}
	if err := query.Session(&gorm.Session{}).Select("u.username, u.display_name, SUM(d.quota_awarded) AS quota_awarded").Where("d.checkin_date >= ? AND d.checkin_date <= ?", cutoff, today).Group("d.user_id, u.username, u.display_name").Order("SUM(d.quota_awarded) DESC, d.user_id ASC").Limit(setting.TopN).Scan(&result.Totals).Error; err != nil {
		return result, err
	}
	for _, entries := range [][]CheckinLeaderboardEntry{result.Top, result.Highlights, result.Totals} {
		for i := range entries {
			entries[i].Rank = i + 1
			if setting.MaskUsername {
				entries[i].Username = maskCheckinName(entries[i].Username)
				entries[i].DisplayName = maskCheckinName(entries[i].DisplayName)
			}
		}
	}
	checkinLeaderboardCache.db = DB
	checkinLeaderboardCache.version = config.Version
	checkinLeaderboardCache.date = today
	checkinLeaderboardCache.builtAt = time.Now()
	checkinLeaderboardCache.data = result
	return result, nil
}

func GetCheckinLeaderboard(userID int) (map[string]any, error) {
	config, err := CurrentCheckinConfiguration()
	if err != nil {
		return nil, err
	}
	setting := config.Settings.Pool.Leaderboard
	if !config.Settings.Enabled || !setting.Enabled {
		return map[string]any{"enabled": false}, nil
	}
	location, err := time.LoadLocation(config.Settings.Pool.Timezone)
	if err != nil {
		return nil, err
	}
	localNow := time.Now().In(location)
	todayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, location)
	today := todayStart.Format("2006-01-02")
	yesterday := todayStart.AddDate(0, 0, -1).Format("2006-01-02")
	cutoff := todayStart.AddDate(0, 0, -(config.Settings.Pool.StatsRetentionDays - 1)).Format("2006-01-02")
	public, err := publicCheckinLeaderboard(config, today, yesterday, cutoff)
	if err != nil {
		return nil, err
	}
	todayCheckins := public.TodayCheckins
	recentCheckins := public.RecentCheckins
	recentParticipants := public.RecentParticipants
	result := map[string]any{
		"enabled":             true,
		"today":               today,
		"timezone":            config.Settings.Pool.Timezone,
		"retention_days":      config.Settings.Pool.StatsRetentionDays,
		"top_n":               setting.TopN,
		"today_checkins":      todayCheckins,
		"recent_checkins":     recentCheckins,
		"recent_participants": recentParticipants,
		"top":                 public.Top,
		"recent_totals":       public.Totals,
	}
	if config.Settings.Pool.StatsRetentionDays >= 2 {
		result["yesterday_checkins"] = public.YesterdayCheckins
	}
	if public.TodayPeakHour != nil {
		result["today_peak_hour"] = *public.TodayPeakHour
		result["today_peak_hour_checkins"] = public.TodayPeakHourCheckins
	}
	if setting.ShowRecentJackpots {
		result["recent_highlights"] = public.Highlights
	}
	if setting.ShowMyRank {
		var mine CheckinDrawLog
		found := DB.Where("user_id = ? AND checkin_date = ?", userID, today).First(&mine)
		if found.Error == nil {
			query := DB.Table("checkin_draw_logs AS d").Joins("JOIN users u ON u.id = d.user_id").Where("u.deleted_at IS NULL AND d.checkin_date = ?", today)
			var ahead, total int64
			if err := query.Session(&gorm.Session{}).Where("d.quota_awarded > ? OR (d.quota_awarded = ? AND (d.created_at < ? OR (d.created_at = ? AND d.id < ?)))", mine.QuotaAwarded, mine.QuotaAwarded, mine.CreatedAt, mine.CreatedAt, mine.ID).Count(&ahead).Error; err != nil {
				return nil, err
			}
			if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
				return nil, err
			}
			result["my_rank"], result["my_quota"] = ahead+1, mine.QuotaAwarded
			if total > 0 {
				result["surpassed_bps"] = (total - ahead - 1) * 10000 / total
			}
			if total > todayCheckins {
				result["today_checkins"] = total
				result["recent_checkins"] = max(recentCheckins, total)
				result["recent_participants"] = max(recentParticipants, total)
			}
		} else if !errors.Is(found.Error, gorm.ErrRecordNotFound) {
			return nil, found.Error
		}
	}
	return result, nil
}

func maskCheckinName(value string) string {
	runes := []rune(value)
	if len(runes) == 0 {
		return "***"
	}
	if len(runes) == 1 {
		return string(runes[0]) + "***"
	}
	return string(runes[0]) + "***" + string(runes[len(runes)-1])
}

func GetCheckinAnalytics(days int) (map[string]any, error) {
	config, err := CurrentCheckinConfiguration()
	if err != nil {
		return nil, err
	}
	days = min(max(days, 1), config.Settings.Pool.StatsRetentionDays)
	location, err := time.LoadLocation(config.Settings.Pool.Timezone)
	if err != nil {
		location = time.Local
	}
	today := time.Now().In(location)
	start := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, location).AddDate(0, 0, -(days - 1))
	var buckets []CheckinDailyBucket
	if err := DB.Where("stat_date >= ? AND stat_date <= ?", start.Format("2006-01-02"), today.Format("2006-01-02")).Order("stat_date, bucket_type, bucket_key").Find(&buckets).Error; err != nil {
		return nil, err
	}
	byDate := make(map[string][]CheckinDailyBucket, days)
	for _, bucket := range buckets {
		byDate[bucket.StatDate] = append(byDate[bucket.StatDate], bucket)
	}
	daily := make([]map[string]any, 0, days)
	for offset := range days {
		date := start.AddDate(0, 0, offset).Format("2006-01-02")
		row := map[string]any{"date": date, "total_checkins": int64(0), "total_quota": int64(0), "fallback_count": int64(0), "tiers": []CheckinDailyBucket{}, "slots": []CheckinDailyBucket{}, "hours": []CheckinDailyBucket{}}
		for _, bucket := range byDate[date] {
			switch bucket.BucketType {
			case "summary":
				row["total_checkins"], row["total_quota"], row["fallback_count"] = bucket.CheckinCount, bucket.TotalQuota, bucket.FallbackCount
			case "tier":
				row["tiers"] = append(row["tiers"].([]CheckinDailyBucket), bucket)
			case "slot":
				row["slots"] = append(row["slots"].([]CheckinDailyBucket), bucket)
			case "hour":
				row["hours"] = append(row["hours"].([]CheckinDailyBucket), bucket)
			}
		}
		daily = append(daily, row)
	}
	var budget CheckinDailyPool
	if err := DB.Where("stat_date = ? AND pool_key = ?", today.Format("2006-01-02"), "__bonus_quota__").Find(&budget).Error; err != nil {
		return nil, err
	}
	return map[string]any{"timezone": config.Settings.Pool.Timezone, "today": today.Format("2006-01-02"), "retention_days": config.Settings.Pool.StatsRetentionDays, "reward_mode": config.Settings.Pool.RewardMode, "daily_series": daily, "configured_tiers": config.Settings.Pool.Tiers, "daily_pool": config.Settings.Pool.DailyPool, "today_pool_used": budget.UsedQuota}, nil
}

func CleanupCheckinStats() error {
	config, err := CurrentCheckinConfiguration()
	if err != nil {
		return err
	}
	location, err := time.LoadLocation(config.Settings.Pool.Timezone)
	if err != nil {
		location = time.Local
	}
	today := time.Now().In(location)
	cutoff := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, location).AddDate(0, 0, -(config.Settings.Pool.StatsRetentionDays - 1)).Format("2006-01-02")
	for deleted := 0; deleted < 10000; deleted += 500 {
		var ids []int64
		if err := DB.Model(&CheckinDrawLog{}).Where("checkin_date < ?", cutoff).Order("id").Limit(500).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			break
		}
		if err := DB.Where("id IN ?", ids).Delete(&CheckinDrawLog{}).Error; err != nil {
			return err
		}
		if len(ids) < 500 {
			break
		}
	}
	if err := DB.Where("stat_date < ?", cutoff).Delete(&CheckinDailyBucket{}).Error; err != nil {
		return err
	}
	return DB.Where("stat_date < ?", cutoff).Delete(&CheckinDailyPool{}).Error
}
