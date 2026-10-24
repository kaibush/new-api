package operation_setting

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// CheckinLimits is stored as one option so related limits change atomically.
type CheckinLimits struct {
	Enabled        bool `json:"enabled"`
	GiftCap        int  `json:"gift_cap"` // Deprecated, accepted for compatibility; not enforced.
	MonthlyCap     int  `json:"monthly_cap"`
	ActivityDays   int  `json:"activity_days"`
	MinimumSpend   int  `json:"minimum_spend"`
	ReducedPercent int  `json:"reduced_percent"`
	NewUserDays    int  `json:"new_user_days"`
}

func (s CheckinLimits) Validate() error {
	if s.MonthlyCap < 0 || s.MonthlyCap > common.MaxQuota || s.MinimumSpend < 0 || s.MinimumSpend > common.MaxQuota {
		return fmt.Errorf("Check-in quota limits must be between 0 and %d", common.MaxQuota)
	}
	if s.ActivityDays < 1 || s.ActivityDays > 365 || s.NewUserDays < 0 || s.NewUserDays > 365 || s.ReducedPercent < 0 || s.ReducedPercent > 100 {
		return fmt.Errorf("Invalid check-in activity window or reward percentage")
	}
	if s.Enabled && s.MonthlyCap == 0 {
		return fmt.Errorf("Enabled check-in limits require a positive monthly cap")
	}
	return nil
}

// CheckinSetting 签到功能配置
type CheckinSetting struct {
	Limits   CheckinLimits `json:"limits"`
	Enabled  bool          `json:"enabled"`   // 是否启用签到功能
	MinQuota int           `json:"min_quota"` // 签到最小额度奖励
	MaxQuota int           `json:"max_quota"` // 签到最大额度奖励
}

func (s CheckinSetting) Validate() error {
	if s.MinQuota < 0 || s.MaxQuota < s.MinQuota || s.MaxQuota > common.MaxQuota {
		return fmt.Errorf("Invalid check-in reward range")
	}
	return s.Limits.Validate()
}

// 默认配置
var checkinSetting = CheckinSetting{
	Limits:   CheckinLimits{MonthlyCap: 300000, ActivityDays: 30, MinimumSpend: 50000, ReducedPercent: 20, NewUserDays: 7},
	Enabled:  false, // 默认关闭
	MinQuota: 1000,  // 默认最小额度 1000 (约 0.002 USD)
	MaxQuota: 10000, // 默认最大额度 10000 (约 0.02 USD)
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("checkin_setting", &checkinSetting)
}

// GetCheckinSetting 获取签到配置
func GetCheckinSetting() *CheckinSetting {
	return &checkinSetting
}

// IsCheckinEnabled 是否启用签到功能
func IsCheckinEnabled() bool {
	return checkinSetting.Enabled
}

// GetCheckinQuotaRange 获取签到额度范围
func GetCheckinQuotaRange() (min, max int) {
	return checkinSetting.MinQuota, checkinSetting.MaxQuota
}
