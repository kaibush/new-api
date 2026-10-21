package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CheckinAccount tracks only rewards issued after this accounting was installed.
// Legacy balances and purchased quota are deliberately never classified as gifts.
type CheckinAccount struct {
	UserID        int   `gorm:"primaryKey;autoIncrement:false"`
	GiftRemaining int64 `gorm:"not null"`
	ObservedSince int64 `gorm:"not null"`
}

// CheckinUsage is a durable settlement journal, independent of optional logs.
// A pending entry prevents reward issuance until settlement is reconciled.
// SourceKey is a hash of a server request/task identifier, never an API key.
type CheckinUsage struct {
	ID        int64  `gorm:"primaryKey"`
	UserID    int    `gorm:"not null;uniqueIndex:idx_checkin_usage_source;index:idx_checkin_usage_time,priority:1"`
	SourceKey string `gorm:"type:varchar(64);not null;uniqueIndex:idx_checkin_usage_source"`
	CreatedAt int64  `gorm:"not null;index:idx_checkin_usage_time,priority:2"`
	Quota     int64  `gorm:"not null"`
	GiftUsed  int64  `gorm:"not null"`
	Wallet    bool   `gorm:"not null"`
	Pending   bool   `gorm:"not null"`
}

type CheckinEligibility struct {
	Limited          bool     `json:"limited"`
	Allowed          bool     `json:"allowed"`
	Reasons          []string `json:"reasons"`
	MinQuota         int      `json:"min_quota"`
	MaxQuota         int      `json:"max_quota"`
	RewardPercent    int      `json:"reward_percent"`
	GiftRemaining    int64    `json:"gift_remaining"`
	GiftCap          int      `json:"gift_cap"`
	MonthlyAwarded   int64    `json:"monthly_awarded"`
	MonthlyCap       int      `json:"monthly_cap"`
	RecentSpend      int64    `json:"recent_spend"`
	MinimumSpend     int      `json:"minimum_spend"`
	ActivityDays     int      `json:"activity_days"`
	ObservationUntil int64    `json:"observation_until"`
	NextMonthAt      int64    `json:"next_month_at"`
	Today            string   `json:"today"`
}

func CurrentCheckinSettings() (operation_setting.CheckinSetting, error) {
	common.OptionMapRWMutex.RLock()
	settings := *operation_setting.GetCheckinSetting()
	common.OptionMapRWMutex.RUnlock()
	return settings, settings.Limits.Validate()
}

func checkinAccount(tx *gorm.DB, userID int, now time.Time) (*CheckinAccount, error) {
	account := CheckinAccount{UserID: userID, ObservedSince: now.Unix()}
	// This write also obtains SQLite's writer lock before reading the balance.
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).First(&account, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

// BeginCheckinUsage must run before final settlement. Users who have never
// opened check-in have no account and receive a full observation window later.
func BeginCheckinUsage(userID int, source string, wallet bool) error {
	if source == "" {
		return errors.New("missing check-in settlement identifier")
	}
	hash := sha256.Sum256([]byte(source))
	return DB.Transaction(func(tx *gorm.DB) error {
		var account CheckinAccount
		lookup := lockForUpdate(tx).Where("user_id = ?", userID).Find(&account)
		if lookup.Error != nil {
			return lookup.Error
		}
		if lookup.RowsAffected == 0 {
			return nil
		}
		entry := CheckinUsage{UserID: userID, SourceKey: hex.EncodeToString(hash[:]), CreatedAt: time.Now().Unix(), Wallet: wallet, Pending: true}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "source_key"}}, DoUpdates: clause.Assignments(map[string]any{"pending": true})}).Create(&entry).Error
	})
}

// CompleteCheckinUsage attributes settled wallet spending to gifts first.
// Absolute totals make retries idempotent and refunds restore the exact gift
// portion of that request, rather than turning refunds into purchased funds.
func CompleteCheckinUsage(userID int, source string, quota int) error {
	if quota < 0 || quota > common.MaxQuota {
		return errors.New("invalid check-in settlement quota")
	}
	hash := sha256.Sum256([]byte(source))
	return DB.Transaction(func(tx *gorm.DB) error {
		var account CheckinAccount
		lookup := lockForUpdate(tx).Where("user_id = ?", userID).Find(&account)
		if lookup.Error != nil {
			return lookup.Error
		}
		if lookup.RowsAffected == 0 {
			return nil
		}
		var entry CheckinUsage
		lookup = tx.Where("user_id = ? AND source_key = ?", userID, hex.EncodeToString(hash[:])).Find(&entry)
		if lookup.Error != nil {
			return lookup.Error
		}
		// An account created during the request has no trustworthy attribution.
		if lookup.RowsAffected == 0 {
			return nil
		}
		delta := int64(quota) - entry.Quota
		if entry.Wallet {
			giftDelta := min(max(delta, 0), account.GiftRemaining)
			if delta < 0 {
				giftDelta = -max(entry.GiftUsed-int64(quota), 0)
			}
			account.GiftRemaining -= giftDelta
			entry.GiftUsed += giftDelta
			if account.GiftRemaining < 0 || account.GiftRemaining > int64(common.MaxWalletQuota) {
				return errors.New("invalid check-in gift balance")
			}
			if err := tx.Model(&account).Update("gift_remaining", account.GiftRemaining).Error; err != nil {
				return err
			}
		}
		entry.Quota = int64(quota)
		entry.Pending = false
		return tx.Save(&entry).Error
	})
}

func evaluateCheckin(tx *gorm.DB, user *User, account *CheckinAccount, settings operation_setting.CheckinSetting, limits operation_setting.CheckinLimits, now time.Time) (*CheckinEligibility, error) {
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	nextMonth := monthStart.AddDate(0, 1, 0)
	result := &CheckinEligibility{Limited: limits.Enabled, Allowed: true, Reasons: []string{}, MinQuota: settings.MinQuota, MaxQuota: settings.MaxQuota, RewardPercent: 100, GiftRemaining: account.GiftRemaining, GiftCap: limits.GiftCap, MonthlyCap: limits.MonthlyCap, MinimumSpend: limits.MinimumSpend, ActivityDays: limits.ActivityDays, NextMonthAt: nextMonth.Unix(), Today: now.Format("2006-01-02")}
	if settings.MinQuota < 0 || settings.MaxQuota < settings.MinQuota || settings.MaxQuota > common.MaxQuota {
		return nil, errors.New("invalid check-in reward range")
	}
	if !limits.Enabled {
		return result, nil
	}
	if err := tx.Model(&Checkin{}).Where("user_id = ? AND checkin_date >= ? AND checkin_date < ?", user.Id, monthStart.Format("2006-01-02"), nextMonth.Format("2006-01-02")).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&result.MonthlyAwarded).Error; err != nil {
		return nil, err
	}
	var pending int64
	if err := tx.Model(&CheckinUsage{}).Where("user_id = ? AND pending = ?", user.Id, true).Count(&pending).Error; err != nil {
		return nil, err
	}
	if pending > 0 {
		result.Reasons = append(result.Reasons, "accounting_pending")
		result.Allowed = false
	}
	start := now.AddDate(0, 0, -limits.ActivityDays).Unix()
	if err := tx.Model(&CheckinUsage{}).Where("user_id = ? AND created_at >= ? AND created_at <= ? AND pending = ?", user.Id, start, now.Unix(), false).Select("COALESCE(SUM(quota), 0)").Scan(&result.RecentSpend).Error; err != nil {
		return nil, err
	}
	result.ObservationUntil = max(time.Unix(account.ObservedSince, 0).AddDate(0, 0, limits.ActivityDays).Unix(), time.Unix(user.CreatedAt, 0).AddDate(0, 0, limits.NewUserDays).Unix())
	if now.Unix() < result.ObservationUntil {
		result.Reasons = append(result.Reasons, "observation")
	} else if result.RecentSpend < int64(limits.MinimumSpend) {
		result.Reasons = append(result.Reasons, "low_activity")
		result.RewardPercent = limits.ReducedPercent
		// Integer percentage calculation is exact and bounded by MaxQuota.
		result.MinQuota = int(int64(result.MinQuota) * int64(limits.ReducedPercent) / 100)
		result.MaxQuota = int(int64(result.MaxQuota) * int64(limits.ReducedPercent) / 100)
	}
	giftRoom := max(int64(limits.GiftCap)-account.GiftRemaining, 0)
	monthRoom := max(int64(limits.MonthlyCap)-result.MonthlyAwarded, 0)
	if giftRoom == 0 {
		result.Reasons = append(result.Reasons, "gift_cap")
	}
	if monthRoom == 0 {
		result.Reasons = append(result.Reasons, "monthly_cap")
	}
	room := min(giftRoom, monthRoom)
	result.MinQuota = int(min(int64(result.MinQuota), room))
	result.MaxQuota = int(min(int64(result.MaxQuota), room))
	if result.MaxQuota == 0 {
		result.Allowed = false
	} else {
		result.MinQuota = max(result.MinQuota, 1)
	}
	return result, nil
}

func GetCheckinEligibility(userID int) (*CheckinEligibility, error) {
	settings, err := CurrentCheckinSettings()
	if err != nil {
		return nil, err
	}
	limits := settings.Limits
	var result *CheckinEligibility
	err = DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		account, err := checkinAccount(tx, userID, now)
		if err != nil {
			return err
		}
		now = time.Now()
		var user User
		if err := tx.Select("id", "created_at").First(&user, userID).Error; err != nil {
			return err
		}
		result, err = evaluateCheckin(tx, &user, account, settings, limits, now)
		return err
	})
	return result, err
}

// CheckinRestrictedError carries the same decision used by the status endpoint.
type CheckinRestrictedError struct{ Eligibility *CheckinEligibility }

func (e *CheckinRestrictedError) Error() string { return "Check-in reward is currently restricted" }
