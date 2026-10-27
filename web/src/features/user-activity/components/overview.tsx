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
import { Activity, Users, Wallet, Clock } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { getActivityOverview } from '../api'
import { ActivityFundingSummary } from './funding-summary'
import { ActivityPeriodNote } from './period-note'

const Trend = lazy(() =>
  import('./usage-trend').then((module) => ({
    default: module.UserActivityTrend,
  }))
)

export function UserActivityOverviewPanel(props: {
  days: number
  onUsers: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: ['user-activity', 'overview', props.days],
    queryFn: ({ signal }) => getActivityOverview(props.days, signal),
    refetchInterval: 30000,
  })
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  if (!query.data) return <LoadingState />
  const data = query.data
  return (
    <section className='space-y-4' aria-label={t('Global usage overview')}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <ActivityPeriodNote period={data} />
        <Button
          size='sm'
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        {[
          {
            title: t('Users'),
            value: formatNumber(data.total_users, locale),
            description: t('All users'),
            icon: Users,
          },
          {
            title: t('Users with spending'),
            value: formatNumber(data.consuming_users, locale),
            description: t('Positive settled spending in this period'),
            icon: Activity,
          },
          {
            title: t('Settled spending'),
            value: formatQuotaWithCurrency(data.consumed_quota),
            description: t('After refunds'),
            icon: Wallet,
          },
          {
            title: t('Pending settlements'),
            value: formatNumber(data.pending_records, locale),
            description: t('Excluded from spending totals'),
            icon: Clock,
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardContent className='pt-5'>
              <StatCard {...item} compactMobile />
            </CardContent>
          </Card>
        ))}
      </div>
      <ActivityFundingSummary amounts={data} />
      <Card>
        <CardContent className='pt-5'>
          <Suspense fallback={<LoadingState />}>
            <Trend days={data.days} />
          </Suspense>
        </CardContent>
      </Card>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-xs'>
          {t('Users with incomplete history')}:{' '}
          {formatNumber(data.incomplete_users, locale)} ·{' '}
          {t('Only recorded spending is shown.')}
        </p>
        <Button variant='outline' onClick={props.onUsers}>
          {t('View user usage')}
        </Button>
      </div>
    </section>
  )
}
