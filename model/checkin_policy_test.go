package model

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Schema from v1.0.0-rc.42:model/checkin.go, retained to exercise upgrades.
type releasedCheckin struct {
	Id           int    `gorm:"primaryKey;autoIncrement"`
	UserId       int    `gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate  string `gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"`
	QuotaAwarded int    `gorm:"not null"`
	CreatedAt    int64  `gorm:"bigint"`
}

func (releasedCheckin) TableName() string { return "checkins" }

type checkinTestUser struct {
	Id          int `gorm:"primaryKey"`
	Username    string
	DisplayName string
	Quota       int64
	CreatedAt   int64
	DeletedAt   gorm.DeletedAt
}

func (checkinTestUser) TableName() string { return "users" }

func TestCheckinPolicyDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "checkin.db") + "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)

			previousDB, previousRedis := DB, common.RedisEnabled
			previousKind := common.MainDatabaseType()
			previousSettings := *operation_setting.GetCheckinSetting()
			DB, common.RedisEnabled = db, false
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			t.Cleanup(func() {
				DB, common.RedisEnabled = previousDB, previousRedis
				common.SetMainDatabaseType(previousKind)
				*operation_setting.GetCheckinSetting() = previousSettings
				require.NoError(t, sqlDB.Close())
			})
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				name := "fresh"
				if upgrade {
					name = "upgrade_rc42"
				}
				t.Run(name, func(t *testing.T) {
					// Each scenario represents a separate application startup. Do not
					// reuse PostgreSQL prepared plans after replacing the schema.
					require.NoError(t, sqlDB.Close())
					db, err = gorm.Open(driver, &gorm.Config{})
					require.NoError(t, err)
					sqlDB, err = db.DB()
					require.NoError(t, err)
					sqlDB.SetMaxOpenConns(4)
					DB = db
					require.NoError(t, db.Migrator().DropTable(&Task{}, &CheckinGrant{}, &CheckinFunding{}, &CheckinUsageDay{}, &CheckinPolicyState{}, &Option{}, &CheckinUsage{}, &CheckinAccount{}, &Checkin{}, &checkinTestUser{}))
					t.Cleanup(func() {
						require.NoError(t, db.Migrator().DropTable(&Task{}, &CheckinGrant{}, &CheckinFunding{}, &CheckinUsageDay{}, &CheckinPolicyState{}, &Option{}, &CheckinUsage{}, &CheckinAccount{}, &Checkin{}, &checkinTestUser{}))
					})
					require.NoError(t, db.AutoMigrate(&checkinTestUser{}, &Option{}))
					if upgrade {
						require.NoError(t, db.AutoMigrate(&releasedCheckin{}))
						require.NoError(t, db.Create(&releasedCheckin{UserId: 99, CheckinDate: "2025-01-01", QuotaAwarded: 123, CreatedAt: 1}).Error)
						require.NoError(t, db.AutoMigrate(&CheckinAccount{}, &CheckinUsage{}))
						require.NoError(t, db.Create(&CheckinAccount{UserID: 99, ObservedSince: 1, GiftRemaining: 123}).Error)
						require.NoError(t, db.Create(&CheckinUsage{UserID: 99, SourceKey: "released-journal", CreatedAt: 86401, Quota: 42}).Error)
						require.NoError(t, db.Create(&CheckinUsage{UserID: 99, SourceKey: "released-pending", CreatedAt: 86402, Quota: 99, Pending: true}).Error)
						require.NoError(t, db.Create(&Option{Key: "checkin_setting.min_quota", Value: "1234"}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&Task{}, &CheckinGrant{}, &CheckinFunding{}, &Checkin{}, &CheckinAccount{}, &CheckinUsage{}, &CheckinUsageDay{}, &CheckinPolicyState{}))
						require.NoError(t, InitializeCheckinAccounting())
					}
					if upgrade {
						var old Checkin
						require.NoError(t, db.Where("user_id = ?", 99).First(&old).Error)
						assert.Equal(t, 123, old.QuotaAwarded)
						var migrated CheckinUsageDay
						require.NoError(t, db.First(&migrated, "user_id = ?", 99).Error)
						assert.Equal(t, int64(42), migrated.Quota, "backfill excludes pending usage and is idempotent")
						config, err := CurrentCheckinConfiguration()
						require.NoError(t, err)
						assert.Equal(t, 1234, config.Settings.MinQuota)
						assert.Error(t, db.Create(&CheckinUsage{UserID: 99, SourceKey: "released-journal", CreatedAt: 86401}).Error)
						assert.Error(t, db.Create(&CheckinUsageDay{UserID: 99, Day: 86400}).Error)
						assert.Error(t, db.Create(&Checkin{UserId: 99, CheckinDate: "2025-01-01"}).Error)
					}
					t.Run("expiring_rewards", func(t *testing.T) { verifyExpiringCheckinFunding(t, db) })
					now := time.Now()
					require.NoError(t, db.Model(&CheckinPolicyState{}).Where("id = ?", 1).Update("observed_since", now.AddDate(-2, 0, 0).Unix()).Error)
					user := checkinTestUser{Id: 1, Quota: 1000000, CreatedAt: now.Unix()}
					require.NoError(t, db.Create(&user).Error)
					settings := operation_setting.CheckinSetting{Enabled: true, MinQuota: 100, MaxQuota: 100, Limits: operation_setting.CheckinLimits{GiftCap: 150, MonthlyCap: 150, ActivityDays: 30, MinimumSpend: 100, ReducedPercent: 20, NewUserDays: 7}}
					saveCheckinTestSettings(t, settings)
					record, err := UserCheckin(1)
					require.NoError(t, err)
					assert.Equal(t, 100, record.QuotaAwarded)
					_, err = UserCheckin(1)
					require.Error(t, err)
					settings.Limits.Enabled = true
					saveCheckinTestSettings(t, settings)
					decision, err := GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.True(t, decision.Allowed, "large purchased balance does not restrict rewards")
					assert.Equal(t, int64(100), decision.GiftRemaining)
					assert.Equal(t, 50, decision.MaxQuota, "monthly cap clips the reward")
					assert.Contains(t, decision.Reasons, "new_user_grace")

					user.CreatedAt = now.AddDate(0, 0, -60).Unix()
					require.NoError(t, db.Model(&user).Update("created_at", user.CreatedAt).Error)
					require.NoError(t, BeginCheckinUsage(1, "request:wallet", true))
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.False(t, decision.Allowed)
					assert.Contains(t, decision.Reasons, "accounting_pending")
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 70))
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 70))
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Equal(t, int64(30), decision.GiftRemaining)
					assert.Equal(t, int64(70), decision.RecentSpend)
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 20))
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Equal(t, int64(80), decision.GiftRemaining, "refund restores original gift source")
					require.NoError(t, BeginCheckinUsage(1, "request:subscription", false))
					require.NoError(t, CompleteCheckinUsage(1, "request:subscription", 80))
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Equal(t, int64(80), decision.GiftRemaining)
					assert.Equal(t, int64(100), decision.RecentSpend)
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 200))
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 150))
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Zero(t, decision.GiftRemaining, "partial refund restores paid quota before gift quota")
					require.NoError(t, CompleteCheckinUsage(1, "request:wallet", 0))
					require.NoError(t, CompleteCheckinUsage(1, "request:subscription", 0))
					require.NoError(t, db.Model(&CheckinAccount{}).Where("user_id = ?", 1).Update("observed_since", now.AddDate(0, 0, -31).Unix()).Error)
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Equal(t, 20, decision.MaxQuota)
					assert.Contains(t, decision.Reasons, "low_activity")
					settings.Limits.ReducedPercent = 0
					saveCheckinTestSettings(t, settings)
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.False(t, decision.Allowed)
					settings.Limits.ReducedPercent = 100
					saveCheckinTestSettings(t, settings)
					// Move the successful claim to yesterday; a rejected attempt has no record.
					require.NoError(t, db.Model(record).Update("checkin_date", now.AddDate(0, 0, -1).Format("2006-01-02")).Error)
					var wg sync.WaitGroup
					results := make(chan error, 2)
					for range 2 {
						wg.Go(func() { _, err := UserCheckin(1); results <- err })
					}
					wg.Wait()
					close(results)
					successes := 0
					for err := range results {
						if err == nil {
							successes++
						}
					}
					assert.Equal(t, 1, successes)
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.Contains(t, decision.Reasons, "monthly_cap")
					assert.False(t, decision.Allowed)
					// Calendar-month reset allows rewards even with accumulated gifts.
					var account CheckinAccount
					require.NoError(t, db.First(&account, "user_id = ?", 1).Error)
					next := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, now.Location())
					future, err := evaluateTestCheckin(t, db, &User{Id: 1, CreatedAt: user.CreatedAt}, &account, settings, settings.Limits, next)
					require.NoError(t, err)
					assert.Zero(t, future.MonthlyAwarded)
					require.NoError(t, db.Create(&checkinTestUser{Id: 2, Quota: int64(common.MaxWalletQuota), CreatedAt: now.Unix()}).Error)
					_, err = UserCheckin(2)
					require.ErrorIs(t, err, ErrWalletQuotaLimitExceeded)
					var rejected int64
					require.NoError(t, db.Model(&Checkin{}).Where("user_id = ?", 2).Count(&rejected).Error)
					assert.Zero(t, rejected, "failed credit must not consume today's claim")
					require.NoError(t, db.Create(&checkinTestUser{Id: 3, Quota: 1000000, CreatedAt: now.Unix()}).Error)
					require.NoError(t, db.Create(&Checkin{UserId: 3, CheckinDate: now.Format("2006-01-02"), QuotaAwarded: settings.Limits.MonthlyCap}).Error)
					capped, err := GetCheckinEligibility(3)
					require.NoError(t, err)
					assert.Contains(t, capped.Reasons, "monthly_cap")
					assert.False(t, capped.Allowed)

					settings.Limits.Enabled = false
					saveCheckinTestSettings(t, settings)
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.True(t, decision.Allowed)
					assert.Equal(t, 100, decision.MaxQuota)

					t.Run("activity_analytics", func(t *testing.T) { verifyCheckinActivity(t, db, now); saveCheckinTestSettings(t, settings) })

					t.Run("topup_does_not_change_checkin_policy", func(t *testing.T) {
						policy := operation_setting.CheckinSetting{Enabled: true, MinQuota: 3500, MaxQuota: 3500, Limits: operation_setting.CheckinLimits{Enabled: true, GiftCap: 1000, MonthlyCap: 60000, ActivityDays: 15, MinimumSpend: 10000, ReducedPercent: 10, NewUserDays: 5}}
						saveCheckinTestSettings(t, policy)
						defer func() { saveCheckinTestSettings(t, settings) }()
						for i, tc := range []struct {
							name       string
							ageDays    int
							spend      int64
							monthAward int
							wantReward int
						}{
							{"registration_grace", 0, 0, 0, 3500},
							{"active_user", 60, 10000, 0, 3500},
							{"inactive_user", 60, 0, 0, 350},
							{"monthly_cap_reached", 60, 10000, 60000, 0},
						} {
							t.Run(tc.name, func(t *testing.T) {
								userID := 30 + i
								user := checkinTestUser{Id: userID, Quota: 25000, CreatedAt: now.AddDate(0, 0, -tc.ageDays).Unix()}
								require.NoError(t, db.Create(&user).Error)
								require.NoError(t, db.Create(&CheckinUsage{UserID: userID, SourceKey: "previous_api_spend", CreatedAt: now.Unix(), Quota: tc.spend}).Error)
								if tc.monthAward > 0 {
									require.NoError(t, db.Create(&Checkin{UserId: userID, CheckinDate: now.Format("2006-01-02"), QuotaAwarded: tc.monthAward}).Error)
								}
								before, err := GetCheckinEligibility(userID)
								require.NoError(t, err)
								assert.Equal(t, tc.wantReward, before.MaxQuota)
								assert.Equal(t, tc.wantReward > 0, before.Allowed)
								// Exercise the actual wallet-credit function used by payment settlement.
								const purchasedQuota = 50000000
								require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
									return creditTopUpQuota(tx, userID, purchasedQuota, nil)
								}))
								after, err := GetCheckinEligibility(userID)
								require.NoError(t, err)
								before.AsOf, before.WindowStart = after.AsOf, after.WindowStart
								assert.Equal(t, before, after, "top-up changes neither activity, gift balance, monthly rewards nor eligibility")
								require.NoError(t, db.First(&user, userID).Error)
								assert.Equal(t, int64(25000+purchasedQuota), user.Quota)
								if !after.Allowed {
									assert.Contains(t, after.Reasons, "monthly_cap")
									return
								}
								record, err := UserCheckin(userID)
								require.NoError(t, err)
								assert.Equal(t, tc.wantReward, record.QuotaAwarded)
								beforeSecondTopup, err := GetCheckinEligibility(userID)
								require.NoError(t, err)
								require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
									return creditTopUpQuota(tx, userID, purchasedQuota, nil)
								}))
								afterSecondTopup, err := GetCheckinEligibility(userID)
								require.NoError(t, err)
								beforeSecondTopup.AsOf, beforeSecondTopup.WindowStart = afterSecondTopup.AsOf, afterSecondTopup.WindowStart
								assert.Equal(t, beforeSecondTopup, afterSecondTopup)
								_, err = UserCheckin(userID)
								require.EqualError(t, err, "今日已签到")
								var claims []Checkin
								require.NoError(t, db.Where("user_id = ?", userID).Find(&claims).Error)
								require.Len(t, claims, 1)
								assert.Equal(t, tc.wantReward, claims[0].QuotaAwarded)
								require.NoError(t, db.First(&user, userID).Error)
								assert.Equal(t, int64(25000+2*purchasedQuota+tc.wantReward), user.Quota)
							})
						}
					})

					t.Run("rolling_activity_lifecycle", func(t *testing.T) {
						at := time.Now().Truncate(time.Second)
						policy := operation_setting.CheckinSetting{Enabled: true, MinQuota: 3500, MaxQuota: 3500, Limits: operation_setting.CheckinLimits{Enabled: true, MonthlyCap: 60000, ActivityDays: 15, MinimumSpend: 10000, ReducedPercent: 10, NewUserDays: 5}}
						saveCheckinTestSettings(t, policy)
						defer func() { saveCheckinTestSettings(t, settings) }()
						for _, alreadyClaimed := range []bool{true, false} {
							name, userID := "already_claimed_today", 20
							if !alreadyClaimed {
								name, userID = "not_claimed_today", 21
							}
							t.Run(name, func(t *testing.T) {
								user := checkinTestUser{Id: userID, Quota: 1000000, CreatedAt: at.AddDate(0, 0, -90).Unix()}
								require.NoError(t, db.Create(&user).Error)
								// A large historical spend must not make the user permanently active.
								require.NoError(t, db.Create(&CheckinUsage{UserID: userID, SourceKey: "old_consumption", CreatedAt: at.AddDate(0, 0, -45).Unix(), Quota: 100000}).Error)
								decision, err := GetCheckinEligibility(userID)
								require.NoError(t, err)
								assert.Zero(t, decision.RecentSpend)
								assert.Equal(t, 350, decision.MaxQuota)
								assert.Contains(t, decision.Reasons, "low_activity")
								if alreadyClaimed {
									record, err := UserCheckin(userID)
									require.NoError(t, err)
									assert.Equal(t, 350, record.QuotaAwarded)
								}
								require.NoError(t, BeginCheckinUsage(userID, "returning_request", false))
								require.NoError(t, CompleteCheckinUsage(userID, "returning_request", 9999))
								decision, err = GetCheckinEligibility(userID)
								require.NoError(t, err)
								assert.Equal(t, int64(9999), decision.RecentSpend)
								assert.Equal(t, 3499, decision.MaxQuota)
								require.NoError(t, CompleteCheckinUsage(userID, "returning_request", 10000))
								decision, err = GetCheckinEligibility(userID)
								require.NoError(t, err)
								assert.Equal(t, int64(10000), decision.RecentSpend)
								assert.Equal(t, 3500, decision.MaxQuota)
								assert.Equal(t, 100.0, decision.RewardPercent)
								assert.NotContains(t, decision.Reasons, "low_activity")
								record, err := UserCheckin(userID)
								wantAward := 3500
								if alreadyClaimed {
									require.EqualError(t, err, "今日已签到")
									wantAward = 350
								} else {
									require.NoError(t, err)
									assert.Equal(t, 3500, record.QuotaAwarded)
								}
								var claims []Checkin
								require.NoError(t, db.Where("user_id = ?", userID).Find(&claims).Error)
								require.Len(t, claims, 1, "activity recovery must not issue a second reward or top-up")
								assert.Equal(t, wantAward, claims[0].QuotaAwarded)
								require.NoError(t, db.First(&user, userID).Error)
								assert.Equal(t, int64(1000000+wantAward), user.Quota)

								// Freeze the fixture timestamp, then advance the policy clock without sleeps.
								require.NoError(t, db.Model(&CheckinUsage{}).Where("user_id = ? AND created_at >= ?", userID, at.Unix()).Update("created_at", at.Unix()).Error)
								var account CheckinAccount
								require.NoError(t, db.First(&account, "user_id = ?", userID).Error)
								expires := at.AddDate(0, 0, 15)
								for _, step := range []struct {
									name       string
									time       time.Time
									wantSpend  int64
									wantReward int
								}{
									{"next_day_still_active", at.AddDate(0, 0, 1), 10000, 3500},
									{"last_second_before_window_boundary", expires.Add(-time.Second), 10000, 3500},
									{"inclusive_window_boundary", expires, 10000, 3500},
									{"consumption_leaves_window", expires.Add(time.Second), 0, 350},
								} {
									t.Run(step.name, func(t *testing.T) {
										result, err := evaluateTestCheckin(t, db, &User{Id: userID, CreatedAt: user.CreatedAt}, &account, policy, policy.Limits, step.time)
										require.NoError(t, err)
										assert.True(t, result.Allowed)
										assert.Equal(t, step.wantSpend, result.RecentSpend)
										assert.Equal(t, step.wantReward, result.MinQuota)
										assert.Equal(t, step.wantReward, result.MaxQuota)
									})
								}
								returned := expires.Add(time.Hour)
								require.NoError(t, db.Create(&CheckinUsage{UserID: userID, SourceKey: "second_return", CreatedAt: returned.Unix(), Quota: 10000}).Error)
								result, err := evaluateTestCheckin(t, db, &User{Id: userID, CreatedAt: user.CreatedAt}, &account, policy, policy.Limits, returned)
								require.NoError(t, err)
								assert.Equal(t, int64(10000), result.RecentSpend, "only the new consumption counts")
								assert.Equal(t, 3500, result.MaxQuota)
								assert.Equal(t, 100.0, result.RewardPercent)
							})
						}
					})

					t.Run("registration_grace_and_accumulation", func(t *testing.T) {
						registered := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
						policy := operation_setting.CheckinSetting{Enabled: true, MinQuota: 3500, MaxQuota: 3500, Limits: operation_setting.CheckinLimits{Enabled: true, GiftCap: 1000, MonthlyCap: 60000, ActivityDays: 15, MinimumSpend: 10000, ReducedPercent: 10, NewUserDays: 5}}
						newUser := User{Id: 10, CreatedAt: registered.Unix()}
						gifts := CheckinAccount{UserID: 10, ObservedSince: registered.Unix()}
						pending := CheckinUsage{UserID: 10, SourceKey: "pending_during_grace", CreatedAt: registered.Unix(), Pending: true}
						require.NoError(t, db.Create(&pending).Error)
						for day := range 5 {
							at := registered.AddDate(0, 0, day)
							result, err := evaluateTestCheckin(t, db, &newUser, &gifts, policy, policy.Limits, at)
							require.NoError(t, err)
							require.True(t, result.Allowed)
							assert.Equal(t, 3500, result.MinQuota)
							assert.Equal(t, 3500, result.MaxQuota)
							assert.Equal(t, 100.0, result.RewardPercent)
							assert.Contains(t, result.Reasons, "new_user_grace")
							require.NoError(t, db.Create(&Checkin{UserId: 10, CheckinDate: at.Format("2006-01-02"), QuotaAwarded: result.MaxQuota}).Error)
							gifts.GiftRemaining += int64(result.MaxQuota)
						}
						assert.Equal(t, int64(17500), gifts.GiftRemaining)
						require.NoError(t, db.Delete(&pending).Error)
						expires := registered.AddDate(0, 0, 5)
						// Recently initialized accounting must not extend registration grace.
						gifts.ObservedSince = expires.Unix()
						for _, tc := range []struct {
							name        string
							at          time.Time
							spend       int64
							monthlyCap  int
							percent     int
							want        int
							wantPercent float64
						}{
							{"last_protected_second", expires.Add(-time.Second), 0, 60000, 10, 3500, 100},
							{"sixth_day_low_activity", expires, 0, 60000, 10, 350, 10},
							{"active_at_threshold", expires, 10000, 60000, 10, 3500, 100},
							{"below_threshold", expires, 9999, 60000, 10, 3499, 99.99},
							{"monthly_clip_during_grace", expires.Add(-time.Second), 0, 17600, 10, 100, 100},
							{"monthly_exhausted_during_grace", expires.Add(-time.Second), 0, 17500, 10, 0, 100},
							{"monthly_clip_after_grace", expires, 0, 17600, 10, 100, 10},
							{"zero_percent_pauses", expires, 0, 60000, 0, 0, 0},
						} {
							t.Run(tc.name, func(t *testing.T) {
								entry := CheckinUsage{UserID: 10, SourceKey: tc.name, CreatedAt: registered.Unix(), Quota: tc.spend}
								require.NoError(t, db.Create(&entry).Error)
								limits := policy.Limits
								limits.MonthlyCap, limits.ReducedPercent = tc.monthlyCap, tc.percent
								result, err := evaluateTestCheckin(t, db, &newUser, &gifts, policy, limits, tc.at)
								require.NoError(t, err)
								assert.Equal(t, tc.want, result.MaxQuota)
								assert.Equal(t, tc.want, result.MinQuota)
								assert.Equal(t, tc.wantPercent, result.RewardPercent)
								assert.Equal(t, tc.want > 0, result.Allowed)
								assert.Equal(t, expires.Unix(), result.ObservationUntil)
								assert.NotContains(t, result.Reasons, "gift_cap")
								require.NoError(t, db.Delete(&entry).Error)
							})
						}
					})
				})
			}
		})
	}
}

func TestCheckinLimitsValidation(t *testing.T) {
	valid := operation_setting.CheckinLimits{Enabled: true, GiftCap: 100, MonthlyCap: 200, ActivityDays: 30, MinimumSpend: 100, ReducedPercent: 20, NewUserDays: 7}
	require.NoError(t, valid.Validate())
	valid.GiftCap = 0
	require.NoError(t, valid.Validate(), "obsolete gift cap is not required")
	for _, invalid := range []operation_setting.CheckinLimits{
		{Enabled: true, ActivityDays: 30},
		{ActivityDays: 0},
		{ActivityDays: 366},
		{ActivityDays: 30, ReducedPercent: 101},
		{ActivityDays: 30, MinimumSpend: -1},
	} {
		assert.Error(t, invalid.Validate())
	}
}

func saveCheckinTestSettings(t *testing.T, settings operation_setting.CheckinSetting) {
	t.Helper()
	config, err := CurrentCheckinConfiguration()
	require.NoError(t, err)
	_, err = UpdateCheckinConfiguration(settings, config.Version)
	require.NoError(t, err)
}

func evaluateTestCheckin(t *testing.T, db *gorm.DB, user *User, account *CheckinAccount, settings operation_setting.CheckinSetting, limits operation_setting.CheckinLimits, now time.Time) (*CheckinEligibility, error) {
	t.Helper()
	config, err := readCheckinConfiguration(db)
	require.NoError(t, err)
	settings.Limits = limits
	config.Settings = settings
	return evaluateCheckin(db, user, account, config, now)
}

func verifyCheckinActivity(t *testing.T, db *gorm.DB, now time.Time) {
	t.Helper()
	config, err := CurrentCheckinConfiguration()
	require.NoError(t, err)
	settings := config.Settings
	settings.Enabled = true
	settings.MinQuota, settings.MaxQuota = 100, 100
	settings.Limits = operation_setting.CheckinLimits{Enabled: true, MonthlyCap: 10000, ActivityDays: 30, MinimumSpend: 100, ReducedPercent: 20, NewUserDays: 7}
	saveCheckinTestSettings(t, settings)
	config, err = CurrentCheckinConfiguration()
	require.NoError(t, err)
	oldUser := User{Id: 500, Username: "activity-user", CreatedAt: now.AddDate(0, 0, -100).Unix()}
	account := CheckinAccount{UserID: 500, ObservedSince: oldUser.CreatedAt}
	for _, tc := range []struct {
		name      string
		spend     int64
		floor     int
		threshold int
		base      int
		want      int
		percent   float64
	}{
		{"zero_without_floor", 0, 0, 100, 100, 0, 0},
		{"zero_with_floor", 0, 20, 100, 100, 20, 20},
		{"below_floor", 10, 20, 100, 100, 20, 20},
		{"proportional", 60, 20, 100, 100, 60, 60},
		{"full", 100, 20, 100, 100, 100, 100},
		{"above_threshold", 200, 20, 100, 100, 100, 100},
		{"fraction_not_rounded_first", 1, 0, 3, 300, 100, 100.0 / 3},
		{"small_reward_rounds_down", 1, 0, 3, 2, 0, 100.0 / 3},
		{"no_threshold", 0, 0, 0, 100, 100, 100},
		{"maximum_safe_product", common.MaxQuota - 1, 0, common.MaxQuota, common.MaxQuota, 9999, float64(common.MaxQuota-1) * 100 / float64(common.MaxQuota)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policy := config
			policy.Settings.MinQuota, policy.Settings.MaxQuota = tc.base, tc.base
			policy.Settings.Limits.MinimumSpend, policy.Settings.Limits.ReducedPercent = tc.threshold, tc.floor
			e := calculateCheckin(&oldUser, &account, policy, checkinFacts{RecentSpend: tc.spend, MonthlyAwarded: 1}, now)
			assert.Equal(t, tc.want, checkinReward(tc.base, e))
			assert.InDelta(t, tc.percent, e.RewardPercent, 1e-10)
		})
	}

	t.Run("all_users_settlement_refund_and_snapshot", func(t *testing.T) {
		require.NoError(t, db.Create(&checkinTestUser{Id: 500, Username: "activity-user", CreatedAt: oldUser.CreatedAt, Quota: 1000}).Error)
		require.NoError(t, BeginCheckinUsage(500, "unopened-page", false))
		require.NoError(t, CompleteCheckinUsage(500, "unopened-page", 60))
		require.NoError(t, CompleteCheckinUsage(500, "unopened-page", 60))
		var dayTotal int64
		require.NoError(t, db.Model(&CheckinUsageDay{}).Where("user_id = ?", 500).Select("SUM(quota)").Scan(&dayTotal).Error)
		assert.Equal(t, int64(60), dayTotal)
		rows, err := checkinUserRows(db, []User{oldUser}, config, time.Now())
		require.NoError(t, err)
		assert.Equal(t, 60.0, rows[0].Eligibility.ActivityPercent)
		assert.Equal(t, 60, rows[0].Eligibility.MaxQuota)
		require.NoError(t, BeginCheckinUsage(500, "unopened-page", false))
		pending, err := GetCheckinEligibility(500)
		require.NoError(t, err)
		assert.False(t, pending.Allowed)
		require.NoError(t, CompleteCheckinUsage(500, "unopened-page", 30))
		require.NoError(t, db.Model(&CheckinUsageDay{}).Where("user_id = ?", 500).Select("SUM(quota)").Scan(&dayTotal).Error)
		assert.Equal(t, int64(30), dayTotal)
		record, err := UserCheckin(500)
		require.NoError(t, err)
		assert.Equal(t, 30, record.QuotaAwarded)
		var snapshot CheckinRewardSnapshot
		require.NoError(t, common.UnmarshalJsonStr(record.Policy, &snapshot))
		assert.Equal(t, 100, snapshot.BaseQuota)
		assert.Equal(t, 30.0, snapshot.Eligibility.RewardPercent)
		assert.Equal(t, config.Version, snapshot.Configuration.Version)
		require.NoError(t, CompleteCheckinUsage(500, "unopened-page", 0))
		detail, err := GetCheckinUserDetail(500)
		require.NoError(t, err)
		assert.Zero(t, detail.User.Eligibility.RecentSpend)
		require.Len(t, detail.Records, 1)
		require.NotNil(t, detail.Records[0].Snapshot)
		assert.Equal(t, 30, detail.Records[0].QuotaAwarded, "refunds do not rewrite issued rewards")
	})

	t.Run("incomplete_history_is_not_zero_activity", func(t *testing.T) {
		policy := config
		policy.ObservedSince = now.Unix()
		user := User{Id: 501, CreatedAt: now.AddDate(0, 0, -10).Unix()}
		e := calculateCheckin(&user, &CheckinAccount{}, policy, checkinFacts{}, now)
		assert.False(t, e.HistoryComplete)
		assert.Equal(t, 100, e.MaxQuota)
		assert.Contains(t, e.Reasons, "history_incomplete")
		assert.NotContains(t, e.Reasons, "new_user_grace")
		policy.Settings.Limits.NewUserDays = 14
		e = calculateCheckin(&user, &CheckinAccount{}, policy, checkinFacts{}, now)
		assert.Contains(t, e.Reasons, "new_user_grace")
		assert.Equal(t, 4, e.GraceRemainingDays)
		policy.Settings.Limits.NewUserDays = 0
		e = calculateCheckin(&user, &CheckinAccount{}, policy, checkinFacts{}, now.AddDate(0, 0, 31))
		assert.True(t, e.HistoryComplete)
		assert.Equal(t, 20, e.MaxQuota)
		e = calculateCheckin(&user, &CheckinAccount{}, policy, checkinFacts{MonthlyAwarded: 10000}, now)
		assert.False(t, e.Allowed, "transition still obeys monthly cap")
	})

	t.Run("exact_window_and_daily_aggregation", func(t *testing.T) {
		require.NoError(t, db.Create(&checkinTestUser{Id: 502, Username: "boundary-user", CreatedAt: oldUser.CreatedAt, Quota: 1000}).Error)
		at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
		start := at.AddDate(0, 0, -30)
		for i, stamp := range []int64{start.Add(-time.Second).Unix(), start.Unix(), start.Add(time.Second).Unix(), at.Add(-48 * time.Hour).Unix(), at.Unix(), at.Add(time.Second).Unix()} {
			entry := CheckinUsage{UserID: 502, SourceKey: fmt.Sprintf("edge-%d", i), CreatedAt: stamp, Quota: 10}
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
				return adjustCheckinUsageDay(tx, &entry, entry.Quota)
			}))
		}
		rows, err := checkinUserRows(db, []User{{Id: 502, CreatedAt: oldUser.CreatedAt}}, config, at)
		require.NoError(t, err)
		assert.Equal(t, int64(40), rows[0].Eligibility.RecentSpend)
		exact, err := evaluateCheckin(db, &User{Id: 502, CreatedAt: oldUser.CreatedAt}, &CheckinAccount{}, config, at)
		require.NoError(t, err)
		assert.Equal(t, exact.RecentSpend, rows[0].Eligibility.RecentSpend)
	})

	t.Run("atomic_configuration_preview_and_global_sort", func(t *testing.T) {
		before, err := CurrentCheckinConfiguration()
		require.NoError(t, err)
		preview := before.Settings
		preview.Limits.ReducedPercent = 70
		page, err := ListCheckinUsers(CheckinUserQuery{Page: 1, PageSize: 1, Search: "activity-user", Preview: &preview})
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		assert.Equal(t, 70.0, page.Items[0].Eligibility.RewardPercent)
		after, err := CurrentCheckinConfiguration()
		require.NoError(t, err)
		assert.Equal(t, before, after, "previews do not persist settings")
		changed, err := UpdateCheckinConfiguration(preview, before.Version)
		require.NoError(t, err)
		assert.Equal(t, before.Version+1, changed.Version)
		_, err = UpdateCheckinConfiguration(before.Settings, before.Version)
		require.Error(t, err, "stale edits cannot overwrite saved settings")
		preview.MaxQuota = -1
		_, err = UpdateCheckinConfiguration(preview, changed.Version)
		require.Error(t, err)
		after, err = CurrentCheckinConfiguration()
		require.NoError(t, err)
		assert.Equal(t, changed, after)
		saveCheckinTestSettings(t, settings)
		after, err = CurrentCheckinConfiguration()
		require.NoError(t, err)
		overview, rows, err := buildCheckinSnapshot(db, after, time.Now())
		require.NoError(t, err)
		assert.Equal(t, int64(len(rows)), overview.Total)
		checkinAnalytics.Lock()
		checkinAnalytics.version = after.Version
		checkinAnalytics.builtAt = time.Now()
		checkinAnalytics.overview, checkinAnalytics.rows, checkinAnalytics.err = overview, rows, nil
		checkinAnalytics.Unlock()
		t.Cleanup(func() {
			checkinAnalytics.Lock()
			checkinAnalytics.version = 0
			checkinAnalytics.overview = nil
			checkinAnalytics.rows = nil
			checkinAnalytics.Unlock()
		})
		page, err = ListCheckinUsers(CheckinUserQuery{Page: 1, PageSize: 1, Sort: "activity_desc"})
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		for _, row := range rows {
			assert.GreaterOrEqual(t, page.Items[0].Eligibility.ActivityPercent, row.Eligibility.ActivityPercent)
		}
		filtered, err := ListCheckinUsers(CheckinUserQuery{Page: 1, PageSize: 100, Filter: "zero_activity"})
		require.NoError(t, err)
		assert.NotEmpty(t, filtered.Items)
		for _, row := range filtered.Items {
			assert.True(t, row.Eligibility.HistoryComplete)
			assert.Zero(t, row.Eligibility.ActivityPercent)
		}
	})
}

func TestCheckinGraceCalendarDays(t *testing.T) {
	zone, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	for _, registered := range []time.Time{time.Date(2026, 3, 7, 12, 0, 0, 0, zone), time.Date(2026, 10, 31, 12, 0, 0, 0, zone)} {
		config := CheckinConfiguration{ObservedSince: registered.Unix(), Settings: operation_setting.CheckinSetting{Enabled: true, MinQuota: 100, MaxQuota: 100, Limits: operation_setting.CheckinLimits{Enabled: true, MonthlyCap: 1000, ActivityDays: 30, MinimumSpend: 100, NewUserDays: 7}}}
		user := User{CreatedAt: registered.Unix()}
		for _, days := range []int{0, 1, 6, 7} {
			e := calculateCheckin(&user, &CheckinAccount{}, config, checkinFacts{}, registered.AddDate(0, 0, days))
			assert.Equal(t, min(days+1, 7), e.GraceDay)
			assert.Equal(t, 7-days, e.GraceRemainingDays)
			assert.Equal(t, registered.AddDate(0, 0, 7).Unix(), e.ObservationUntil)
			assert.Equal(t, days < 7, slices.Contains(e.Reasons, "new_user_grace"))
		}
	}
}

func TestCheckinRegistrationGraceExpiry(t *testing.T) {
	zone, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	registered := time.Date(2026, 10, 21, 21, 55, 28, 0, zone)
	expires := registered.AddDate(0, 0, 5)
	config := CheckinConfiguration{
		ObservedSince: registered.Unix(),
		Settings: operation_setting.CheckinSetting{
			Enabled: true, MinQuota: 17500000, MaxQuota: 17500000,
			Limits: operation_setting.CheckinLimits{
				Enabled: true, MonthlyCap: 300000000, ActivityDays: 4,
				MinimumSpend: 50000000, ReducedPercent: 1, NewUserDays: 5,
			},
		},
	}
	require.NoError(t, config.Settings.Validate())
	user := User{CreatedAt: registered.Unix()}
	for _, tc := range []struct {
		name       string
		at         time.Time
		inGrace    bool
		wantReward int
	}{
		{"sixth_calendar_date_before_expiry", time.Date(2026, 10, 26, 10, 34, 29, 0, zone), true, 17500000},
		{"one_second_before_expiry", expires.Add(-time.Second), true, 17500000},
		{"exact_expiry", expires, false, 175000},
		{"next_checkin_date", time.Date(2026, 10, 27, 0, 0, 0, 0, zone), false, 175000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := calculateCheckin(&user, &CheckinAccount{}, config, checkinFacts{MonthlyAwarded: 87500000}, tc.at)
			assert.True(t, e.HistoryComplete)
			assert.Zero(t, e.RecentSpend)
			assert.True(t, e.Allowed)
			assert.Equal(t, expires.Unix(), e.ObservationUntil)
			assert.Equal(t, tc.inGrace, slices.Contains(e.Reasons, "new_user_grace"))
			assert.Equal(t, tc.wantReward, e.MinQuota)
			assert.Equal(t, tc.wantReward, e.MaxQuota)
			assert.Equal(t, tc.wantReward, checkinReward(config.Settings.MaxQuota, e))
			if tc.inGrace {
				assert.Equal(t, 1, e.GraceRemainingDays)
				assert.Equal(t, 100.0, e.RewardPercent)
			} else {
				assert.Zero(t, e.GraceRemainingDays)
				assert.Equal(t, 1.0, e.RewardPercent)
				assert.Contains(t, e.Reasons, "low_activity")
				assert.Contains(t, e.Reasons, "reward_floor")
			}
		})
	}
}

func verifyExpiringCheckinFunding(t *testing.T, db *gorm.DB) {
	t.Helper()
	t.Cleanup(func() {
		for _, value := range []any{&Task{}, &CheckinGrant{}, &CheckinFunding{}, &CheckinUsage{}, &CheckinUsageDay{}, &CheckinAccount{}, &Checkin{}} {
			require.NoError(t, db.Where("user_id IN ?", []int{800, 801, 802}).Delete(value).Error)
		}
		require.NoError(t, db.Where("id IN ?", []int{800, 801, 802}).Delete(&checkinTestUser{}).Error)
	})
	const userID = 800
	now := time.Now()
	settings := operation_setting.CheckinSetting{Mode: 2, ExpirySeconds: 3600, Enabled: true, MinQuota: 100, MaxQuota: 100,
		Limits: operation_setting.CheckinLimits{Enabled: true, MonthlyCap: 1, ActivityDays: 30, MinimumSpend: 1000}}
	require.NoError(t, settings.Validate())
	saveCheckinTestSettings(t, settings)
	require.NoError(t, db.Create(&checkinTestUser{Id: userID, Quota: 1000, CreatedAt: now.AddDate(-1, 0, 0).Unix()}).Error)
	summary, err := GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, summary.AsOf, now.Unix(), "the response preserves its evaluation time")
	assert.NotNil(t, summary.Records, "users without rewards receive an empty array, not null")
	assert.Empty(t, summary.Records)
	require.NoError(t, BeginCheckinUsage(userID, "pending_other_request", true))
	reward, err := UserCheckin(userID)
	require.NoError(t, err)
	assert.Equal(t, 100, reward.QuotaAwarded, "activity, pending usage and monthly cap never reduce method 2")
	_, err = UserCheckin(userID)
	require.Error(t, err, "daily uniqueness still applies")
	var grant CheckinGrant
	require.NoError(t, db.First(&grant, reward.Id).Error)
	assert.Equal(t, int64(3600), grant.ExpiresAt-grant.CreatedAt)
	paid, err := GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 1000, paid, "a gift never credits purchased balance")
	balances, err := GetCheckinBalances(userID)
	require.NoError(t, err)
	assert.Equal(t, &CheckinBalances{WalletQuota: 1000, CheckinQuota: 100}, balances)
	task := Task{UserId: userID, TaskID: "expiring-funding", PrivateData: TaskPrivateData{CheckinFundingSource: "mixed_request"}}
	require.NoError(t, db.Create(&task).Error)
	var reloaded Task
	require.NoError(t, db.First(&reloaded, task.ID).Error)
	assert.Equal(t, "mixed_request", reloaded.PrivateData.CheckinFundingSource, "the receipt survives each database's JSON serialization")

	require.ErrorIs(t, SetCheckinFunding(userID, "too_large", 2000, true, false), ErrCheckinFundingInsufficient)
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(100), summary.Available, "failed reserve rolls back gift allocation")
	require.Len(t, summary.Records, 1)
	assert.Equal(t, 100, summary.Records[0].Available)
	assert.Zero(t, summary.Records[0].Expired)
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 130, true, false))
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 130, true, false))
	paid, err = GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 970, paid)
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(100), summary.Reserved)
	assert.Zero(t, summary.Used)
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 60, false, true))
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 60, false, true))
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(40), summary.Available)
	assert.Equal(t, int64(60), summary.Used)
	assert.Zero(t, summary.Reserved)
	paid, err = GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 1000, paid, "partial settlement returns purchased funds first")
	require.NoError(t, db.Model(&CheckinAccount{}).Where("user_id = ?", userID).Update("gift_remaining", 25).Error)
	require.NoError(t, BeginCheckinUsage(userID, "mixed_request", true))
	require.NoError(t, CompleteCheckinUsage(userID, "mixed_request", 60, "mixed_request"))
	var account CheckinAccount
	require.NoError(t, db.First(&account, "user_id = ?", userID).Error)
	assert.Equal(t, int64(25), account.GiftRemaining, "method 2 usage must not consume method 1 gifts again")
	balances, err = GetCheckinBalances(userID)
	require.NoError(t, err)
	assert.Equal(t, &CheckinBalances{WalletQuota: 975, CheckinQuota: 65}, balances, "both gift methods are displayed separately from paid funds")

	// No worker or delete is involved; the boundary itself makes unused quota unspendable.
	require.NoError(t, db.Model(&grant).Update("expires_at", time.Now().Unix()).Error)
	available, isolated, err := CheckinFundingBalance(userID)
	require.NoError(t, err)
	assert.True(t, isolated)
	assert.Equal(t, 1000, available)
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Zero(t, summary.Available)
	assert.Equal(t, int64(40), summary.Expired)
	require.Len(t, summary.Records, 1)
	assert.Zero(t, summary.Records[0].Available, "expired records must agree with the summary")
	assert.Equal(t, 40, summary.Records[0].Expired)
	balances, err = GetCheckinBalances(userID)
	require.NoError(t, err)
	assert.Equal(t, &CheckinBalances{WalletQuota: 975, CheckinQuota: 25}, balances, "expiry removes only method 2 gifts")
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 0, false, true))
	require.NoError(t, SetCheckinFunding(userID, "mixed_request", 0, false, true))
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(100), summary.Expired, "expired refunds cannot become purchased balance")
	assert.Zero(t, summary.Used)
	paid, err = GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 1000, paid)
	require.NoError(t, IncreaseUserQuota(userID, 500, false))
	paid, err = GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 1500, paid)

	settings.ExpirySeconds = 1800
	saveCheckinTestSettings(t, settings)
	require.NoError(t, db.Model(reward).Update("checkin_date", now.AddDate(0, 0, -1).Format("2006-01-02")).Error)
	next, err := UserCheckin(userID)
	require.NoError(t, err)
	assert.Equal(t, 100, next.QuotaAwarded, "the next day grants full reward again")
	var nextGrant CheckinGrant
	require.NoError(t, db.First(&nextGrant, next.Id).Error)
	assert.Equal(t, int64(1800), nextGrant.ExpiresAt-nextGrant.CreatedAt)
	settings.Mode = 1
	settings.Limits.MonthlyCap = 1000
	saveCheckinTestSettings(t, settings)
	e, err := GetCheckinEligibility(userID)
	require.NoError(t, err)
	assert.Zero(t, e.MonthlyAwarded, "method 2 claims do not count toward method 1's cap")
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(100), summary.Available, "switching modes preserves existing grants")
	settings.Enabled = false
	saveCheckinTestSettings(t, settings)
	require.NoError(t, SetCheckinFunding(userID, "after_disabled", 50, true, false))
	require.NoError(t, db.Model(&nextGrant).Update("expires_at", time.Now().Unix()).Error)
	require.NoError(t, SetCheckinFunding(userID, "after_disabled", 50, false, true))
	summary, err = GetCheckinGrants(userID)
	require.NoError(t, err)
	assert.Equal(t, int64(50), summary.Used, "reservations made before expiry remain funded")
	require.NoError(t, SetCheckinFunding(userID, "after_disabled", 0, false, true))
	paid, err = GetUserQuota(userID, true)
	require.NoError(t, err)
	assert.Equal(t, 1500, paid)

	t.Run("concurrent_gift_only_spending", func(t *testing.T) {
		const giftOnlyUser = 801
		require.NoError(t, db.Create(&checkinTestUser{Id: giftOnlyUser, Quota: 0}).Error)
		grants := []CheckinGrant{
			{CheckinID: 900001, UserID: giftOnlyUser, Quota: 30, Remaining: 30, ExpiresAt: now.Unix() + 3600},
			{CheckinID: 900002, UserID: giftOnlyUser, Quota: 70, Remaining: 70, ExpiresAt: now.Unix() + 7200},
		}
		require.NoError(t, db.Create(&grants).Error)
		errs := make(chan error, 2)
		var wg sync.WaitGroup
		for _, source := range []string{"parallel_a", "parallel_b"} {
			wg.Go(func() { errs <- SetCheckinFunding(giftOnlyUser, source, 80, true, false) })
		}
		wg.Wait()
		close(errs)
		successful := 0
		for err := range errs {
			if err == nil {
				successful++
			} else {
				assert.ErrorIs(t, err, ErrCheckinFundingInsufficient)
			}
		}
		assert.Equal(t, 1, successful)
		summary, err := GetCheckinGrants(giftOnlyUser)
		require.NoError(t, err)
		assert.Equal(t, int64(20), summary.Available)
		assert.Equal(t, int64(80), summary.Reserved)
		require.NoError(t, db.First(&grants[0], grants[0].CheckinID).Error)
		assert.Zero(t, grants[0].Remaining, "earliest expiration is used first")
		paid, err := GetUserQuota(giftOnlyUser, true)
		require.NoError(t, err)
		assert.Zero(t, paid)
	})

	t.Run("cached_batched_wallet_stays_separate", func(t *testing.T) {
		const cachedUser = 802
		useUserCacheMiniRedis(t)
		oldBatch := common.BatchUpdateEnabled
		common.BatchUpdateEnabled = true
		t.Cleanup(func() { common.BatchUpdateEnabled = oldBatch })
		require.NoError(t, db.Create(&checkinTestUser{Id: cachedUser, Quota: 100}).Error)
		require.NoError(t, db.Create(&CheckinGrant{CheckinID: 900003, UserID: cachedUser, Quota: 20, Remaining: 20, ExpiresAt: now.Unix() + 3600}).Error)
		// 90 units belong to an outstanding legacy batch; only 10 are spendable.
		require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(cachedUser), map[string]any{
			"Id": cachedUser, "Quota": 10, "AuthVersion": 1, "CacheSchema": userCacheSchemaVersion,
		}).Err())
		require.ErrorIs(t, SetCheckinFunding(cachedUser, "cached_rejected", 31, true, false), ErrCheckinFundingInsufficient)
		// A legacy reservation racing the database write must already see the
		// isolated debit in Redis. A failed write restores that debit exactly once.
		failure := fmt.Errorf("database update unavailable")
		require.NoError(t, db.Callback().Update().Before("gorm:update").Register("checkin_wallet_failure", func(tx *gorm.DB) {
			if tx.Statement.Table != "users" {
				return
			}
			reserved, err := TryReserveUserQuota(cachedUser, 1)
			assert.NoError(t, err)
			assert.False(t, reserved, "outstanding cached funds cannot be reserved twice")
			tx.AddError(failure)
		}))
		fundingErr := SetCheckinFunding(cachedUser, "cached_rollback", 30, true, false)
		require.NoError(t, db.Callback().Update().Remove("checkin_wallet_failure"))
		require.ErrorIs(t, fundingErr, failure)
		cached, err := GetUserQuota(cachedUser, false)
		require.NoError(t, err)
		assert.Equal(t, 10, cached, "rollback restores the cached paid reservation")
		require.NoError(t, SetCheckinFunding(cachedUser, "cached_request", 30, true, false))
		cached, err = GetUserQuota(cachedUser, false)
		require.NoError(t, err)
		assert.Zero(t, cached)
		paid, err := GetUserQuota(cachedUser, true)
		require.NoError(t, err)
		assert.Equal(t, 90, paid, "isolated funding persists immediately even when batching is enabled")
		require.NoError(t, db.Model(&CheckinGrant{}).Where("user_id = ?", cachedUser).Update("expires_at", time.Now().Unix()).Error)
		require.NoError(t, SetCheckinFunding(cachedUser, "cached_request", 0, false, true))
		cached, err = GetUserQuota(cachedUser, false)
		require.NoError(t, err)
		assert.Equal(t, 10, cached, "expired gifts never enter the purchased-quota cache")
		paid, err = GetUserQuota(cachedUser, true)
		require.NoError(t, err)
		assert.Equal(t, 100, paid)
	})
	for _, seconds := range []int{-1, 0, 59, 365*86400 + 1} {
		settings.Mode, settings.ExpirySeconds = 2, seconds
		assert.Error(t, settings.Validate())
	}
	settings.ExpirySeconds = 60
	settings.Limits = operation_setting.CheckinLimits{}
	require.NoError(t, settings.Validate(), "method 2 does not require method 1 settings")
}
