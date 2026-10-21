import {
  Activity01Icon,
  Alert02Icon,
  ChartHistogramIcon,
  Clock01Icon,
  HeartCheckIcon,
} from '@hugeicons/core-free-icons'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { auditRate } from './api'
import type { Health } from './dashboard-types'
import { StatusMetric, StatusPanel, StatusTrend } from './status-charts'

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
  const latest = ['15m', '30m', '1h']
    .map((key) => data.windows[key])
    .find((window) => window?.requests > 0)
  const hour = data.windows['1h']
  let status = t('No data')
  let color = 'var(--muted-foreground)'
  if (latest) {
    status = t('Unavailable')
    color = 'var(--destructive)'
    if (latest.successRate >= 99) {
      status = t('Healthy')
      color = 'var(--success)'
    } else if (latest.successRate >= 95) {
      status = t('Needs attention')
      color = 'var(--primary)'
    } else if (latest.successRate >= 85) {
      status = t('Degraded')
      color = 'var(--warning)'
    }
    if (
      data.windows['15m']?.requests > 0 &&
      latest.successRate >= 95 &&
      hour?.requests > 0 &&
      hour.successRate < 95
    ) {
      status = t('Recovering')
    }
  }
  const errors = data.errors.filter(
    (error) => !internalErrors.has(error.errorCode.trim())
  )
  const failed =
    hour?.failedRequests ??
    errors.reduce((sum, error) => sum + error.requests, 0)
  const models = [...data.models].sort((a, b) => b.requests - a.requests)
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='font-semibold'>{t('Recent request success rate')}</h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Request audit statistics')}
            {data.asOf &&
              ` · ${new Date(data.asOf).toLocaleTimeString(locale, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div className='flex gap-2'>
          <Badge variant='outline' style={{ color }}>
            {status}
          </Badge>
          {data.stale && (
            <Badge variant='warning'>{t('Statistics are stale')}</Badge>
          )}
        </div>
      </div>
      <div className='grid gap-4 sm:grid-cols-3'>
        {[
          {
            key: '15m',
            label: t('Last {{count}} minutes', { count: 15 }),
            buckets: 3,
            icon: Clock01Icon,
          },
          {
            key: '30m',
            label: t('Last {{count}} minutes', { count: 30 }),
            buckets: 6,
            icon: HeartCheckIcon,
          },
          {
            key: '1h',
            label: t('Last {{count}} hours', { count: 1 }),
            buckets: 12,
            icon: Activity01Icon,
          },
        ].map((window) => {
          const stats = data.windows[window.key]
          const rate = auditRate(
            stats?.successfulRequests ?? null,
            stats?.requests ?? null
          )
          let tone = 'var(--muted-foreground)'
          if (rate !== null) {
            tone = 'var(--destructive)'
            if (rate >= 99) tone = 'var(--success)'
            else if (rate >= 95) tone = 'var(--primary)'
            else if (rate >= 85) tone = 'var(--warning)'
          }
          return (
            <StatusMetric
              key={window.key}
              label={window.label}
              value={rate === null ? '—' : `${formatNumber(rate, locale)}%`}
              detail={`${formatNumber(stats?.requests ?? 0, locale)} ${t('Requests')} · ${formatNumber(stats?.failedRequests ?? 0, locale)} ${t('Failed requests')}`}
              icon={window.icon}
              color={tone}
              series={data.series
                .slice(-window.buckets)
                .filter((point) => point.requests > 0)
                .map((point) => ({
                  value: auditRate(point.successfulRequests, point.requests),
                }))}
            />
          )
        })}
      </div>
      <StatusTrend
        title={t('Request trend')}
        description={t('Last hour · bar height represents request count')}
        data={data.series}
        health
        fields={[
          {
            key: 'successfulRequests',
            label: t('Successful requests'),
            color: 'var(--success)',
            kind: 'bar',
          },
          {
            key: 'failedRequests',
            label: t('Failed requests'),
            color: 'var(--destructive)',
            kind: 'bar',
          },
        ]}
      />
      <div className='grid items-stretch gap-4 lg:grid-cols-2'>
        <StatusPanel
          title={t('Upstream model health')}
          description={t('Last hour · sorted by requests')}
          icon={ChartHistogramIcon}
          tone='text-chart-3'
        >
          <div className='flex flex-col gap-4'>
            {models.length === 0 && <EmptyState />}
            {models.map((model) => {
              const rate = auditRate(model.successfulRequests, model.requests)
              return (
                <div key={model.model}>
                  <div className='flex justify-between gap-3 text-sm'>
                    <span className='min-w-0 font-medium break-all'>
                      {model.model}
                    </span>
                    <span className='shrink-0 tabular-nums'>
                      {rate === null ? '—' : `${formatNumber(rate, locale)}%`}
                    </span>
                  </div>
                  <Progress
                    value={rate ?? 0}
                    aria-label={model.model}
                    className={`[&_[data-slot=progress-indicator]]:bg-success mt-2 ${model.requests > 0 ? '[&_[data-slot=progress-track]]:bg-destructive' : ''}`}
                  />
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {formatNumber(model.requests, locale)} {t('Requests')} ·{' '}
                    {formatNumber(model.failedRequests, locale)}{' '}
                    {t('Failed requests')}
                    {model.mainError &&
                      !internalErrors.has(model.mainError.errorCode.trim()) && (
                        <span className='text-destructive'>
                          {' '}
                          ·{' '}
                          {model.mainError.statusCode >= 400
                            ? model.mainError.statusCode
                            : ''}{' '}
                          {model.mainError.errorCode ===
                          'client_stream_interrupted'
                            ? t('Client disconnected')
                            : model.mainError.errorCode}
                        </span>
                      )}
                  </p>
                </div>
              )
            })}
          </div>
        </StatusPanel>
        <StatusPanel
          title={t('Failure reasons')}
          description={`${t('Last {{count}} hours', { count: 1 })} · ${formatNumber(failed, locale)} ${t('Failed requests')}`}
          icon={Alert02Icon}
          tone='text-warning'
        >
          <div className='flex flex-col gap-4'>
            {errors.length === 0 && (
              <EmptyState title={t('No failed requests')} />
            )}
            {errors.map((error) => {
              const share = auditRate(error.requests, failed)
              return (
                <div key={`${error.statusCode}:${error.errorCode}`}>
                  <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <Badge variant='warning'>
                        {error.statusCode >= 400
                          ? error.statusCode
                          : t('Error')}
                      </Badge>
                      <span className='break-all'>
                        {error.errorCode === 'client_stream_interrupted'
                          ? t('Client disconnected')
                          : error.errorCode || t('Unknown')}
                      </span>
                    </span>
                    <span className='text-muted-foreground'>
                      {formatNumber(error.requests, locale)} ·{' '}
                      {share === null ? '—' : `${formatNumber(share, locale)}%`}
                    </span>
                  </div>
                  <Progress
                    value={share ?? 0}
                    aria-label={error.errorCode || t('Unknown')}
                    className='[&_[data-slot=progress-indicator]]:bg-destructive mt-2'
                  />
                </div>
              )
            })}
          </div>
        </StatusPanel>
      </div>
    </div>
  )
}
