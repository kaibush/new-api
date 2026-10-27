package model

import (
	"errors"
	"fmt"
	"maps"
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
	"gorm.io/gorm/schema"
)

func TestMonthlyTopUpLimitDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "monthly.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "monthly_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)
			previousDB, previousKind := DB, common.MainDatabaseType()
			previousSettings := *operation_setting.GetPaymentSetting()
			previousQuotaPerUnit := common.QuotaPerUnit
			previousOptions := maps.Clone(common.OptionMap)
			DB = db
			common.OptionMap = make(map[string]string)
			common.QuotaPerUnit = 100
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(&TopUp{}, &Redemption{}, &User{}, &Option{}))
				DB = previousDB
				common.SetMainDatabaseType(previousKind)
				common.QuotaPerUnit = previousQuotaPerUnit
				*operation_setting.GetPaymentSetting() = previousSettings
				common.OptionMap = previousOptions
				initCol()
				assert.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &Redemption{}, &Option{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)

			t.Run("settings reject unlimited values and survive reload", func(t *testing.T) {
				for _, value := range []string{"0", "-1", "NaN", "+Inf", "1e30", "0.00001", "invalid"} {
					assert.Error(t, UpdateOption("payment_setting.monthly_topup_limit", value), value)
				}
				require.NoError(t, UpdateOption("payment_setting.monthly_topup_limit", "10.25"))
				require.NoError(t, UpdateOption("payment_setting.monthly_topup_limit_enabled", "true"))
				assert.Error(t, UpdateOption("payment_setting.monthly_topup_limit_enabled", "invalid"))
				loadOptionsFromDatabase()
				loadOptionsFromDatabase()
				limit, err := operation_setting.GetPaymentSetting().MonthlyTopUpQuotaLimit()
				require.NoError(t, err)
				assert.Equal(t, 1025, limit)
				operation_setting.GetPaymentSetting().MonthlyTopUpLimit = 0
				_, err = operation_setting.GetPaymentSetting().MonthlyTopUpQuotaLimit()
				assert.Error(t, err, "invalid stored settings must fail closed")
				require.NoError(t, UpdateOption("payment_setting.monthly_topup_limit_enabled", "false"))
				limit, err = operation_setting.GetPaymentSetting().MonthlyTopUpQuotaLimit()
				require.NoError(t, err)
				assert.Zero(t, limit)
			})

			t.Run("completion month, pending orders, and user isolation", func(t *testing.T) {
				user := monthlyTopUpTestUser(t)
				now := time.Now().UTC()
				start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Unix()
				orders := []TopUp{
					{UserId: user.Id, TradeNo: "previous-month", Amount: 100, Status: common.TopUpStatusSuccess, CompleteTime: start - 1},
					{UserId: user.Id, TradeNo: "current-month", Amount: 4, Status: common.TopUpStatusSuccess, CompleteTime: start, CreateTime: start - 100},
					{UserId: user.Id, TradeNo: "old-pending", Amount: 3, Status: common.TopUpStatusPending, CreateTime: start - 100},
					{UserId: user.Id, TradeNo: "failed", Amount: 100, Status: common.TopUpStatusFailed},
					{UserId: user.Id, TradeNo: "expired", Amount: 100, Status: common.TopUpStatusExpired},
					{UserId: user.Id, TradeNo: "subscription", Amount: 0, Money: 100, PaymentMethod: PaymentMethodStripe, Status: common.TopUpStatusSuccess, CompleteTime: start},
					{UserId: user.Id + 1, TradeNo: "other-user", Amount: 100, Status: common.TopUpStatusSuccess, CompleteTime: start},
				}
				require.NoError(t, db.Create(&orders).Error)
				require.NoError(t, ValidateTopUpQuotaCapacity(user.Id, 300))
				assert.ErrorIs(t, ValidateTopUpQuotaCapacity(user.Id, 301), ErrMonthlyTopUpLimitExceeded)
				require.NoError(t, UpdatePendingTopUpStatus("old-pending", "", common.TopUpStatusExpired))
				require.NoError(t, ValidateTopUpQuotaCapacity(user.Id, 600))
				assert.ErrorIs(t, ValidateTopUpQuotaCapacity(user.Id, 601), ErrMonthlyTopUpLimitExceeded)
				operation_setting.GetPaymentSetting().MonthlyTopUpLimitEnabled = false
				require.NoError(t, ValidateTopUpQuotaCapacity(user.Id, 10000))
			})

			t.Run("settlement retains its completion month across midnight", func(t *testing.T) {
				user := monthlyTopUpTestUser(t)
				now := time.Now().UTC()
				lastMonthEnd := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Unix() - 1
				orders := []TopUp{
					{UserId: user.Id, TradeNo: "previous-credit", Amount: 6, Status: common.TopUpStatusSuccess, CompleteTime: lastMonthEnd},
					{UserId: user.Id, TradeNo: "boundary-credit", Amount: 5, Status: common.TopUpStatusSuccess, CompleteTime: lastMonthEnd},
				}
				require.NoError(t, db.Create(&orders).Error)
				// The order was recorded before midnight; its final quota check
				// must still enforce that month's cap after the clock advances.
				err := userWalletTransaction(user.Id, func(tx *gorm.DB) error {
					return orders[1].creditQuota(tx, 500, nil)
				})
				assert.ErrorIs(t, err, ErrMonthlyTopUpLimitExceeded)
				assert.Zero(t, getUserQuotaForPaymentGuardTest(t, user.Id))
				require.NoError(t, ValidateTopUpQuotaCapacity(user.Id, 1000), "the new month's allowance starts fresh")
			})

			for _, provider := range []string{PaymentProviderEpay, PaymentProviderStripe, PaymentProviderCreem, PaymentProviderWaffo, PaymentProviderWaffoPancake, "manual-creem"} {
				t.Run(provider+" uses credited quota and rejects settlement over the cap", func(t *testing.T) {
					user := monthlyTopUpTestUser(t)
					order := TopUp{UserId: user.Id, TradeNo: "provider-order", Amount: 10, Money: 6, PaymentProvider: provider, Status: common.TopUpStatusPending}
					switch provider {
					case PaymentProviderCreem, "manual-creem":
						order.Amount, order.PaymentProvider = 1000, PaymentProviderCreem
					case PaymentProviderStripe:
						order.Amount, order.Money = 100, 10
					}
					require.NoError(t, order.Insert())
					assert.ErrorIs(t, ValidateTopUpQuotaCapacity(user.Id, 1), ErrMonthlyTopUpLimitExceeded)
					operation_setting.GetPaymentSetting().MonthlyTopUpLimit = 9
					assert.Error(t, settleMonthlyTopUpTestOrder(provider, order.TradeNo))
					assert.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo(order.TradeNo).Status)
					assert.Zero(t, getUserQuotaForPaymentGuardTest(t, user.Id))
					operation_setting.GetPaymentSetting().MonthlyTopUpLimit = 10
					require.NoError(t, settleMonthlyTopUpTestOrder(provider, order.TradeNo))
					assert.Equal(t, 1000, getUserQuotaForPaymentGuardTest(t, user.Id))
					if provider == PaymentProviderEpay {
						alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "")
						require.NoError(t, err)
						assert.True(t, alreadyDone)
						assert.ErrorIs(t, UpdatePendingTopUpStatus(order.TradeNo, provider, common.TopUpStatusFailed), ErrTopUpStatusInvalid)
						assert.Equal(t, 1000, getUserQuotaForPaymentGuardTest(t, user.Id))
					}
					require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).UpdateColumn("quota", 0).Error)
					assert.ErrorIs(t, ValidateTopUpQuotaCapacity(user.Id, 1), ErrMonthlyTopUpLimitExceeded, "spending must not restore capacity")
				})
			}

			t.Run("redemption shares capacity and rolls back without consuming the code", func(t *testing.T) {
				user := monthlyTopUpTestUser(t)
				code := Redemption{Key: "monthly-redemption", Quota: 600, Status: common.RedemptionCodeStatusEnabled}
				require.NoError(t, code.Insert())
				order := TopUp{UserId: user.Id, TradeNo: "reserved", Amount: 5, Status: common.TopUpStatusPending, PaymentProvider: PaymentProviderEpay}
				require.NoError(t, order.Insert())
				_, err := Redeem(code.Key, user.Id)
				require.Error(t, err)
				require.NoError(t, DB.First(&code, code.Id).Error)
				assert.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
				assert.Zero(t, getUserQuotaForPaymentGuardTest(t, user.Id))
				require.NoError(t, UpdatePendingTopUpStatus(order.TradeNo, PaymentProviderEpay, common.TopUpStatusFailed))
				quota, err := Redeem(code.Key, user.Id)
				require.NoError(t, err)
				assert.Equal(t, 600, quota)
				require.NoError(t, DB.Delete(&code).Error)
				require.NoError(t, ValidateTopUpQuotaCapacity(user.Id, 400))
				assert.ErrorIs(t, ValidateTopUpQuotaCapacity(user.Id, 401), ErrMonthlyTopUpLimitExceeded)
			})

			for _, settle := range []bool{false, true} {
				t.Run(fmt.Sprintf("concurrent orders cannot exceed cap, settlement=%t", settle), func(t *testing.T) {
					user := monthlyTopUpTestUser(t)
					orders := []TopUp{
						{UserId: user.Id, TradeNo: "concurrent-a", Amount: 6, PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending},
						{UserId: user.Id, TradeNo: "concurrent-b", Amount: 6, PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending},
					}
					if settle {
						// Orders issued before enabling or reducing the cap.
						require.NoError(t, db.Create(&orders).Error)
					}
					start := make(chan struct{})
					results := make(chan error, 2)
					var wg sync.WaitGroup
					for i := range orders {
						wg.Go(func() {
							<-start
							if settle {
								_, err := RechargeEpay(orders[i].TradeNo, "alipay", "")
								results <- err
								return
							}
							results <- orders[i].Insert()
						})
					}
					close(start)
					wg.Wait()
					close(results)
					success, rejected := 0, 0
					for err := range results {
						if err == nil {
							success++
						} else if errors.Is(err, ErrMonthlyTopUpLimitExceeded) {
							rejected++
						} else {
							t.Errorf("unexpected payment failure: %v", err)
						}
					}
					assert.Equal(t, 1, success)
					assert.Equal(t, 1, rejected)
					if settle {
						assert.Equal(t, 600, getUserQuotaForPaymentGuardTest(t, user.Id))
					}
				})
			}
		})
	}
}

func monthlyTopUpTestUser(t *testing.T) *User {
	t.Helper()
	for _, value := range []any{&TopUp{}, &Redemption{}, &User{}} {
		require.NoError(t, DB.Unscoped().Where("1 = 1").Delete(value).Error)
	}
	operation_setting.GetPaymentSetting().MonthlyTopUpLimitEnabled = true
	operation_setting.GetPaymentSetting().MonthlyTopUpLimit = 10
	return insertUserForPaymentGuardTest(t, 1, 0)
}

func settleMonthlyTopUpTestOrder(provider, tradeNo string) error {
	switch provider {
	case PaymentProviderEpay:
		_, err := RechargeEpay(tradeNo, "alipay", "")
		return err
	case PaymentProviderStripe:
		return Recharge(tradeNo, "", "")
	case PaymentProviderCreem:
		return RechargeCreem(tradeNo, "", "", "")
	case PaymentProviderWaffo:
		return RechargeWaffo(tradeNo, "")
	case PaymentProviderWaffoPancake:
		return RechargeWaffoPancake(tradeNo)
	default:
		return ManualCompleteTopUp(tradeNo, "")
	}
}
