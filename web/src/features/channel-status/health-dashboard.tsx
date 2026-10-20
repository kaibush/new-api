import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { auditRate } from './api'
import type { Health } from './dashboard-types'
import { StatusMetrics, StatusTrend } from './status-charts'

const internalErrors = new Set([
  'quality_degraded',
  'thinking_standby_probe_degraded',
  'thinking_standby_probe_error',
])

export function HealthDashboard(props: { data: Health }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data = props.data
  if (!data.enabled) {
    return <EmptyState title={t('Request health is not enabled')} />
  }
  const latest = data.windows['15m']
  const hour = data.windows['1h']
  let status = t('No data')
  if (latest?.requests > 0) {
    status = t('Unavailable')
    if (latest.successRate >= 99) status = t('Healthy')
    else if (latest.successRate >= 95) status = t('Needs attention')
    else if (latest.successRate >= 85) status = t('Degraded')
    if (
      latest.successRate >= 95 &&
      hour?.requests > 0 &&
      hour.successRate < 95
    ) {
      status = t('Recovering')
    }
  }
  return (
    <div className='space-y-4'>
      <div className='flex gap-2'>
        <Badge variant='outline'>{status}</Badge>
        {data.stale && (
          <Badge variant='destructive'>{t('Statistics are stale')}</Badge>
        )}
      </div>
      <div className='grid gap-4 lg:grid-cols-3'>
        {['15m', '30m', '1h'].map((window) => {
          const stats = data.windows[window]
          if (!stats) return null
          const rate = auditRate(stats.successfulRequests, stats.requests)
          return (
            <section key={window} className='space-y-2' aria-label={window}>
              <h3 className='font-medium'>{window}</h3>
              <StatusMetrics
                items={[
                  [t('Requests'), formatNumber(stats.requests, locale)],
                  [
                    t('HTTP success rate'),
                    rate === null ? '—' : `${formatNumber(rate, locale)}%`,
                  ],
                  [
                    t('Failed requests'),
                    formatNumber(stats.failedRequests, locale),
                  ],
                ]}
              />
            </section>
          )
        })}
      </div>
      <StatusTrend
        title={t('Request health')}
        data={data.series}
        fields={[
          { key: 'successfulRequests', label: t('Successful requests') },
          { key: 'failedRequests', label: t('Failed requests') },
        ]}
      />
      <h3 className='font-semibold'>{t('Models')}</h3>
      <StaticDataTable
        data={data.models}
        emptyContent={<EmptyState />}
        columns={[
          { id: 'model', header: t('Model'), cell: (row) => row.model },
          {
            id: 'requests',
            header: t('Requests'),
            cell: (row) => formatNumber(row.requests, locale),
          },
          {
            id: 'rate',
            header: t('HTTP success rate'),
            cell: (row) =>
              row.requests > 0
                ? `${formatNumber(row.successRate, locale)}%`
                : '—',
          },
          {
            id: 'error',
            header: t('Error code'),
            cell: (row) =>
              row.mainError &&
              !internalErrors.has(row.mainError.errorCode.trim())
                ? `${row.mainError.statusCode} ${row.mainError.errorCode}`
                : '—',
          },
        ]}
      />
      <h3 className='font-semibold'>{t('Errors')}</h3>
      <StaticDataTable
        data={data.errors.filter(
          (error) => !internalErrors.has(error.errorCode.trim())
        )}
        emptyContent={<EmptyState />}
        columns={[
          {
            id: 'status',
            header: t('HTTP status'),
            cell: (row) => row.statusCode,
          },
          {
            id: 'error',
            header: t('Error code'),
            cell: (row) => row.errorCode,
          },
          {
            id: 'count',
            header: t('Requests'),
            cell: (row) => formatNumber(row.requests, locale),
          },
        ]}
      />
    </div>
  )
}
