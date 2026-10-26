/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { formatCheckinPercent } from '../format'
import type { CheckinEligibility } from '../types'

export function CheckinRewardDetails(props: {
  eligibility: CheckinEligibility
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const e = props.eligibility
  const date = (value: number) =>
    dayjs.unix(value).format('YYYY-MM-DD HH:mm:ss')
  if (e.mode === 2) {
    return (
      <div className='flex flex-col gap-2 text-sm'>
        <p>{t('Method 2: Expiring rewards')}</p>
        <p>
          {t(
            'Daily rewards are independent of activity and monthly caps. Expiring rewards are used first; recharged quota never expires.'
          )}
        </p>
        <p>
          {t('Reward validity: {{minutes}} minutes from claim time', {
            minutes: formatNumber((e.expiry_seconds ?? 86400) / 60, locale),
          })}
        </p>
        <p>
          {t('Available reward: {{minimum}} – {{maximum}}', {
            minimum: formatQuotaWithCurrency(e.min_quota),
            maximum: formatQuotaWithCurrency(e.max_quota),
          })}
        </p>
        {!e.allowed && <p>{t('Check-in rewards are currently paused.')}</p>}
      </div>
    )
  }
  return (
    <div className='space-y-2 text-sm'>
      <p>{t('Method 1: Activity rewards')}</p>
      <p>
        {t('Spending in the last {{days}} days: {{amount}} / {{minimum}}', {
          days: formatNumber(e.activity_days, locale),
          amount: formatQuotaWithCurrency(e.recent_spend),
          minimum: formatQuotaWithCurrency(e.minimum_spend),
        })}
      </p>
      <p>
        {t('Activity window')}: {date(e.window_start)} – {date(e.as_of)}
      </p>
      <p>
        {t('Spending achievement')}:{' '}
        {e.history_complete
          ? formatCheckinPercent(e.activity_percent, locale)
          : t('Incomplete history')}
        · {t('Reward percentage')}:{' '}
        {formatCheckinPercent(e.reward_percent, locale)}
      </p>
      {e.limited && (
        <p>
          {t('Rewards this month: {{amount}} / {{cap}}', {
            amount: formatQuotaWithCurrency(e.monthly_awarded),
            cap: formatQuotaWithCurrency(e.monthly_cap),
          })}
        </p>
      )}
      {e.reasons.includes('new_user_grace') && (
        <>
          <p>
            {t(
              'During your registration grace period, daily rewards are paid normally, subject to the monthly cap.'
            )}
          </p>
          <p>
            {t(
              'Grace period: day {{day}} of {{total}}, {{remaining}} days remaining. Ends at {{date}}.',
              {
                day: formatNumber(e.grace_day, locale),
                total: formatNumber(e.new_user_days, locale),
                remaining: formatNumber(e.grace_remaining_days, locale),
                date: date(e.observation_until),
              }
            )}
          </p>
        </>
      )}
      {!e.history_complete && (
        <p>
          {t(
            'Spending history is incomplete since {{date}}. Full rewards apply until the window is covered, subject to the monthly cap.',
            { date: date(e.coverage_since) }
          )}
        </p>
      )}
      {e.reasons.includes('reward_floor') && (
        <p>
          {t(
            'The minimum reward percentage applies because your activity is below the reward floor.'
          )}
        </p>
      )}
      {e.reasons.includes('low_activity') && (
        <p>
          {t(
            'Spend {{amount}} more within the current window to reach full activity.',
            { amount: formatQuotaWithCurrency(e.spending_gap) }
          )}
        </p>
      )}
      {e.reasons.includes('monthly_cap') && (
        <p>
          {t(
            'Monthly allowance remaining: {{amount}}. Resets at {{date}}. More spending cannot raise this cap.',
            {
              amount: formatQuotaWithCurrency(e.monthly_remaining),
              date: date(e.next_month_at),
            }
          )}
        </p>
      )}
      {e.reasons.includes('accounting_pending') && (
        <p>
          {t(
            'Usage settlement is pending. Please retry later or contact support if this persists.'
          )}
        </p>
      )}
      {e.reasons.includes('checkin_disabled') && (
        <p>{t('Check-in is disabled.')}</p>
      )}
      <p>
        {t('Available reward: {{minimum}} – {{maximum}}', {
          minimum: formatQuotaWithCurrency(e.min_quota),
          maximum: formatQuotaWithCurrency(e.max_quota),
        })}
      </p>
      {!e.allowed && <p>{t('Check-in rewards are currently paused.')}</p>}
    </div>
  )
}
