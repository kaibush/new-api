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
import { VChart } from '@visactor/react-vchart'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTheme } from '@/context/theme-provider'
import { getUserQuotaDataByUsers } from '@/features/dashboard/api'
import { processUserChartData } from '@/features/dashboard/lib/charts'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { formatDateTimeObject, getRollingDateRange } from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'

import { UserChartFilters } from './user-chart-filters'
import { UserRanking } from './user-ranking'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

interface UserChartsProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
}

export function UserCharts(props: UserChartsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const metric = props.filters.metric ?? 'quota'
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const selectedRange = props.filters.selectedRange
  const timeRange = useMemo(() => {
    const { start, end } = getRollingDateRange(selectedRange)
    return {
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    }
  }, [selectedRange])

  useEffect(() => {
    let active = true
    setThemeReady(false)
    themeManagerPromise ??= import('@visactor/vchart').then(
      (m) => m.ThemeManager
    )
    void themeManagerPromise.then((ThemeManager) => {
      if (!active) return
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    })
    return () => {
      active = false
    }
  }, [resolvedTheme])

  const query = useQuery({
    queryKey: ['dashboard', 'user-quota', timeRange],
    queryFn: async () =>
      requireServerSuccess(await getUserQuotaDataByUsers(timeRange)),
    select: (res) => res.data,
    staleTime: 60_000,
  })
  const chartData = useMemo(
    () =>
      processUserChartData(
        query.data ?? [],
        props.filters.timeGranularity,
        t,
        props.filters.topUserLimit,
        metric,
        locale
      ),
    [
      query.data,
      props.filters.timeGranularity,
      t,
      props.filters.topUserLimit,
      metric,
      locale,
    ]
  )
  const rankTitle =
    metric === 'tokens'
      ? t('User Token Ranking')
      : t('User Consumption Ranking')
  const trendTitle =
    metric === 'tokens' ? t('User Token Trend') : t('User Consumption Trend')
  const hasData = chartData.ranking.length > 0

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <Card>
        <CardContent className='flex flex-col gap-3'>
          <UserChartFilters
            filters={props.filters}
            onFiltersChange={props.onFiltersChange}
          />
          <p className='text-muted-foreground text-xs tabular-nums'>
            {formatDateTimeObject(new Date(timeRange.start_timestamp * 1000))}
            {' – '}
            {formatDateTimeObject(new Date(timeRange.end_timestamp * 1000))}
          </p>
        </CardContent>
      </Card>
      {query.isLoading && (
        <Skeleton
          className='h-80 w-full'
          role='status'
          aria-label={t('Loading...')}
        />
      )}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {!query.isLoading && !query.isError && !hasData && (
        <EmptyState title={t('No data available')} />
      )}
      {!query.isLoading && !query.isError && hasData && (
        <>
          <div className='flex flex-col gap-3'>
            <p role='status' className='text-muted-foreground text-sm'>
              {t('Showing {{shown}} of {{total}} users', {
                shown: formatNumber(chartData.ranking.length, locale),
                total: formatNumber(chartData.totalUsers, locale),
              })}
            </p>
            <dl className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <Card>
                <CardContent>
                  <dt className='text-muted-foreground text-xs'>
                    {t('All users total')}
                  </dt>
                  <dd className='mt-1 text-xl font-semibold break-all tabular-nums'>
                    {chartData.totalDisplay}
                  </dd>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <dt className='text-muted-foreground text-xs'>
                    {t('Displayed users total')}
                  </dt>
                  <dd className='mt-1 text-xl font-semibold break-all tabular-nums'>
                    {chartData.selectedTotalDisplay}
                  </dd>
                </CardContent>
              </Card>
            </dl>
          </div>
          <div className='grid min-w-0 items-start gap-4 xl:grid-cols-2'>
            <Card className='min-w-0'>
              <CardHeader>
                <CardTitle>{rankTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <UserRanking
                  data={chartData.ranking}
                  metric={metric}
                  title={rankTitle}
                />
              </CardContent>
            </Card>
            <Card className='min-w-0'>
              <CardHeader>
                <CardTitle>{trendTitle}</CardTitle>
                <CardDescription>
                  {t('Trend for the same users shown in the ranking')}
                </CardDescription>
              </CardHeader>
              <CardContent className='flex min-w-0 flex-col gap-3'>
                <div className='h-72 min-w-0 sm:h-80'>
                  {themeReady ? (
                    <VChart
                      key={`user-${metric}-${props.filters.topUserLimit}-${props.filters.timeGranularity}-${resolvedTheme}`}
                      spec={{
                        ...chartData.spec_user_trend,
                        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                        background: 'transparent',
                      }}
                      option={VCHART_OPTION}
                    />
                  ) : (
                    <Skeleton className='h-full w-full' />
                  )}
                </div>
                <ul
                  tabIndex={0}
                  aria-label={t('Displayed users')}
                  className='flex max-h-32 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-xs'
                >
                  {chartData.ranking.map((row) => (
                    <li
                      key={row.username}
                      className='flex min-w-0 items-center gap-1.5'
                    >
                      <span
                        aria-hidden='true'
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: row.color }}
                      />
                      <span className='break-all'>{row.username}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
