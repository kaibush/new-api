package model

import (
	"os"
	"path/filepath"
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
	Id        int `gorm:"primaryKey"`
	Quota     int64
	CreatedAt int64
	DeletedAt gorm.DeletedAt
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
					require.NoError(t, db.Migrator().DropTable(&CheckinUsage{}, &CheckinAccount{}, &Checkin{}, &checkinTestUser{}))
					t.Cleanup(func() {
						require.NoError(t, db.Migrator().DropTable(&CheckinUsage{}, &CheckinAccount{}, &Checkin{}, &checkinTestUser{}))
					})
					require.NoError(t, db.AutoMigrate(&checkinTestUser{}))
					if upgrade {
						require.NoError(t, db.AutoMigrate(&releasedCheckin{}))
						require.NoError(t, db.Create(&releasedCheckin{UserId: 99, CheckinDate: "2025-01-01", QuotaAwarded: 123, CreatedAt: 1}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&Checkin{}, &CheckinAccount{}, &CheckinUsage{}))
					}
					if upgrade {
						var old Checkin
						require.NoError(t, db.Where("user_id = ?", 99).First(&old).Error)
						assert.Equal(t, 123, old.QuotaAwarded)
						assert.Error(t, db.Create(&Checkin{UserId: 99, CheckinDate: "2025-01-01"}).Error)
					}
					now := time.Now()
					user := checkinTestUser{Id: 1, Quota: 1000000, CreatedAt: now.Unix()}
					require.NoError(t, db.Create(&user).Error)
					settings := operation_setting.CheckinSetting{Enabled: true, MinQuota: 100, MaxQuota: 100, Limits: operation_setting.CheckinLimits{GiftCap: 150, MonthlyCap: 150, ActivityDays: 30, MinimumSpend: 100, ReducedPercent: 20, NewUserDays: 7}}
					*operation_setting.GetCheckinSetting() = settings
					record, err := UserCheckin(1)
					require.NoError(t, err)
					assert.Equal(t, 100, record.QuotaAwarded)
					_, err = UserCheckin(1)
					require.Error(t, err)
					settings.Limits.Enabled = true
					*operation_setting.GetCheckinSetting() = settings
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
					*operation_setting.GetCheckinSetting() = settings
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.False(t, decision.Allowed)
					settings.Limits.ReducedPercent = 100
					*operation_setting.GetCheckinSetting() = settings
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
					future, err := evaluateCheckin(db, &User{Id: 1, CreatedAt: user.CreatedAt}, &account, settings, settings.Limits, next)
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
					*operation_setting.GetCheckinSetting() = settings
					decision, err = GetCheckinEligibility(1)
					require.NoError(t, err)
					assert.True(t, decision.Allowed)
					assert.Equal(t, 100, decision.MaxQuota)

					t.Run("topup_does_not_change_checkin_policy", func(t *testing.T) {
						policy := operation_setting.CheckinSetting{Enabled: true, MinQuota: 3500, MaxQuota: 3500, Limits: operation_setting.CheckinLimits{Enabled: true, GiftCap: 1000, MonthlyCap: 60000, ActivityDays: 15, MinimumSpend: 10000, ReducedPercent: 10, NewUserDays: 5}}
						*operation_setting.GetCheckinSetting() = policy
						defer func() { *operation_setting.GetCheckinSetting() = settings }()
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
						*operation_setting.GetCheckinSetting() = policy
						defer func() { *operation_setting.GetCheckinSetting() = settings }()
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
								assert.Equal(t, 350, decision.MaxQuota)
								require.NoError(t, CompleteCheckinUsage(userID, "returning_request", 10000))
								decision, err = GetCheckinEligibility(userID)
								require.NoError(t, err)
								assert.Equal(t, int64(10000), decision.RecentSpend)
								assert.Equal(t, 3500, decision.MaxQuota)
								assert.Equal(t, 100, decision.RewardPercent)
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
										result, err := evaluateCheckin(db, &User{Id: userID, CreatedAt: user.CreatedAt}, &account, policy, policy.Limits, step.time)
										require.NoError(t, err)
										assert.True(t, result.Allowed)
										assert.Equal(t, step.wantSpend, result.RecentSpend)
										assert.Equal(t, step.wantReward, result.MinQuota)
										assert.Equal(t, step.wantReward, result.MaxQuota)
									})
								}
								returned := expires.Add(time.Hour)
								require.NoError(t, db.Create(&CheckinUsage{UserID: userID, SourceKey: "second_return", CreatedAt: returned.Unix(), Quota: 10000}).Error)
								result, err := evaluateCheckin(db, &User{Id: userID, CreatedAt: user.CreatedAt}, &account, policy, policy.Limits, returned)
								require.NoError(t, err)
								assert.Equal(t, int64(10000), result.RecentSpend, "only the new consumption counts")
								assert.Equal(t, 3500, result.MaxQuota)
								assert.Equal(t, 100, result.RewardPercent)
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
							result, err := evaluateCheckin(db, &newUser, &gifts, policy, policy.Limits, at)
							require.NoError(t, err)
							require.True(t, result.Allowed)
							assert.Equal(t, 3500, result.MinQuota)
							assert.Equal(t, 3500, result.MaxQuota)
							assert.Equal(t, 100, result.RewardPercent)
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
							wantPercent int
						}{
							{"last_protected_second", expires.Add(-time.Second), 0, 60000, 10, 3500, 100},
							{"sixth_day_low_activity", expires, 0, 60000, 10, 350, 10},
							{"active_at_threshold", expires, 10000, 60000, 10, 3500, 100},
							{"below_threshold", expires, 9999, 60000, 10, 350, 10},
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
								result, err := evaluateCheckin(db, &newUser, &gifts, policy, limits, tc.at)
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
