package operation_setting

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckinPoolValidationAndNormalization(t *testing.T) {
	settings := CheckinSetting{Enabled: true, MinQuota: 15, MaxQuota: 60, Limits: CheckinLimits{MonthlyCap: 300, ActivityDays: 30, ReducedPercent: 20}}
	settings.Normalize()
	require.NoError(t, settings.Validate())
	assert.Equal(t, "uniform", settings.Pool.RewardMode)
	assert.Equal(t, 30, settings.Pool.StatsRetentionDays)
	assert.True(t, settings.Pool.Leaderboard.MaskUsername)
	assert.Equal(t, time.Local.String(), settings.Pool.Timezone, "upgrades preserve the legacy calendar day")

	settings.Pool.RewardMode = "tiered"
	settings.Pool.Tiers = []CheckinRewardTier{
		{Key: "base", Name: "Base", MinQuota: 6, MaxQuota: 10, WeightBps: 8000},
		{Key: "jackpot", Name: "Jackpot", MinQuota: 36, MaxQuota: 60, WeightBps: 2000},
	}
	settings.Normalize()
	assert.Equal(t, 6, settings.MinQuota)
	require.NoError(t, settings.Validate())
	settings.Pool.Tiers[1].WeightBps = 1999
	assert.Error(t, settings.Validate())
}

func TestCheckinPoolRejectsInvalidBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name string
		pool CheckinPoolSetting
	}{
		{"retention_above_30", CheckinPoolSetting{StatsRetentionDays: 31}},
		{"negative_retention", CheckinPoolSetting{StatsRetentionDays: -1}},
		{"unknown_timezone", CheckinPoolSetting{Timezone: "Unknown/City"}},
		{"oversized_budget", CheckinPoolSetting{DailyPool: CheckinDailyPoolConfig{DailyBonusCap: int64(common.MaxWalletQuota) + 1}}},
		{"negative_budget", CheckinPoolSetting{DailyPool: CheckinDailyPoolConfig{DailyBonusCap: -1}}},
		{"oversized_leaderboard", CheckinPoolSetting{Leaderboard: CheckinLeaderboardConfig{TopN: 51}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := CheckinSetting{Mode: 2, ExpirySeconds: 3600, MaxQuota: 100, Pool: tc.pool}
			assert.Error(t, settings.Validate())
		})
	}
}

func TestCheckinPoolRejectsOverlappingTimeSlots(t *testing.T) {
	settings := CheckinSetting{Enabled: true, MinQuota: 1, MaxQuota: 100, Limits: CheckinLimits{MonthlyCap: 100, ActivityDays: 30, ReducedPercent: 20}}
	settings.Normalize()
	settings.Pool.TimeSlotsEnabled = true
	settings.Pool.TimeSlots = []CheckinTimeSlot{
		{Key: "morning", Name: "Morning", StartMinute: 360, EndMinute: 600, QuotaBps: 10000},
		{Key: "day", Name: "Day", StartMinute: 599, EndMinute: 720, QuotaBps: 10000},
	}
	assert.Error(t, settings.Validate())
}
