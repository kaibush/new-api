package operation_setting

import (
	"errors"
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/shopspring/decimal"
)

type PaymentSetting struct {
	AmountOptions            []int           `json:"amount_options"`
	AmountDiscount           map[int]float64 `json:"amount_discount"` // 充值金额对应的折扣，例如 100 元 0.9 表示 100 元充值享受 9 折优惠
	MonthlyTopUpLimitEnabled bool            `json:"monthly_topup_limit_enabled"`
	MonthlyTopUpLimit        float64         `json:"monthly_topup_limit"` // USD wallet credit, before spending

	ComplianceConfirmed    bool   `json:"compliance_confirmed"`
	ComplianceTermsVersion string `json:"compliance_terms_version"`
	ComplianceConfirmedAt  int64  `json:"compliance_confirmed_at"`
	ComplianceConfirmedBy  int    `json:"compliance_confirmed_by"`
	ComplianceConfirmedIP  string `json:"compliance_confirmed_ip"`
}

const CurrentComplianceTermsVersion = "v1"

// 默认配置
var paymentSetting = PaymentSetting{
	AmountOptions:     []int{10, 20, 50, 100, 200, 500},
	AmountDiscount:    map[int]float64{},
	MonthlyTopUpLimit: 1000,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("payment_setting", &paymentSetting)
}

func GetPaymentSetting() *PaymentSetting {
	return &paymentSetting
}

// MonthlyTopUpQuotaLimit returns zero only when the restriction is disabled.
// Invalid enabled settings fail closed, including settings loaded from storage.
func (s PaymentSetting) MonthlyTopUpQuotaLimit() (int, error) {
	if !s.MonthlyTopUpLimitEnabled {
		return 0, nil
	}
	if math.IsNaN(s.MonthlyTopUpLimit) || math.IsInf(s.MonthlyTopUpLimit, 0) || s.MonthlyTopUpLimit <= 0 ||
		math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) || common.QuotaPerUnit <= 0 {
		return 0, errors.New("每月充值上限必须是大于 0 的有限金额")
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(s.MonthlyTopUpLimit).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || quota <= 0 {
		return 0, errors.New("每月充值上限超出有效额度范围")
	}
	return quota, nil
}

func ValidateMonthlyTopUpLimitOption(key, value string) error {
	candidate := paymentSetting
	switch key {
	case "payment_setting.monthly_topup_limit_enabled":
		enabled, err := strconv.ParseBool(value)
		if err != nil {
			return errors.New("每月充值限额开关无效")
		}
		candidate.MonthlyTopUpLimitEnabled = enabled
	case "payment_setting.monthly_topup_limit":
		amount, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return errors.New("每月充值上限必须是大于 0 的有限金额")
		}
		candidate.MonthlyTopUpLimit = amount
		candidate.MonthlyTopUpLimitEnabled = true
	default:
		return nil
	}
	_, err := candidate.MonthlyTopUpQuotaLimit()
	return err
}

func IsPaymentComplianceConfirmed() bool {
	return paymentSetting.ComplianceConfirmed &&
		paymentSetting.ComplianceTermsVersion == CurrentComplianceTermsVersion
}
