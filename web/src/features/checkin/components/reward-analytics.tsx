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
import type { IBarChartSpec } from '@visactor/vchart'
import { useTheme } from 'next-themes'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'

import { getCheckinAnalytics } from '../api'
import { formatCheckinPercent } from '../format'
import type { CheckinAnalytics } from '../types'

const EMPTY_SERIES: CheckinAnalytics['daily_series'] = []
const EMPTY_TIERS: CheckinAnalytics['configured_tiers'] = []

const palette = [
  '#94a3b8',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#f43f5e',
]

export function RewardAnalytics() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { resolvedTheme } = useTheme()
  const [days, setDays] = useState(7)
  const [metric, setMetric] = useState('count')
  const query = useQuery({
    queryKey: ['checkin-analytics', days],
    queryFn: () => getCheckinAnalytics(days),
    refetchInterval: 30000,
  })
  const series = query.data?.daily_series ?? EMPTY_SERIES
  const configured = query.data?.configured_tiers ?? EMPTY_TIERS
  const spec = useMemo<IBarChartSpec>(() => {
    const labels = new Map(
      series.flatMap((day) =>
        day.tiers.map((tier) => [tier.bucket_key, tier.bucket_label] as const)
      )
    )
    const specified: Record<string, string> = {}
    for (const [index, tier] of configured.entries()) {
      labels.set(tier.key, tier.name)
      specified[tier.key] = palette[index % palette.length]
    }
    return {
      type: 'bar',
      stack: true,
      percent: metric === 'share',
      animation: false,
      data: [
        {
          id: 'rewards',
          values: series.flatMap((day) =>
            day.tiers.map((tier) => ({
              date: day.date.slice(5),
              tier_key: tier.bucket_key,
              tier: tier.bucket_label,
              value: metric === 'quota' ? tier.total_quota : tier.checkin_count,
            }))
          ),
        },
      ],
      xField: 'date',
      yField: 'value',
      seriesField: 'tier_key',
      color: {
        type: 'ordinal',
        domain: [...labels.keys()],
        range: palette,
        specified,
      },
      background: 'transparent',
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      axes: [
        {
          orient: 'left',
          label: {
            formatMethod: (value) => {
              if (metric === 'quota') {
                return formatQuotaWithCurrency(Number(value))
              }
              if (metric === 'share') {
                return formatCheckinPercent(Number(value) * 100, locale)
              }
              return formatNumber(Number(value), locale)
            },
          },
        },
      ],
      legends: {
        visible: true,
        orient: 'bottom',
        item: {
          label: {
            formatMethod: (value) => labels.get(String(value)) ?? String(value),
          },
        },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum) => String(datum?.tier ?? ''),
              value: (datum) =>
                metric === 'quota'
                  ? formatQuotaWithCurrency(Number(datum?.value ?? 0))
                  : formatNumber(Number(datum?.value ?? 0), locale),
            },
          ],
        },
      },
    }
  }, [series, configured, metric, resolvedTheme, locale])
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const data = query.data
  const today = series.at(-1)
  const total = series.reduce((sum, day) => sum + day.total_checkins, 0)
  const quota = series.reduce((sum, day) => sum + day.total_quota, 0)
  const high =
    today?.tiers
      .filter(
        (tier) => !['uniform', configured[0]?.key].includes(tier.bucket_key)
      )
      .reduce((sum, tier) => sum + tier.checkin_count, 0) ?? 0
  const tierRows = configured.map((tier) => ({
    ...tier,
    actual: today?.tiers.find((row) => row.bucket_key === tier.key),
  }))
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, '0')}:00`,
    count:
      today?.hours.find(
        (row) => row.bucket_key === String(hour).padStart(2, '0')
      )?.checkin_count ?? 0,
  }))
  const maxHour = Math.max(1, ...hours.map((hour) => hour.count))
  const retention = data.retention_days ?? 30
  const periods = [
    ...new Set(
      [1, 7, 14, retention].map((period) => Math.min(period, retention))
    ),
  ]
  return (
    <section className='space-y-4' aria-label={t('Check-in analytics')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-lg font-semibold'>{t('Check-in analytics')}</h3>
          <p className='text-muted-foreground text-xs'>
            {data.today} · {data.timezone} · {t('Statistics retention (days)')}:{' '}
            {formatNumber(retention, locale)}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Select
            value={Math.min(days, retention)}
            onValueChange={(value) => setDays(Number(value))}
            items={periods.map((period) => ({
              value: period,
              label: t('Last {{count}} days', { count: period }),
            }))}
          >
            <SelectTrigger aria-label={t('Check-in statistics period')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((period) => (
                <SelectItem key={period} value={period}>
                  {t('Last {{count}} days', { count: period })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant='outline'
            size='sm'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
      </div>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {[
          {
            label: t("Today's check-ins"),
            value: formatNumber(today?.total_checkins ?? 0, locale),
          },
          {
            label: t('Quota issued in period'),
            value: formatQuotaWithCurrency(quota),
          },
          {
            label: t('Actual high-tier rate'),
            value: formatCheckinPercent(
              today?.total_checkins ? (high * 100) / today.total_checkins : 0,
              locale
            ),
          },
          {
            label: t('Today’s high-tier budget usage'),
            value:
              data.daily_pool?.enabled && data.daily_pool.daily_bonus_cap > 0
                ? `${formatQuotaWithCurrency(data.today_pool_used)} / ${formatQuotaWithCurrency(data.daily_pool.daily_bonus_cap)}`
                : t('Unlimited'),
          },
        ].map((item) => (
          <Card key={item.label} size='sm'>
            <CardContent className='pt-4'>
              <p className='text-muted-foreground text-xs'>{item.label}</p>
              <p className='mt-2 text-xl font-semibold tabular-nums'>
                {item.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('Daily check-in trend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(String(value))}
          >
            <TabsList className='max-w-full flex-wrap group-data-horizontal/tabs:h-auto'>
              <TabsTrigger value='count'>{t('Check-in count')}</TabsTrigger>
              <TabsTrigger value='share'>{t('Proportion (%)')}</TabsTrigger>
              <TabsTrigger value='quota'>{t('Issued quota')}</TabsTrigger>
            </TabsList>
            <TabsContent value={metric}>
              {total > 0 ? (
                <>
                  <div className='mt-3 h-64' aria-hidden='true'>
                    <VChart spec={spec} option={VCHART_OPTION} />
                  </div>
                  <ul className='sr-only'>
                    {series.map((day) => (
                      <li key={day.date}>
                        {day.date}: {formatNumber(day.total_checkins, locale)},{' '}
                        {formatQuotaWithCurrency(day.total_quota)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  title={t('No check-ins yet')}
                  className='min-h-40'
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <div className='grid gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('Actual vs configured probabilities')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {tierRows.length === 0 && (
              <EmptyState title={t('Uniform')} className='min-h-32' />
            )}
            {tierRows.map((tier) => {
              const share = today?.total_checkins
                ? ((tier.actual?.checkin_count ?? 0) * 100) /
                  today.total_checkins
                : 0
              return (
                <div key={tier.key} className='space-y-2'>
                  <div className='flex items-center justify-between gap-3 text-sm'>
                    <span className='font-medium'>{tier.name}</span>
                    <span className='text-muted-foreground'>
                      {t('Actual')}: {formatCheckinPercent(share, locale)} ·{' '}
                      {t('Configured')}:{' '}
                      {formatCheckinPercent(tier.weight_bps / 100, locale)}
                    </span>
                  </div>
                  <Progress value={share} aria-label={tier.name} />
                  <p className='text-muted-foreground text-xs'>
                    {formatNumber(tier.actual?.checkin_count ?? 0, locale)} ·{' '}
                    {formatQuotaWithCurrency(tier.actual?.total_quota ?? 0)}
                  </p>
                </div>
              )
            })}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Configured values are current default probabilities. Time rules, daily limits and random variation affect actual results.'
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('Time slots')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {today?.slots.map((slot) => (
              <div key={slot.bucket_key} className='space-y-2'>
                <div className='flex items-center justify-between text-sm'>
                  <span>{slot.bucket_label}</span>
                  <span>
                    {formatCheckinPercent(
                      today.total_checkins
                        ? (slot.checkin_count * 100) / today.total_checkins
                        : 0,
                      locale
                    )}
                  </span>
                </div>
                <Progress
                  value={
                    today.total_checkins
                      ? (slot.checkin_count * 100) / today.total_checkins
                      : 0
                  }
                  aria-label={slot.bucket_label}
                />
                <p className='text-muted-foreground text-xs'>
                  {formatNumber(slot.checkin_count, locale)} ·{' '}
                  {formatQuotaWithCurrency(slot.total_quota)}
                </p>
              </div>
            ))}
            {!today?.slots.length && (
              <EmptyState title={t('No check-ins yet')} className='min-h-32' />
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('Hourly check-in distribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-6 gap-2 sm:grid-cols-12'>
            {hours.map((hour) => (
              <div
                key={hour.label}
                className='bg-primary/10 rounded-md p-2 text-center'
                style={{
                  backgroundColor: `color-mix(in srgb, var(--primary) ${10 + (hour.count * 35) / maxHour}%, var(--background))`,
                }}
              >
                <p className='text-muted-foreground text-xs'>
                  {hour.label.slice(0, 2)}
                </p>
                <p className='mt-1 text-sm font-semibold tabular-nums'>
                  {formatNumber(hour.count, locale)}
                </p>
              </div>
            ))}
          </div>
          <p className='text-muted-foreground mt-3 text-xs'>
            {t('Check-ins in period')}: {formatNumber(total, locale)} ·{' '}
            {t('Average reward')}:{' '}
            {formatQuotaWithCurrency(total ? quota / total : 0)} ·{' '}
            {t('Fallback draws')}:{' '}
            {formatNumber(
              series.reduce((sum, day) => sum + day.fallback_count, 0),
              locale
            )}
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
