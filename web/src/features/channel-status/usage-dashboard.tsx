import {
  Activity01Icon,
  AiBrain01Icon,
  ChartHistogramIcon,
  Clock01Icon,
  Coins01Icon,
} from '@hugeicons/core-free-icons'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { auditRate } from './api'
import type { Usage } from './dashboard-types'
import { StatusMetric, StatusPanel, StatusTrend } from './status-charts'

const providerColors: Record<string, string> = {
  grok_build: 'bg-chart-1',
  grok_web: 'bg-chart-3',
  grok_console: 'bg-chart-4',
}
const intensityColors = [
  'bg-muted',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/70',
  'bg-primary',
]

export function UsageDashboard(props: { data: Usage }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data = props.data
  const usage = data.usage
  if (!data.reachable) {
    return <EmptyState title={t('Upstream is currently unreachable')} />
  }
  const maxActivity = Math.max(
    1,
    ...data.activity.map((point) => point.requests)
  )
  const totalProviderRequests = data.providers.reduce(
    (sum, provider) => sum + provider.requests,
    0
  )
  const providers = data.providers.map((provider) => ({
    ...provider,
    color: providerColors[provider.provider] ?? 'bg-chart-4',
  }))
  const stripes = Array.from({ length: 40 }, (_, index) => {
    const id = `provider-stripe-${index}`
    if (totalProviderRequests === 0) return { id, color: 'bg-muted' }
    const target = ((index + 0.5) / 40) * totalProviderRequests
    let cumulative = 0
    const provider = providers.find((provider) => {
      cumulative += provider.requests
      return cumulative >= target
    })
    return { id, color: provider?.color ?? 'bg-muted' }
  })
  return (
    <div className='flex flex-col gap-4'>
      <div>
        <h2 className='font-semibold'>{t('Request dashboard')}</h2>
        {data.range.start && data.range.end && (
          <p className='text-muted-foreground mt-1 text-xs'>
            {new Date(data.range.start).toLocaleString(locale, {
              timeZone: 'Asia/Shanghai',
            })}{' '}
            –{' '}
            {new Date(data.range.end).toLocaleString(locale, {
              timeZone: 'Asia/Shanghai',
            })}
          </p>
        )}
      </div>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <StatusMetric
          label={t('Requests')}
          value={formatNumber(usage.requests, locale)}
          detail={`${t('HTTP success rate')} ${usage.requests > 0 ? `${formatNumber(usage.successRate, locale)}%` : '—'} · ${t('Failed requests')} ${formatNumber(usage.failedRequests, locale)}`}
          icon={Activity01Icon}
          color='var(--chart-1)'
        />
        <StatusMetric
          label={t('Total tokens')}
          value={formatNumber(usage.tokens, locale)}
          detail={`${t('Cache hit rate')} ${usage.inputTokens > 0 ? `${formatNumber(usage.cacheHitRate, locale)}%` : '—'} · ${t('Input tokens')} ${formatNumber(usage.inputTokens, locale)}`}
          icon={AiBrain01Icon}
          color='var(--chart-3)'
        />
        <StatusMetric
          label={t('Upstream cost')}
          value={formatBillingCurrencyFromUSD(
            usage.billedCostUsdTicks / 10_000_000_000,
            { locale }
          )}
          detail={`${t('Average request cost')} ${usage.requests > 0 ? formatBillingCurrencyFromUSD(usage.billedCostUsdTicks / 10_000_000_000 / usage.requests, { locale }) : '—'}`}
          icon={Coins01Icon}
          color='var(--chart-4)'
        />
        <StatusMetric
          label={t('First token latency (ms)')}
          value={
            usage.firstTokenSamples > 0
              ? formatNumber(usage.averageFirstTokenMs, locale)
              : '—'
          }
          detail={`${t('Output tokens per second')} ${usage.throughputSamples > 0 ? formatNumber(usage.outputTokensPerSecond, locale) : '—'} · ${formatNumber(usage.throughputSamples, locale)} ${t('Samples')}`}
          icon={Clock01Icon}
          color='var(--chart-2)'
        />
      </div>
      <div className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
        <StatusTrend
          title={t('Usage trend')}
          description={t('Requests, tokens and cost over time')}
          data={data.series.map((point) => ({
            ...point,
            costUsd: point.billedCostUsdTicks / 10_000_000_000,
          }))}
          fields={[
            {
              key: 'tokens',
              label: t('Total tokens'),
              color: 'var(--chart-3)',
              kind: 'area',
            },
            {
              key: 'costUsd',
              label: t('Upstream cost (USD)'),
              color: 'var(--chart-4)',
              kind: 'bar',
            },
            {
              key: 'requests',
              label: t('Requests'),
              color: 'var(--chart-1)',
              kind: 'line',
            },
          ]}
        />
        <StatusPanel
          title={t('Provider distribution')}
          description={t('By request count')}
          icon={ChartHistogramIcon}
          tone='text-chart-3'
        >
          {providers.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className='flex h-12 gap-1' aria-hidden='true'>
                {stripes.map((stripe) => (
                  <span
                    key={stripe.id}
                    className={cn('min-w-0 flex-1 rounded-sm', stripe.color)}
                  />
                ))}
              </div>
              <div className='mt-4 divide-y'>
                {providers.map((provider) => {
                  const share = auditRate(
                    provider.requests,
                    totalProviderRequests
                  )
                  const rate = auditRate(
                    provider.successfulRequests,
                    provider.requests
                  )
                  return (
                    <div
                      key={provider.provider}
                      className='flex items-center justify-between gap-3 py-4'
                    >
                      <div className='flex min-w-0 items-center gap-3'>
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            provider.color
                          )}
                        />
                        <div className='min-w-0'>
                          <p className='text-sm font-medium break-all capitalize'>
                            {provider.provider.replace(/^grok_/, '')}
                          </p>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {t('HTTP success rate')}{' '}
                            {rate === null
                              ? '—'
                              : `${formatNumber(rate, locale)}%`}{' '}
                            · {t('Total tokens')}{' '}
                            {formatNumber(provider.tokens, locale)}
                          </p>
                        </div>
                      </div>
                      <div className='shrink-0 text-right text-sm tabular-nums'>
                        {formatNumber(provider.requests, locale)}
                        <p className='text-muted-foreground mt-1 text-xs'>
                          {share === null
                            ? '—'
                            : `${formatNumber(share, locale)}%`}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </StatusPanel>
      </div>
      <div className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
        <StatusPanel
          title={t('Top models')}
          description={t('By request count')}
          icon={AiBrain01Icon}
          tone='text-chart-3'
        >
          <StaticDataTable
            data={[...data.topModels].sort((a, b) => b.requests - a.requests)}
            emptyContent={<EmptyState />}
            columns={[
              {
                id: 'model',
                header: t('Model'),
                cell: (row) => (
                  <div className='max-w-64 min-w-36 whitespace-normal'>
                    <p className='font-medium break-all'>{row.model}</p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {t('Input tokens')}{' '}
                      {formatNumber(row.inputTokens, locale)} ·{' '}
                      {t('Output tokens')}{' '}
                      {formatNumber(row.outputTokens, locale)} ·{' '}
                      {t('Cached input tokens')}{' '}
                      {formatNumber(row.cachedInputTokens, locale)} ·{' '}
                      {t('Reasoning tokens')}{' '}
                      {formatNumber(row.reasoningTokens, locale)}
                    </p>
                  </div>
                ),
              },
              {
                id: 'cost',
                header: t('Upstream cost'),
                cell: (row) => (
                  <span className='text-chart-4'>
                    {formatBillingCurrencyFromUSD(
                      row.billedCostUsdTicks / 10_000_000_000,
                      { locale }
                    )}
                  </span>
                ),
              },
              {
                id: 'tokens',
                header: t('Total tokens'),
                cell: (row) => formatNumber(row.tokens, locale),
              },
              {
                id: 'requests',
                header: t('Requests'),
                cell: (row) => formatNumber(row.requests, locale),
              },
            ]}
          />
        </StatusPanel>
        <StatusPanel
          title={t('Request activity')}
          description={t('Daily request count')}
          icon={Activity01Icon}
          tone='text-primary'
        >
          {data.activity.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <p className='text-2xl font-semibold tabular-nums'>
                {formatNumber(
                  data.activity.reduce((sum, point) => sum + point.requests, 0),
                  locale
                )}
              </p>
              <div
                className='mt-4 grid grid-flow-col grid-rows-7 gap-1'
                style={{
                  gridTemplateColumns: `repeat(${Math.ceil(data.activity.length / 7)}, minmax(0, 1fr))`,
                }}
              >
                {data.activity.map((point) => {
                  let level = 0
                  if (point.requests > 0) {
                    level = Math.max(
                      1,
                      Math.ceil(
                        (Math.log1p(point.requests) / Math.log1p(maxActivity)) *
                          4
                      )
                    )
                  }
                  const future =
                    data.generatedAt != null &&
                    new Date(point.start) > new Date(data.generatedAt)
                  const label = `${new Date(point.start).toLocaleDateString(locale, { timeZone: 'Asia/Shanghai' })}: ${formatNumber(point.requests, locale)} ${t('Requests')}`
                  return (
                    <span
                      key={point.start}
                      className={cn(
                        'aspect-square min-w-0 rounded-sm',
                        future ? 'bg-muted/40' : intensityColors[level]
                      )}
                      role='img'
                      aria-label={label}
                      title={label}
                    />
                  )
                })}
              </div>
              <div className='text-muted-foreground mt-3 flex items-center justify-end gap-1 text-xs'>
                <span>{t('Less')}</span>
                {intensityColors.map((color) => (
                  <span
                    key={color}
                    className={cn('size-2.5 rounded-sm', color)}
                  />
                ))}
                <span>{t('More')}</span>
              </div>
            </>
          )}
        </StatusPanel>
      </div>
    </div>
  )
}
