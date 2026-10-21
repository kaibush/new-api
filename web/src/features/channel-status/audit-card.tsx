import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { auditRate, type AuditClient } from './api'

// Same bands as grok-iq thinking rate and HTTP normal rate: higher is healthier.
const rateBands = [
  {
    min: 95,
    label: '≥95%',
    swatch: 'bg-emerald-500',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    indicator: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
  },
  {
    min: 80,
    label: '≥80%',
    swatch: 'bg-sky-500',
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    indicator: '[&_[data-slot=progress-indicator]]:bg-sky-500',
  },
  {
    min: 60,
    label: '≥60%',
    swatch: 'bg-amber-500',
    chip: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
    indicator: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  },
  {
    min: 40,
    label: '≥40%',
    swatch: 'bg-orange-500',
    chip: 'bg-orange-500/12 text-orange-700 dark:text-orange-300',
    indicator: '[&_[data-slot=progress-indicator]]:bg-orange-500',
  },
  {
    min: 0,
    label: '<40%',
    swatch: 'bg-rose-500',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    indicator: '[&_[data-slot=progress-indicator]]:bg-rose-500',
  },
] as const

function rateBand(value: number | null) {
  if (value == null) return null
  return rateBands.find((band) => value >= band.min) ?? rateBands.at(-1) ?? null
}

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
            const band = rateBand(metric.value)
            return (
              <div key={metric.label} className='min-w-0'>
                <p className='text-muted-foreground text-sm'>{metric.label}</p>
                <p
                  className={cn(
                    'mt-1.5 w-fit rounded-md px-1.5 py-0.5 text-2xl leading-none font-semibold tabular-nums',
                    band ? band.chip : 'px-0 text-muted-foreground'
                  )}
                >
                  {metric.value == null
                    ? '—'
                    : `${formatNumber(metric.value, locale)}%`}
                </p>
                <Progress
                  className={cn(
                    'mt-2 [&_[data-slot=progress-track]]:bg-muted',
                    band?.indicator
                  )}
                  value={metric.value ?? 0}
                  aria-label={metric.label}
                />
              </div>
            )
          })}
        </div>
        {props.summary && (
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]'>
            {rateBands.map((band) => (
              <span key={band.label} className='inline-flex items-center gap-1'>
                <span
                  className={cn('size-2 rounded-[3px]', band.swatch)}
                  aria-hidden='true'
                />
                {band.label}
              </span>
            ))}
          </div>
        )}
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
