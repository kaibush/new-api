import { ArrowUpRight, CalendarDays, Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { CommunityEvent } from './event-api'

export function EventTiming(props: { event: CommunityEvent }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const event = props.event
  const started = now >= event.starts_at * 1000
  const ended = now >= event.ends_at * 1000
  const remaining = Math.max(
    0,
    Math.ceil(
      ((started ? event.ends_at : event.starts_at) * 1000 - now) / 60000
    )
  )
  let status = t('Upcoming')
  if (event.cancelled) status = t('Cancelled')
  else if (ended) status = t('Ended')
  else if (started) status = t('Live now')
  const duration = t('{{days}}d {{hours}}h {{minutes}}m', {
    days: formatNumber(Math.floor(remaining / 1440), locale),
    hours: formatNumber(Math.floor(remaining / 60) % 24, locale),
    minutes: formatNumber(remaining % 60, locale),
  })
  return (
    <span className='flex min-w-0 flex-col gap-2 text-xs'>
      <span className='flex flex-wrap items-center gap-2'>
        <Badge
          variant={
            started && !ended && !event.cancelled ? 'default' : 'secondary'
          }
        >
          {status}
        </Badge>
        {!event.cancelled && !ended && (
          <span className='text-muted-foreground tabular-nums'>
            {started
              ? t('Ends in {{time}}', { time: duration })
              : t('Starts in {{time}}', { time: duration })}
          </span>
        )}
      </span>
      <span className='text-muted-foreground flex flex-col gap-1'>
        <time dateTime={new Date(event.starts_at * 1000).toISOString()}>
          {t('Starts at')}:{' '}
          {new Date(event.starts_at * 1000).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </time>
        <time dateTime={new Date(event.ends_at * 1000).toISOString()}>
          {t('Ends at')}:{' '}
          {new Date(event.ends_at * 1000).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </time>
      </span>
    </span>
  )
}

export function EventCard(props: {
  id: number
  title: string
  event?: CommunityEvent
  onOpen: (id: number) => void
}) {
  const { t } = useTranslation()
  const Icon = props.event?.kind === 'red_packet' ? Gift : CalendarDays
  return (
    <Button
      variant='outline'
      className='h-auto w-full flex-col items-stretch gap-3 rounded-xl p-3 text-left whitespace-normal'
      onClick={() => props.onOpen(props.id)}
    >
      <span className='flex items-start gap-2'>
        <Icon
          className='text-primary mt-0.5 size-4 shrink-0'
          aria-hidden='true'
        />
        <span className='min-w-0 flex-1 break-words'>
          <span className='text-muted-foreground mb-1 block text-xs font-normal'>
            {props.event?.kind === 'red_packet'
              ? t('Red packet preview')
              : t('Event preview')}
          </span>
          <span className='line-clamp-2 font-semibold'>
            {props.event?.title || props.title}
          </span>
        </span>
        <ArrowUpRight
          className='text-muted-foreground size-4 shrink-0'
          aria-hidden='true'
        />
      </span>
      {props.event && <EventTiming event={props.event} />}
    </Button>
  )
}
