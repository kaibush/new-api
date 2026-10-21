import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { auditRate, type AuditClient } from './api'

export function AuditCard(props: {
  client: AuditClient
  maxRequests: number
  summary?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const quality = auditRate(
    props.client.thinkingRequests,
    props.client.thinkingSampleRequests
  )
  const http = auditRate(
    props.client.httpSuccessRequests,
    props.client.requestCount
  )
  const activity = auditRate(props.client.requestCount, props.maxRequests)
  return (
    <Card className='min-w-0'>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <CardTitle className='break-words'>
            {props.summary
              ? t('Request quality')
              : props.client.name || t('Unknown')}
          </CardTitle>
          <p className='text-muted-foreground mt-1 text-xs'>
            {props.summary ? 'GrokIQ' : t('Active clients')}
            {props.client.lastSeenAt && (
              <>
                {' '}
                ·{' '}
                <time dateTime={props.client.lastSeenAt}>
                  {new Date(props.client.lastSeenAt).toLocaleString(locale)}
                </time>
              </>
            )}
          </p>
        </div>
        <Badge variant='secondary'>
          {formatNumber(props.client.requestCount, locale)} {t('Requests')}
        </Badge>
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='grid grid-cols-2 gap-4'>
          {[
            { label: t('Quality pass rate'), value: quality },
            { label: t('HTTP success rate'), value: http },
          ].map((metric) => {
            // Health rates share thresholds; activity is a neutral volume comparison.
            let tone = 'text-muted-foreground'
            if (metric.value != null) {
              tone = 'text-destructive'
              if (metric.value >= 99) tone = 'text-success'
              else if (metric.value >= 95) tone = 'text-warning'
            }
            return (
              <div key={metric.label} className={tone}>
                <p className='text-muted-foreground text-sm'>{metric.label}</p>
                <p className='mt-1 text-2xl font-semibold tabular-nums'>
                  {metric.value == null
                    ? '—'
                    : `${formatNumber(metric.value, locale)}%`}
                </p>
                <Progress
                  className='mt-2 [&_[data-slot=progress-indicator]]:bg-current [&_[data-slot=progress-track]]:bg-current/10'
                  value={metric.value ?? 0}
                  aria-label={metric.label}
                />
              </div>
            )
          })}
        </div>
        {props.summary && props.client.requestCount === 0 && (
          <EmptyState
            title={t('No requests in this time range')}
            className='min-h-0 p-3 [&_[data-slot=empty-header]]:max-w-none [&_[data-slot=empty-header]]:flex-row [&_[data-slot=empty-icon]]:mb-0'
          />
        )}
        {!props.summary && (
          <div>
            <div className='text-muted-foreground mb-2 flex justify-between gap-2 text-xs'>
              <span>{t('Relative activity')}</span>
              <span>
                {activity == null ? '—' : `${formatNumber(activity, locale)}%`}
              </span>
            </div>
            <Progress
              className='text-primary [&_[data-slot=progress-indicator]]:bg-current [&_[data-slot=progress-track]]:bg-current/10'
              value={activity ?? 0}
              aria-label={t('Relative activity')}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
