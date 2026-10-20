import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { Usage } from './dashboard-types'
import { StatusMetrics, StatusTrend } from './status-charts'

export function UsageDashboard(props: { data: Usage }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data = props.data
  const usage = data.usage
  const maxActivity = Math.max(
    1,
    ...data.activity.map((point) => point.requests)
  )
  return (
    <div className='space-y-4'>
      {!data.reachable && (
        <p role='status' className='text-destructive'>
          {t('Upstream is currently unreachable')}
        </p>
      )}
      <StatusMetrics
        items={[
          [t('Requests'), formatNumber(usage.requests, locale)],
          [
            t('Successful requests'),
            formatNumber(usage.successfulRequests, locale),
          ],
          [t('Failed requests'), formatNumber(usage.failedRequests, locale)],
          [
            t('Upstream cost'),
            formatBillingCurrencyFromUSD(
              usage.billedCostUsdTicks / 10_000_000_000,
              { locale }
            ),
          ],
          [t('Input tokens'), formatNumber(usage.inputTokens, locale)],
          [t('Output tokens'), formatNumber(usage.outputTokens, locale)],
          [
            t('Cached input tokens'),
            formatNumber(usage.cachedInputTokens, locale),
          ],
          [t('Reasoning tokens'), formatNumber(usage.reasoningTokens, locale)],
          [t('Total tokens'), formatNumber(usage.tokens, locale)],
          [
            t('Cache hit rate'),
            usage.inputTokens > 0
              ? `${formatNumber(usage.cacheHitRate, locale)}%`
              : '—',
          ],
          [
            t('First token latency (ms)'),
            usage.firstTokenSamples > 0
              ? formatNumber(usage.averageFirstTokenMs, locale)
              : '—',
          ],
          [
            t('Output tokens per second'),
            usage.throughputSamples > 0
              ? formatNumber(usage.outputTokensPerSecond, locale)
              : '—',
          ],
        ]}
      />
      <StatusTrend
        title={t('Requests')}
        data={data.series}
        fields={[{ key: 'requests', label: t('Requests') }]}
      />
      <StatusTrend
        title={t('Token usage')}
        data={data.series}
        fields={[
          { key: 'inputTokens', label: t('Input tokens') },
          { key: 'outputTokens', label: t('Output tokens') },
          { key: 'cachedInputTokens', label: t('Cached input tokens') },
        ]}
      />
      <StatusTrend
        title={t('Upstream cost (USD)')}
        data={data.series.map((point) => ({
          ...point,
          costUsd: point.billedCostUsdTicks / 10_000_000_000,
        }))}
        fields={[{ key: 'costUsd', label: t('Upstream cost (USD)') }]}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('Request activity')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activity.length === 0 ? (
            <EmptyState />
          ) : (
            <div className='flex flex-wrap gap-1'>
              {data.activity.map((point) => (
                <span
                  key={point.start}
                  className={cn(
                    'size-4 rounded-sm',
                    point.requests === 0 ? 'bg-muted' : 'bg-primary/30',
                    point.requests > maxActivity / 3 && 'bg-primary/60',
                    point.requests > (maxActivity * 2) / 3 && 'bg-primary'
                  )}
                  role='img'
                  aria-label={`${point.start}: ${formatNumber(point.requests, locale)}`}
                  title={`${point.start}: ${formatNumber(point.requests, locale)}`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <h3 className='font-semibold'>{t('Model usage')}</h3>
      <StaticDataTable
        data={data.topModels}
        emptyContent={<EmptyState />}
        columns={[
          { id: 'model', header: t('Model'), cell: (row) => row.model },
          {
            id: 'requests',
            header: t('Requests'),
            cell: (row) => formatNumber(row.requests, locale),
          },
          {
            id: 'tokens',
            header: t('Total tokens'),
            cell: (row) => formatNumber(row.tokens, locale),
          },
          {
            id: 'cost',
            header: t('Upstream cost'),
            cell: (row) =>
              formatBillingCurrencyFromUSD(
                row.billedCostUsdTicks / 10_000_000_000,
                { locale }
              ),
          },
        ]}
      />
      <h3 className='font-semibold'>{t('Providers')}</h3>
      <StaticDataTable
        data={data.providers}
        emptyContent={<EmptyState />}
        columns={[
          {
            id: 'provider',
            header: t('Provider'),
            cell: (row) => row.provider,
          },
          {
            id: 'requests',
            header: t('Requests'),
            cell: (row) => formatNumber(row.requests, locale),
          },
          {
            id: 'success',
            header: t('Successful requests'),
            cell: (row) => formatNumber(row.successfulRequests, locale),
          },
          {
            id: 'tokens',
            header: t('Total tokens'),
            cell: (row) => formatNumber(row.tokens, locale),
          },
        ]}
      />
    </div>
  )
}
