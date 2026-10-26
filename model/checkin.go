package model

import (
	"errors"
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Checkin 签到记录
type Checkin struct {
	Mode          int    `json:"mode"`
	RewardPercent int    `json:"reward_percent"`
	Policy        string `json:"-" gorm:"type:text"`
	Id            int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId        int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate   string `json:"checkin_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"` // 格式: YYYY-MM-DD
	QuotaAwarded  int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
}

// CheckinRecord 用于API返回的签到记录（不包含敏感字段）
type CheckinRecord struct {
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
}

func (Checkin) TableName() string {
	return "checkins"
}

// GetUserCheckinRecords 获取用户在指定日期范围内的签到记录
func GetUserCheckinRecords(userId int, startDate, endDate string) ([]Checkin, error) {
	var records []Checkin
	err := DB.Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?",
		userId, startDate, endDate).
		Order("checkin_date DESC").
		Find(&records).Error
	return records, err
}

// HasCheckedInToday 检查用户今天是否已签到
func HasCheckedInToday(userId int) (bool, error) {
	today := time.Now().Format("2006-01-02")
	var count int64
	err := DB.Model(&Checkin{}).
		Where("user_id = ? AND checkin_date = ?", userId, today).
		Count(&count).Error
	return count > 0, err
}

// UserCheckin atomically records and credits a daily reward on every dialect.
func UserCheckin(userId int) (*Checkin, error) {
	now := time.Now()
	var record *Checkin
	expiring := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		account, err := checkinAccount(tx, userId, now)
		if err != nil {
			return err
		}
		config, err := readCheckinConfiguration(tx)
		if err != nil {
			return err
		}
		settings := config.Settings
		expiring = settings.Mode == 2
		if !settings.Enabled {
			return errors.New("签到功能未启用")
		}
		now = time.Now()
		var user User
		if err := tx.Select("id", "created_at").First(&user, userId).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&Checkin{}).Where("user_id = ? AND checkin_date = ?", userId, now.Format("2006-01-02")).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errors.New("今日已签到")
		}
		eligibility, err := evaluateCheckin(tx, &user, account, config, now)
		if err != nil {
			return err
		}
		if !eligibility.Allowed {
			return &CheckinRestrictedError{Eligibility: eligibility}
		}
		base := settings.MinQuota
		if settings.MaxQuota > base {
			base += int(rand.Int63n(int64(settings.MaxQuota) - int64(base) + 1))
		}
		awarded := checkinReward(base, eligibility)
		if awarded == 0 {
			return &CheckinRestrictedError{Eligibility: eligibility}
		}
		policy, err := common.Marshal(CheckinRewardSnapshot{Configuration: config, Eligibility: *eligibility, BaseQuota: base})
		if err != nil {
			return err
		}
		record = &Checkin{UserId: userId, CheckinDate: eligibility.Today, QuotaAwarded: awarded, CreatedAt: now.Unix(), RewardPercent: int(eligibility.RewardPercent), Policy: string(policy)}
		record.Mode = max(settings.Mode, 1)
		if err := tx.Create(record).Error; err != nil {
			return err
		}
		if settings.Mode == 2 {
			return tx.Create(&CheckinGrant{CheckinID: record.Id, UserID: userId, Quota: awarded, Remaining: awarded, CreatedAt: now.Unix(), ExpiresAt: now.Unix() + int64(settings.ExpirySeconds)}).Error
		}
		if awarded > 0 {
			result := tx.Model(&User{}).Where("id = ? AND quota <= ?", userId, common.MaxWalletQuota-awarded).Update("quota", gorm.Expr("quota + ?", awarded))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrWalletQuotaLimitExceeded
			}
			if account.GiftRemaining > int64(common.MaxWalletQuota)-int64(awarded) {
				return ErrWalletQuotaLimitExceeded
			}
			if err := tx.Model(account).Update("gift_remaining", account.GiftRemaining+int64(awarded)).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !expiring {
		syncCreditUserQuotaCache(userId, record.QuotaAwarded, "check-in")
	}
	return record, nil
}

// GetUserCheckinStats 获取用户签到统计信息
func GetUserCheckinStats(userId int, month string) (map[string]any, error) {
	// 获取指定月份的所有签到记录
	startDate := month + "-01"
	endDate := month + "-31"

	records, err := GetUserCheckinRecords(userId, startDate, endDate)
	if err != nil {
		return nil, err
	}

	// 转换为不包含敏感字段的记录
	checkinRecords := make([]CheckinRecord, len(records))
	for i, r := range records {
		checkinRecords[i] = CheckinRecord{
			CheckinDate:  r.CheckinDate,
			QuotaAwarded: r.QuotaAwarded,
		}
	}

	// 检查今天是否已签到
	hasCheckedToday, err := HasCheckedInToday(userId)
	if err != nil {
		return nil, err
	}

	// 获取用户所有时间的签到统计
	var totalCheckins int64
	var totalQuota int64
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Count(&totalCheckins).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&totalQuota).Error; err != nil {
		return nil, err
	}

	return map[string]any{
		"total_quota":      totalQuota,      // 所有时间累计获得的额度
		"total_checkins":   totalCheckins,   // 所有时间累计签到次数
		"checkin_count":    len(records),    // 本月签到次数
		"checked_in_today": hasCheckedToday, // 今天是否已签到
		"records":          checkinRecords,  // 本月签到记录详情（不含id和user_id）
	}, nil
}
