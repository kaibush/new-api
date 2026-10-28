package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTopUpQuotaValidation(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	testCases := []struct {
		name        string
		displayType string
		amount      int64
		wantQuota   int
		wantErr     bool
	}{
		{
			name:        "currency amount below limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4294,
			wantQuota:   2_147_000_000,
		},
		{
			name:        "currency amount above limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4295,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount preserves settlement truncation",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      2_147_500_000,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount above legacy int32 range",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      4_294_500_000,
			wantQuota:   4_294_500_000,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tc.displayType
			quota, err := getTopUpQuota(tc.amount)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantQuota, quota)
		})
	}
}

func TestValidateTopUpQuotaReturnsMaximumAmount(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()

	_, err := validateTopUpQuota(maxAmount)
	require.NoError(t, err)
	_, err = validateTopUpQuota(maxAmount + 1)
	require.EqualError(t, err, fmt.Sprintf("单笔充值数量不能大于 %d", maxAmount))
}

func TestRequestAmountRejectsTopUpThatCannotBeSettled(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/user/amount",
		strings.NewReader(fmt.Sprintf(`{"amount":%d}`, maxAmount+1)),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestAmount(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"message":"error","data":"单笔充值数量不能大于 %d"}`, maxAmount), recorder.Body.String())
}

func TestRequestAmountRejectsTopUpOverQuotaLimits(t *testing.T) {
	for _, tc := range []struct {
		name      string
		monthly   bool
		limit     float64
		pending   int64
		amount    int64
		remaining int
		allowed   bool
	}{
		{name: "wallet ceiling", amount: 1},
		{name: "request exceeds unused monthly allowance", monthly: true, limit: 0.5, amount: 1, remaining: 250000},
		{name: "first top-up at 1000 dollar limit", monthly: true, limit: 1000, amount: 1000, remaining: 500000000, allowed: true},
		{name: "unpaid orders explain rejection at 1000 dollar limit", monthly: true, limit: 1000, pending: 22, amount: 1000, remaining: 489000000},
		{name: "top-up at remaining allowance", monthly: true, limit: 1000, pending: 22, amount: 978, remaining: 489000000, allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			oldQuotaPerUnit := common.QuotaPerUnit
			oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
			oldDB := model.DB
			oldMaster, oldSQLite, oldRedis := common.IsMasterNode, common.SQLitePath, common.RedisEnabled
			oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			oldPaymentSetting := *operation_setting.GetPaymentSetting()
			oldMinTopUp, oldPrice := operation_setting.MinTopUp, operation_setting.Price
			operation_setting.MinTopUp, operation_setting.Price = 1, 1
			operation_setting.GetPaymentSetting().MonthlyTopUpLimitEnabled = tc.monthly
			operation_setting.GetPaymentSetting().MonthlyTopUpLimit = tc.limit
			common.QuotaPerUnit = 500000
			operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD

			t.Setenv("SQL_DSN", "")
			t.Setenv("LOG_SQL_DSN", "")
			common.IsMasterNode, common.RedisEnabled = false, false
			common.SQLitePath = filepath.Join(t.TempDir(), "topup.db")
			t.Cleanup(func() {
				common.QuotaPerUnit = oldQuotaPerUnit
				operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
				model.DB = oldDB
				common.IsMasterNode, common.SQLitePath, common.RedisEnabled = oldMaster, oldSQLite, oldRedis
				common.SetDatabaseTypes(oldMainType, oldLogType)
				*operation_setting.GetPaymentSetting() = oldPaymentSetting
				operation_setting.MinTopUp, operation_setting.Price = oldMinTopUp, oldPrice
			})
			require.NoError(t, model.InitDB())
			db := model.DB
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Redemption{}))

			quota := common.MaxWalletQuota - 100_000
			if tc.monthly {
				quota = 0
			}
			require.NoError(t, model.DB.Create(&model.User{
				Id:       42,
				Username: "topup_capacity_user",
				Quota:    quota,
				Status:   common.UserStatusEnabled,
				Group:    "default",
			}).Error)
			if tc.pending > 0 {
				require.NoError(t, model.DB.Create(&model.TopUp{UserId: 42, TradeNo: "pending", Amount: tc.pending, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderEpay}).Error)
			}

			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Set("id", 42)
			ctx.Request = httptest.NewRequest(
				http.MethodPost,
				"/api/user/amount",
				strings.NewReader(fmt.Sprintf(`{"amount":%d}`, tc.amount)),
			)
			ctx.Request.Header.Set("Content-Type", "application/json")

			RequestAmount(ctx)

			assert.Equal(t, http.StatusOK, recorder.Code)
			if tc.allowed {
				assert.JSONEq(t, fmt.Sprintf(`{"message":"success","data":"%d.00"}`, tc.amount), recorder.Body.String())
			} else if tc.monthly {
				var response struct {
					Code  string                        `json:"code"`
					Data  string                        `json:"data"`
					Limit model.MonthlyTopUpLimitStatus `json:"monthly_topup_limit"`
				}
				require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				assert.Equal(t, "MONTHLY_TOPUP_LIMIT_EXCEEDED", response.Code)
				assert.Equal(t, tc.remaining, response.Limit.RemainingQuota)
				assert.Zero(t, response.Limit.UsedQuota)
				assert.Equal(t, int(tc.pending)*500000, response.Limit.PendingQuota)
				assert.Contains(t, response.Data, fmt.Sprintf("%.6f USD", float64(tc.remaining)/common.QuotaPerUnit))
			} else {
				assert.JSONEq(t, `{"message":"error","data":"top-up quota limit exceeded"}`, recorder.Body.String())
			}
			infoRecorder := httptest.NewRecorder()
			infoContext, _ := gin.CreateTestContext(infoRecorder)
			infoContext.Set("id", 42)
			GetTopUpInfo(infoContext)
			var info struct {
				Success bool `json:"success"`
				Data    struct {
					Limit model.MonthlyTopUpLimitStatus `json:"monthly_topup_limit"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(infoRecorder.Body.Bytes(), &info))
			assert.True(t, info.Success)
			assert.Equal(t, tc.monthly, info.Data.Limit.Enabled)
			assert.Equal(t, tc.remaining, info.Data.Limit.RemainingQuota)

		})
	}
}

func TestValidateCreditedQuotaRejectsOverflow(t *testing.T) {
	_, err := validateCreditedQuota(decimal.NewFromInt(int64(common.MaxWalletQuota / 2)))
	require.NoError(t, err)
	_, err = validateCreditedQuota(decimal.Zero)
	require.EqualError(t, err, "充值额度必须大于 0")
	_, err = validateCreditedQuota(decimal.NewFromInt(common.MaxWalletQuota + 1))
	require.EqualError(
		t,
		err,
		"充值额度超出系统可表示范围",
	)
}

func TestStripeCreditedQuotaIncludesGroupRatio(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldTopupGroupRatio := common.TopupGroupRatio2JSONString()
	common.QuotaPerUnit = 500000
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"vip":2}`))
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldTopupGroupRatio))
	})

	_, err := validateCreditedQuota(getStripeCreditedQuota(2147, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(2148, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(int64(common.MaxWalletQuota), "vip"))
	require.Error(t, err)

	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"free":0}`))
	assert.True(t, decimal.NewFromInt(500000).Equal(getStripeCreditedQuota(1, "free")))
}
