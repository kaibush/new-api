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
					user := checkinTestUser{Id: 1, Quota: 1000000, CreatedAt: now.AddDate(0, 0, -60).Unix()}
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
					assert.Equal(t, 50, decision.MaxQuota, "both caps clip the reward")
					assert.Contains(t, decision.Reasons, "observation")

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
					assert.Contains(t, decision.Reasons, "gift_cap")
					assert.False(t, decision.Allowed)
					// Test calendar-month reset independently of the gift cap.
					var account CheckinAccount
					require.NoError(t, db.First(&account, "user_id = ?", 1).Error)
					account.GiftRemaining = 0
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
				})
			}
		})
	}
}

func TestCheckinLimitsValidation(t *testing.T) {
	valid := operation_setting.CheckinLimits{Enabled: true, GiftCap: 100, MonthlyCap: 200, ActivityDays: 30, MinimumSpend: 100, ReducedPercent: 20, NewUserDays: 7}
	require.NoError(t, valid.Validate())
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
