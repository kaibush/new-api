package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
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
	UserID    int    `gorm:"not null;uniqueIndex:idx_checkin_usage_source;index:idx_checkin_usage_time,priority:1;index:idx_checkin_usage_pending,priority:1"`
	SourceKey string `gorm:"type:varchar(64);not null;uniqueIndex:idx_checkin_usage_source"`
	CreatedAt int64  `gorm:"not null;index:idx_checkin_usage_time,priority:2"`
	Quota     int64  `gorm:"not null"`
	GiftUsed  int64  `gorm:"not null"`
	Wallet    bool   `gorm:"not null"`
	Pending   bool   `gorm:"not null;index:idx_checkin_usage_pending,priority:2"`
}

// CheckinUsageDay contains only settled consumption, including gift and subscription
// charges. UTC day buckets are corrected transactionally on settlement/refund.
type CheckinUsageDay struct {
	UserID int   `gorm:"primaryKey;autoIncrement:false" json:"-"`
	Day    int64 `gorm:"primaryKey;autoIncrement:false;index" json:"day"`
	Quota  int64 `gorm:"not null" json:"quota"`
}

type CheckinEligibility struct {
	ActivityPercent    float64  `json:"activity_percent"`
	RewardNumerator    int64    `json:"reward_numerator"`
	RewardDenominator  int64    `json:"reward_denominator"`
	CoverageSince      int64    `json:"coverage_since"`
	HistoryComplete    bool     `json:"history_complete"`
	WindowStart        int64    `json:"window_start"`
	AsOf               int64    `json:"as_of"`
	ConfigVersion      int64    `json:"config_version"`
	NewUserDays        int      `json:"new_user_days"`
	GraceDay           int      `json:"grace_day"`
	GraceRemainingDays int      `json:"grace_remaining_days"`
	PendingCount       int64    `json:"pending_count"`
	SpendingGap        int64    `json:"spending_gap"`
	BaseMinQuota       int      `json:"base_min_quota"`
	BaseMaxQuota       int      `json:"base_max_quota"`
	MonthlyRemaining   int64    `json:"monthly_remaining"`
	Limited            bool     `json:"limited"`
	Allowed            bool     `json:"allowed"`
	Reasons            []string `json:"reasons"`
	MinQuota           int      `json:"min_quota"`
	MaxQuota           int      `json:"max_quota"`
	RewardPercent      float64  `json:"reward_percent"`
	GiftRemaining      int64    `json:"gift_remaining"`
	GiftCap            int      `json:"gift_cap"` // Deprecated: always zero; gifts no longer cap rewards.
	MonthlyAwarded     int64    `json:"monthly_awarded"`
	MonthlyCap         int      `json:"monthly_cap"`
	RecentSpend        int64    `json:"recent_spend"`
	MinimumSpend       int      `json:"minimum_spend"`
	ActivityDays       int      `json:"activity_days"`
	ObservationUntil   int64    `json:"observation_until"`
	NextMonthAt        int64    `json:"next_month_at"`
	Today              string   `json:"today"`
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

// BeginCheckinUsage starts durable observation for every user before settlement,
// regardless of whether they have ever opened the check-in page.
func BeginCheckinUsage(userID int, source string, wallet bool) error {
	if source == "" {
		return errors.New("missing check-in settlement identifier")
	}
	hash := sha256.Sum256([]byte(source))
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := checkinAccount(tx, userID, time.Now()); err != nil {
			return err
		}
		var entry CheckinUsage
		lookup := tx.Where("user_id = ? AND source_key = ?", userID, hex.EncodeToString(hash[:])).Find(&entry)
		if lookup.Error != nil {
			return lookup.Error
		}
		if lookup.RowsAffected == 0 {
			entry = CheckinUsage{UserID: userID, SourceKey: hex.EncodeToString(hash[:]), CreatedAt: time.Now().Unix(), Wallet: wallet, Pending: true}
			return tx.Create(&entry).Error
		}
		if entry.Wallet != wallet {
			return errors.New("check-in settlement funding source changed")
		}
		if entry.Pending {
			return nil
		}
		if err := adjustCheckinUsageDay(tx, &entry, -entry.Quota); err != nil {
			return err
		}
		return tx.Model(&entry).Update("pending", true).Error
	})
}

// adjustCheckinUsageDay runs under the user's accounting lock. Arithmetic uses
// signed 64-bit totals; individual charges are bounded by common.MaxQuota.
func adjustCheckinUsageDay(tx *gorm.DB, entry *CheckinUsage, delta int64) error {
	if delta == 0 {
		return nil
	}
	day := CheckinUsageDay{UserID: entry.UserID, Day: entry.CreatedAt - entry.CreatedAt%86400}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&day).Error; err != nil {
		return err
	}
	return tx.Model(&CheckinUsageDay{}).Where("user_id = ? AND day = ?", day.UserID, day.Day).Update("quota", gorm.Expr("quota + ?", delta)).Error
}

// CompleteCheckinUsage attributes settled wallet spending to gifts first.
// Absolute totals make retries idempotent and refunds restore the exact gift
// portion of that request, rather than turning refunds into purchased funds.
func CompleteCheckinUsage(userID int, source string, quota int) error {
	if source == "" || quota < 0 || quota > common.MaxQuota {
		return errors.New("invalid check-in settlement quota")
	}
	hash := sha256.Sum256([]byte(source))
	return DB.Transaction(func(tx *gorm.DB) error {
		// Acquire SQLite's writer lock before reading; the account lock also
		// serializes gift attribution and refunds on MySQL/PostgreSQL.
		if err := tx.Model(&CheckinAccount{}).Where("user_id = ?", userID).Update("gift_remaining", gorm.Expr("gift_remaining")).Error; err != nil {
			return err
		}
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
		summaryDelta := delta
		if entry.Pending {
			summaryDelta = int64(quota)
		}
		if err := adjustCheckinUsageDay(tx, &entry, summaryDelta); err != nil {
			return err
		}
		entry.Quota = int64(quota)
		entry.Pending = false
		return tx.Save(&entry).Error
	})
}

type checkinFacts struct {
	UserID         int
	RecentSpend    int64
	MonthlyAwarded int64
	Pending        int64
}

// evaluateCheckin uses journal facts inside the same transaction as the credit.
func evaluateCheckin(tx *gorm.DB, user *User, account *CheckinAccount, config CheckinConfiguration, now time.Time) (*CheckinEligibility, error) {
	limits := config.Settings.Limits
	facts := checkinFacts{}
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	if err := tx.Model(&Checkin{}).Where("user_id = ? AND checkin_date >= ? AND checkin_date < ?", user.Id, monthStart.Format("2006-01-02"), monthStart.AddDate(0, 1, 0).Format("2006-01-02")).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&facts.MonthlyAwarded).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&CheckinUsage{}).Where("user_id = ? AND pending = ?", user.Id, true).Count(&facts.Pending).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&CheckinUsage{}).Where("user_id = ? AND created_at >= ? AND created_at <= ? AND pending = ?", user.Id, now.AddDate(0, 0, -limits.ActivityDays).Unix(), now.Unix(), false).Select("COALESCE(SUM(quota), 0)").Scan(&facts.RecentSpend).Error; err != nil {
		return nil, err
	}
	return calculateCheckin(user, account, config, facts, now), nil
}

// calculateCheckin is shared by issuance, live lists and previews. Percentages
// are presentation values only: reward amounts use the exact integer fraction.
func calculateCheckin(user *User, account *CheckinAccount, config CheckinConfiguration, facts checkinFacts, now time.Time) *CheckinEligibility {
	settings, limits := config.Settings, config.Settings.Limits
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	start := now.AddDate(0, 0, -limits.ActivityDays).Unix()
	coverage := config.ObservedSince
	if account.ObservedSince > 0 {
		coverage = min(coverage, account.ObservedSince)
	}
	coverage = max(coverage, user.CreatedAt)
	result := &CheckinEligibility{
		Limited: limits.Enabled, Allowed: settings.Enabled, Reasons: []string{},
		MinQuota: settings.MinQuota, MaxQuota: settings.MaxQuota, BaseMinQuota: settings.MinQuota, BaseMaxQuota: settings.MaxQuota,
		RewardPercent: 100, RewardNumerator: 1, RewardDenominator: 1,
		GiftRemaining: account.GiftRemaining, MonthlyCap: limits.MonthlyCap, MinimumSpend: limits.MinimumSpend, ActivityDays: limits.ActivityDays,
		NextMonthAt: monthStart.AddDate(0, 1, 0).Unix(), Today: now.Format("2006-01-02"),
		MonthlyAwarded: facts.MonthlyAwarded, RecentSpend: facts.RecentSpend, PendingCount: facts.Pending,
		CoverageSince: coverage, HistoryComplete: coverage <= max(start, user.CreatedAt), WindowStart: start, AsOf: now.Unix(), ConfigVersion: config.Version,
		NewUserDays: limits.NewUserDays, SpendingGap: max(int64(limits.MinimumSpend)-facts.RecentSpend, 0),
		MonthlyRemaining: max(int64(limits.MonthlyCap)-facts.MonthlyAwarded, 0),
	}
	result.ActivityPercent = 100
	if limits.MinimumSpend > 0 {
		result.ActivityPercent = float64(min(facts.RecentSpend, int64(limits.MinimumSpend))) * 100 / float64(limits.MinimumSpend)
	}
	if user.CreatedAt > 0 {
		registered := time.Unix(user.CreatedAt, 0).In(now.Location())
		result.ObservationUntil = registered.AddDate(0, 0, limits.NewUserDays).Unix()
		elapsedDays := max(int(now.Sub(registered).Hours()/24), 0)
		// Match AddDate expiry across 23/25-hour daylight-saving days.
		if now.Before(registered.AddDate(0, 0, elapsedDays)) {
			elapsedDays = max(elapsedDays-1, 0)
		}
		if !now.Before(registered.AddDate(0, 0, elapsedDays+1)) {
			elapsedDays++
		}
		result.GraceDay = min(elapsedDays+1, limits.NewUserDays)
		if now.Unix() < result.ObservationUntil {
			result.GraceRemainingDays = max(limits.NewUserDays-elapsedDays, 0)
		}
	}
	if !settings.Enabled {
		result.Reasons = append(result.Reasons, "checkin_disabled")
	}
	if !result.HistoryComplete {
		result.Reasons = append(result.Reasons, "history_incomplete")
	}
	if !limits.Enabled {
		result.Allowed = result.Allowed && result.MaxQuota > 0
		return result
	}
	inGrace := now.Unix() < result.ObservationUntil
	if facts.Pending > 0 && !inGrace {
		result.Reasons = append(result.Reasons, "accounting_pending")
		result.Allowed = false
	}
	if inGrace {
		result.Reasons = append(result.Reasons, "new_user_grace")
	} else if result.HistoryComplete && result.ActivityPercent < 100 {
		result.Reasons = append(result.Reasons, "low_activity")
		result.RewardNumerator, result.RewardDenominator = facts.RecentSpend, int64(limits.MinimumSpend)
		// Cross-products fit in int64: operands are bounded by MaxQuota and 100.
		if facts.RecentSpend*100 <= int64(limits.ReducedPercent)*int64(limits.MinimumSpend) {
			result.RewardNumerator, result.RewardDenominator = int64(limits.ReducedPercent), 100
			result.Reasons = append(result.Reasons, "reward_floor")
		}
		result.RewardPercent = float64(result.RewardNumerator) * 100 / float64(result.RewardDenominator)
	}
	result.MinQuota = checkinReward(settings.MinQuota, result)
	result.MaxQuota = checkinReward(settings.MaxQuota, result)
	if result.MonthlyRemaining == 0 || result.MonthlyRemaining < int64(settings.MaxQuota)*result.RewardNumerator/result.RewardDenominator {
		result.Reasons = append(result.Reasons, "monthly_cap")
	}
	if result.MaxQuota == 0 {
		result.Allowed = false
	}
	return result
}

func checkinReward(base int, eligibility *CheckinEligibility) int {
	reward := int64(base) * eligibility.RewardNumerator / eligibility.RewardDenominator
	if eligibility.Limited {
		reward = min(reward, eligibility.MonthlyRemaining)
	}
	return int(reward)
}

func GetCheckinEligibility(userID int) (*CheckinEligibility, error) {
	var result *CheckinEligibility
	err := DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		account, err := checkinAccount(tx, userID, now)
		if err != nil {
			return err
		}
		config, err := readCheckinConfiguration(tx)
		if err != nil {
			return err
		}
		var user User
		if err := tx.Select("id", "created_at").First(&user, userID).Error; err != nil {
			return err
		}
		result, err = evaluateCheckin(tx, &user, account, config, time.Now())
		return err
	})
	return result, err
}

// CheckinRestrictedError carries the same decision used by the status endpoint.
type CheckinRestrictedError struct{ Eligibility *CheckinEligibility }

func (e *CheckinRestrictedError) Error() string { return "Check-in reward is currently restricted" }
