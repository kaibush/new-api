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
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { getUserActivity } from '../api'
import { ActivityFundingSummary } from './funding-summary'
import { ActivityPeriodNote } from './period-note'

const Trend = lazy(() =>
  import('./usage-trend').then((module) => ({
    default: module.UserActivityTrend,
  }))
)

export function UserUsagePanel(props: { userId: number; days: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: ['user-activity', 'detail', props.userId, props.days],
    queryFn: ({ signal }) => getUserActivity(props.userId, props.days, signal),
    refetchInterval: 30000,
  })
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  if (!query.data) return <LoadingState />
  const data = query.data
  const user = data.user
  return (
    <div className='space-y-4'>
      <h3 className='font-medium'>{user.display_name || user.username}</h3>
      <ActivityPeriodNote period={data} />
      {!user.history_complete && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('Incomplete history')} · {t('Only recorded spending is shown.')}
        </p>
      )}
      <Card>
        <CardContent className='pt-5'>
          <dl className='grid grid-cols-2 gap-4'>
            {[
              {
                label: t('Settled spending'),
                value: formatQuotaWithCurrency(user.consumed_quota),
              },
              {
                label: t('Charged records'),
                value: formatNumber(user.charged_records, locale),
              },
              {
                label: t('Days with spending'),
                value: formatNumber(user.active_days, locale),
              },
              {
                label: t('Last recorded spending'),
                value:
                  user.last_used_at > 0
                    ? dayjs
                        .unix(user.last_used_at)
                        .format('YYYY-MM-DD HH:mm:ss')
                    : t('None'),
              },
            ].map((item) => (
              <div key={item.label} role='group' aria-label={item.label}>
                <dt className='text-muted-foreground text-sm'>{item.label}</dt>
                <dd className='font-medium'>{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <ActivityFundingSummary amounts={user} />
      <Suspense fallback={<LoadingState />}>
        <Trend days={data.days} />
      </Suspense>
      <p className='text-muted-foreground text-xs'>
        {t('Pending settlements')}: {formatNumber(user.pending_records, locale)}{' '}
        · {t('Excluded from spending totals')}
      </p>
    </div>
  )
}
