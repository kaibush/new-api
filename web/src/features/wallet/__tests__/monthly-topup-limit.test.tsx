import { act, render, renderHook, screen } from '@testing-library/react'
import i18next from 'i18next'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { RechargeFormCard } from '../components/recharge-form-card'
import { useWaffoPancakePayment } from '../hooks/use-waffo-pancake-payment'
import { useWaffoPayment } from '../hooks/use-waffo-payment'

const formProps = {
  presetAmounts: [],
  selectedPreset: null,
  onSelectPreset: vi.fn(),
  topupAmount: 1000,
  onTopupAmountChange: vi.fn(),
  paymentAmount: 1000,
  calculating: false,
  onPaymentMethodSelect: vi.fn(),
  paymentLoading: null,
  redemptionCode: '',
  onRedemptionCodeChange: vi.fn(),
  onRedeem: vi.fn(),
  redeeming: false,
}

const limit = {
  enabled: true,
  limit_quota: 500_000_000,
  used_quota: 0,
  pending_quota: 0,
  remaining_quota: 500_000_000,
}

const topupInfo = {
  enable_online_topup: true,
  enable_stripe_topup: false,
  pay_methods: [{ name: 'Test Pay', type: 'alipay' }],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [],
  discount: {},
}

afterEach(async () => {
  await i18next.changeLanguage('en')
})

it('shows the full 1000 allowance before any top-up and updates after a credit', () => {
  const view = render(
    <RechargeFormCard
      {...formProps}
      topupInfo={{ ...topupInfo, monthly_topup_limit: limit }}
    />
  )
  expect(
    screen.getByText('Remaining top-up allowance this month: $1,000')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Test Pay' })).toBeEnabled()
  expect(
    screen.queryByText(
      'Pending orders reserve allowance even before payment. Check Order History for details.'
    )
  ).not.toBeInTheDocument()

  view.rerender(
    <RechargeFormCard
      {...formProps}
      topupInfo={{
        ...topupInfo,
        monthly_topup_limit: {
          ...limit,
          used_quota: 500_000_000,
          remaining_quota: 0,
        },
      }}
    />
  )
  expect(
    screen.getByText('Remaining top-up allowance this month: $0')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Monthly limit: $1,000 · Credited: $1,000 · Pending orders: $0'
    )
  ).toBeVisible()
})

it.each([undefined, { ...limit, enabled: false }])(
  'does not show an exhausted allowance when the limit is absent or disabled: %j',
  (monthlyLimit) => {
    render(
      <RechargeFormCard
        {...formProps}
        topupInfo={{ ...topupInfo, monthly_topup_limit: monthlyLimit }}
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Pay' })).toBeEnabled()
  }
)

it('updates the allowance message when the interface language changes', async () => {
  i18next.addResourceBundle('zhCN', 'translation', zh.translation)
  render(
    <RechargeFormCard
      {...formProps}
      topupInfo={{ ...topupInfo, monthly_topup_limit: limit }}
    />
  )
  expect(
    screen.getByText('Remaining top-up allowance this month: $1,000')
  ).toBeVisible()
  await i18next.changeLanguage('zhCN')
  expect(await screen.findByText('本月还可充值：$1,000')).toBeVisible()
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'invalid_locale'])(
  'formats remaining credit safely for interface language %s',
  (language) => {
    i18next.resolvedLanguage = language
    const remaining = formatQuotaWithCurrency(489_000_000, {
      abbreviate: false,
      digitsSmall: 6,
      locale: toIntlLocale(language),
    })
    const message = getServerErrorMessage({
      response: {
        data: {
          code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED',
          monthly_topup_limit: {
            ...limit,
            pending_quota: 11_000_000,
            remaining_quota: 489_000_000,
          },
        },
      },
    })
    expect(message).toContain(remaining)
    expect(message).not.toContain('{{')
  }
)

it('uses the translated fallback when an older server omits allowance details', () => {
  expect(getServerErrorMessage({ code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED' })).toBe(
    'Monthly top-up limit reached (including pending orders). Reduce the amount or try again next month.'
  )
})

it('does not round the remaining allowance up to an amount the server will reject', () => {
  const monthlyLimit = {
    ...limit,
    used_quota: 499_000_001,
    remaining_quota: 999_999,
  }
  render(
    <RechargeFormCard
      {...formProps}
      topupInfo={{ ...topupInfo, monthly_topup_limit: monthlyLimit }}
    />
  )
  expect(
    screen.getByText('Remaining top-up allowance this month: $1.999998')
  ).toBeVisible()
  expect(
    getServerErrorMessage({
      code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED',
      monthly_topup_limit: monthlyLimit,
    })
  ).toContain('You can still add $1.999998;')
})

it.each(['waffo', 'waffo-pancake'])(
  'shows the remaining allowance when %s rejects checkout after a successful quote',
  async (provider) => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        message: 'error',
        data: 'untranslated server error',
        code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED',
        monthly_topup_limit: {
          ...limit,
          pending_quota: 11_000_000,
          remaining_quota: 489_000_000,
        },
      },
    })
    const notify = vi.spyOn(toast, 'error').mockReturnValue('monthly-limit')
    const waffo = renderHook(useWaffoPayment)
    const pancake = renderHook(useWaffoPancakePayment)
    await act(async () => {
      const success =
        provider === 'waffo'
          ? await waffo.result.current.processWaffoPayment(1000)
          : await pancake.result.current.processWaffoPancakePayment(1000)
      expect(success).toBe(false)
    })
    expect(notify).toHaveBeenCalledWith(
      'This top-up exceeds your remaining monthly allowance. You can still add $978; $0 credited and $22 reserved by pending orders this month.'
    )
  }
)
