package operation_setting

import (
	"fmt"
	"regexp"
	"strings"
	"time"

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
	Mode          int                `json:"mode"` // 0 is the legacy activity mode (1).
	ExpirySeconds int                `json:"expiry_seconds"`
	Limits        CheckinLimits      `json:"limits"`
	Enabled       bool               `json:"enabled"`   // 是否启用签到功能
	MinQuota      int                `json:"min_quota"` // 签到最小额度奖励
	MaxQuota      int                `json:"max_quota"` // 签到最大额度奖励
	Pool          CheckinPoolSetting `json:"pool"`
}

type CheckinRewardTier struct {
	Key           string `json:"key"`
	Name          string `json:"name"`
	MinQuota      int    `json:"min_quota"`
	MaxQuota      int    `json:"max_quota"`
	WeightBps     int    `json:"weight_bps"`
	DailyMaxCount int    `json:"daily_max_count"`
}
type CheckinTimeSlotWeight struct {
	TierKey   string `json:"tier_key"`
	WeightBps int    `json:"weight_bps"`
}
type CheckinTimeSlot struct {
	Key           string                  `json:"key"`
	Name          string                  `json:"name"`
	StartMinute   int                     `json:"start_minute"`
	EndMinute     int                     `json:"end_minute"`
	QuotaBps      int                     `json:"quota_bps"`
	OverrideTiers bool                    `json:"override_tiers"`
	TierWeights   []CheckinTimeSlotWeight `json:"tier_weights"`
}
type CheckinDailyPoolConfig struct {
	Enabled       bool  `json:"enabled"`
	DailyBonusCap int64 `json:"daily_bonus_cap"`
}
type CheckinLeaderboardConfig struct {
	Enabled            bool `json:"enabled"`
	TopN               int  `json:"top_n"`
	MaskUsername       bool `json:"mask_username"`
	ShowMyRank         bool `json:"show_my_rank"`
	ShowRecentJackpots bool `json:"show_recent_jackpots"`
}
type CheckinPoolSetting struct {
	RewardMode          string                   `json:"reward_mode"`
	Timezone            string                   `json:"timezone"`
	StatsRetentionDays  int                      `json:"stats_retention_days"`
	Tiers               []CheckinRewardTier      `json:"tiers"`
	TimeSlotsEnabled    bool                     `json:"time_slots_enabled"`
	DefaultSlotQuotaBps int                      `json:"default_slot_quota_bps"`
	TimeSlots           []CheckinTimeSlot        `json:"time_slots"`
	DailyPool           CheckinDailyPoolConfig   `json:"daily_pool"`
	Leaderboard         CheckinLeaderboardConfig `json:"leaderboard"`
}

var checkinTierKey = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

func (s *CheckinSetting) Normalize() {
	if s.Pool.Tiers == nil {
		s.Pool.Tiers = []CheckinRewardTier{}
	}
	if s.Pool.TimeSlots == nil {
		s.Pool.TimeSlots = []CheckinTimeSlot{}
	}
	for i := range s.Pool.TimeSlots {
		if s.Pool.TimeSlots[i].TierWeights == nil {
			s.Pool.TimeSlots[i].TierWeights = []CheckinTimeSlotWeight{}
		}
	}
	if s.Pool.RewardMode == "" {
		s.Pool.RewardMode = "uniform"
		if s.Pool.Timezone == "" {
			s.Pool.Timezone = time.Local.String()
		}
	}
	if s.Pool.StatsRetentionDays == 0 {
		s.Pool.StatsRetentionDays = 30
	}
	if s.Pool.DefaultSlotQuotaBps == 0 {
		s.Pool.DefaultSlotQuotaBps = 10000
	}
	if s.Pool.Leaderboard.TopN == 0 {
		s.Pool.Leaderboard.TopN = 20
		if !s.Pool.Leaderboard.Enabled {
			s.Pool.Leaderboard.MaskUsername = true
			s.Pool.Leaderboard.ShowMyRank = true
			s.Pool.Leaderboard.ShowRecentJackpots = true
		}
	}
	if s.Pool.Timezone == "" {
		s.Pool.Timezone = "Asia/Shanghai"
	}
	if s.Pool.RewardMode == "tiered" && len(s.Pool.Tiers) > 0 {
		minimum := s.Pool.Tiers[0].MinQuota
		for _, tier := range s.Pool.Tiers[1:] {
			minimum = min(minimum, tier.MinQuota)
		}
		s.MinQuota = minimum
	}
}

func (p CheckinPoolSetting) Validate(settings CheckinSetting) error {
	if p.RewardMode != "uniform" && p.RewardMode != "tiered" {
		return fmt.Errorf("Invalid check-in reward mode")
	}
	if p.StatsRetentionDays < 1 || p.StatsRetentionDays > 30 {
		return fmt.Errorf("Check-in statistics retention must be between 1 and 30 days")
	}
	if p.Timezone != "" {
		if _, err := time.LoadLocation(p.Timezone); err != nil {
			return fmt.Errorf("Invalid check-in timezone")
		}
	}
	if p.Leaderboard.TopN < 5 || p.Leaderboard.TopN > 50 {
		return fmt.Errorf("Check-in leaderboard size must be between 5 and 50")
	}
	if p.RewardMode == "tiered" {
		if len(p.Tiers) < 2 || len(p.Tiers) > 6 {
			return fmt.Errorf("Check-in reward pool requires 2 to 6 tiers")
		}
		seen := make(map[string]bool, len(p.Tiers))
		total := 0
		for i, tier := range p.Tiers {
			if !checkinTierKey.MatchString(tier.Key) || seen[tier.Key] || strings.TrimSpace(tier.Name) == "" || len([]rune(tier.Name)) > 32 {
				return fmt.Errorf("Invalid check-in reward tier")
			}
			seen[tier.Key] = true
			if tier.MinQuota < 0 || tier.MaxQuota < tier.MinQuota || tier.MaxQuota > settings.MaxQuota || tier.WeightBps < 0 || tier.WeightBps > 10000 || tier.DailyMaxCount < 0 {
				return fmt.Errorf("Invalid check-in reward tier range")
			}
			if i == 0 && tier.DailyMaxCount != 0 {
				return fmt.Errorf("The fallback check-in tier cannot have a daily limit")
			}
			total += tier.WeightBps
		}
		if total != 10000 {
			return fmt.Errorf("Check-in reward tier probabilities must total 100%%")
		}
	}
	if p.TimeSlotsEnabled {
		if len(p.TimeSlots) < 1 || len(p.TimeSlots) > 8 || p.DefaultSlotQuotaBps < 1000 || p.DefaultSlotQuotaBps > 50000 {
			return fmt.Errorf("Invalid check-in time slot settings")
		}
		slots := append([]CheckinTimeSlot(nil), p.TimeSlots...)
		slotKeys := make(map[string]bool, len(slots))
		knownTiers := make(map[string]bool, len(p.Tiers))
		for _, tier := range p.Tiers {
			knownTiers[tier.Key] = true
		}
		for _, slot := range slots {
			if !checkinTierKey.MatchString(slot.Key) || slotKeys[slot.Key] || strings.TrimSpace(slot.Name) == "" || len([]rune(slot.Name)) > 32 || slot.StartMinute < 0 || slot.StartMinute >= 1440 || slot.EndMinute <= slot.StartMinute || slot.EndMinute > 1440 || slot.QuotaBps < 1000 || slot.QuotaBps > 50000 {
				return fmt.Errorf("Invalid check-in time slot")
			}
			slotKeys[slot.Key] = true
			if slot.OverrideTiers {
				if p.RewardMode != "tiered" || len(slot.TierWeights) != len(p.Tiers) {
					return fmt.Errorf("Invalid check-in time slot tier weights")
				}
				tierKeys := make(map[string]bool, len(slot.TierWeights))
				total := 0
				for _, weight := range slot.TierWeights {
					if weight.WeightBps < 0 || weight.WeightBps > 10000 || tierKeys[weight.TierKey] {
						return fmt.Errorf("Invalid check-in time slot tier weights")
					}
					if !knownTiers[weight.TierKey] {
						return fmt.Errorf("Invalid check-in time slot tier weights")
					}
					tierKeys[weight.TierKey] = true
					total += weight.WeightBps
				}
				if total != 10000 {
					return fmt.Errorf("Check-in time slot probabilities must total 100%%")
				}
			}
		}
		for i, slot := range slots {
			for _, other := range slots[i+1:] {
				if slot.StartMinute < other.EndMinute && other.StartMinute < slot.EndMinute {
					return fmt.Errorf("Check-in time slots must not overlap")
				}
			}
		}
	}
	if p.DailyPool.DailyBonusCap < 0 || p.DailyPool.DailyBonusCap > int64(common.MaxWalletQuota) {
		return fmt.Errorf("Invalid check-in daily pool cap")
	}
	return nil
}

func (s CheckinSetting) Validate() error {
	s.Normalize()
	if s.Mode < 0 || s.Mode > 2 {
		return fmt.Errorf("Invalid check-in mode")
	}
	if s.ExpirySeconds < 0 || s.ExpirySeconds > 365*86400 || s.Mode == 2 && s.ExpirySeconds < 60 {
		return fmt.Errorf("Check-in validity must be between 1 minute and 365 days")
	}
	if s.MinQuota < 0 || s.MaxQuota < s.MinQuota || s.MaxQuota > common.MaxQuota {
		return fmt.Errorf("Invalid check-in reward range")
	}
	if err := s.Pool.Validate(s); err != nil {
		return err
	}
	if s.Mode == 2 {
		return nil
	}
	return s.Limits.Validate()
}

// 默认配置
var checkinSetting = CheckinSetting{
	Mode: 1, ExpirySeconds: 86400,
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
