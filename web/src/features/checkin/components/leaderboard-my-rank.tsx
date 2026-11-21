import {
  Award,
  CalendarCheck,
  Crosshair,
  Crown,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatCheckinPercent } from '../format'
import type { MyRankInsight } from '../lib/leaderboard-utils'

export interface LeaderboardCheckinPrompt {
  checkedIn: boolean
  minQuota?: number
  maxQuota?: number
  todayAward?: number
  allowed?: boolean
}

interface LeaderboardMyRankProps {
  insight: MyRankInsight | null
  locale?: string
  checkinPrompt?: LeaderboardCheckinPrompt
  todayTopQuota?: number
  showRecordsAction?: boolean
  onLocateMe?: () => void
  onOpenCheckin?: () => void
}

const MILESTONE_TICKS = [25, 50, 75] as const

export function LeaderboardMyRank(props: LeaderboardMyRankProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()

  if (!props.insight) {
    const prompt = props.checkinPrompt
    if (!prompt || prompt.checkedIn || prompt.allowed === false) {
      return null
    }
    if (!props.onOpenCheckin) return null
    const hasRange =
      prompt.minQuota !== undefined &&
      prompt.maxQuota !== undefined &&
      prompt.maxQuota > 0
    const hasTodayTop =
      props.todayTopQuota !== undefined && props.todayTopQuota > 0
    return (
      <Card
        data-card-hover='false'
        className='border-primary/30 from-primary/12 to-card relative overflow-hidden bg-gradient-to-r via-amber-500/6 py-0'
      >
        <div
          aria-hidden='true'
          className='pointer-events-none absolute -top-12 -left-10 size-36 rounded-full bg-radial from-amber-400/22 to-transparent blur-2xl'
        />
        <CardContent className='relative flex flex-col gap-3.5 p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3.5'>
            <IconBadge
              tone='primary'
              size='lg'
              className='ring-primary/25 size-11 ring-1'
            >
              <Sparkles className='size-5' />
            </IconBadge>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='text-sm font-semibold'>
                  {t('Not checked in today')}
                </p>
                {hasTodayTop && (
                  <Badge
                    variant='outline'
                    className='h-5 border-amber-500/30 bg-amber-500/12 px-2 text-[11px] text-amber-800 tabular-nums dark:text-amber-300'
                  >
                    <Trophy
                      data-icon='inline-start'
                      aria-hidden='true'
                      className='size-2.5'
                    />
                    {t("Today's top drop: {{amount}}", {
                      amount: formatQuotaWithCurrency(props.todayTopQuota ?? 0),
                    })}
                  </Badge>
                )}
              </div>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {hasRange
                  ? t('Available reward: {{minimum}} – {{maximum}}', {
                      minimum: formatQuotaWithCurrency(prompt.minQuota ?? 0),
                      maximum: formatQuotaWithCurrency(prompt.maxQuota ?? 0),
                    })
                  : t('Check in today and try your luck.')}
              </p>
            </div>
          </div>
          <Button
            type='button'
            size='sm'
            className='w-full shrink-0 shadow-xs sm:w-auto'
            onClick={props.onOpenCheckin}
          >
            <Sparkles data-icon='inline-start' aria-hidden='true' />
            {t('Check in now')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const insight = props.insight
  const isChampion = insight.status === 'champion'
  const isPodium = insight.status === 'podium'

  let statusLabel = ''
  if (isChampion) statusLabel = t('Champion')
  else if (isPodium) statusLabel = t('Top 3')

  let deltaText = ''
  if (isChampion) {
    deltaText = t('Leading today')
  } else if (isPodium && insight.gapToFirst > 0) {
    deltaText = t('{{amount}} behind #1', {
      amount: formatQuotaWithCurrency(insight.gapToFirst),
    })
  } else if (insight.gapToPodium > 0) {
    deltaText = t('{{amount}} behind Top 3', {
      amount: formatQuotaWithCurrency(insight.gapToPodium),
    })
  } else if (insight.gapToBoard > 0) {
    deltaText = t('{{amount}} behind Top {{count}}', {
      amount: formatQuotaWithCurrency(insight.gapToBoard),
      count: insight.boardSize,
    })
  }

  let RankIcon = TrendingUp
  if (isChampion) RankIcon = Crown
  else if (isPodium) RankIcon = Trophy
  else if (insight.status === 'on_board') RankIcon = Award

  const percentLabel = t('Ahead of {{percent}} of users', {
    percent: formatCheckinPercent(insight.surpassedPercent, props.locale),
  })
  const showRecordsButton =
    props.showRecordsAction !== false && Boolean(props.onOpenCheckin)
  const showLocateButton = insight.inTopList && Boolean(props.onLocateMe)
  const clampedPercent = Math.max(0, Math.min(100, insight.surpassedPercent))

  return (
    <Card
      data-card-hover='false'
      className={cn(
        'relative overflow-hidden py-0',
        isChampion
          ? 'border-amber-500/40 bg-gradient-to-r from-amber-500/14 via-amber-500/5 to-card ring-amber-500/25'
          : 'border-primary/30 from-primary/12 via-primary/4 to-card bg-gradient-to-r ring-primary/15'
      )}
    >
      <div
        aria-hidden='true'
        className={cn(
          'pointer-events-none absolute -top-14 -left-10 size-40 rounded-full bg-radial blur-2xl',
          isChampion
            ? 'from-amber-400/25 to-transparent'
            : 'from-primary/22 to-transparent'
        )}
      />
      <div
        aria-hidden='true'
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          isChampion ? 'bg-amber-500' : 'bg-primary'
        )}
      />
      <CardContent className='relative flex flex-col gap-3.5 p-4 pl-5 lg:flex-row lg:items-center lg:gap-6'>
        <div className='flex shrink-0 items-center gap-3.5'>
          <IconBadge
            tone={isChampion ? 'warning' : 'primary'}
            size='lg'
            className={cn(
              'size-12 ring-1',
              isChampion ? 'ring-amber-500/30' : 'ring-primary/25'
            )}
          >
            <RankIcon />
          </IconBadge>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-muted-foreground text-xs font-medium'>
                {t('My daily rank')}
              </p>
              {statusLabel && (
                <Badge
                  variant='outline'
                  className={cn(
                    'h-4.5 px-1.5 text-[11px]',
                    isChampion
                      ? 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      : 'border-primary/30 bg-primary/10 text-primary'
                  )}
                >
                  {statusLabel}
                </Badge>
              )}
            </div>
            <div className='mt-0.5 flex flex-wrap items-baseline gap-2.5'>
              <p className='text-2xl font-bold tracking-tight tabular-nums sm:text-3xl'>
                #{formatNumber(insight.rank, props.locale)}
              </p>
              <span className='bg-background/70 inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums sm:text-base'>
                {formatQuotaWithCurrency(insight.quota)}
              </span>
            </div>
          </div>
        </div>

        <div className='border-border/60 flex min-w-0 flex-1 flex-col justify-center gap-2 lg:border-x lg:px-6'>
          <div className='flex w-full items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground font-medium'>
              {percentLabel}
            </span>
            {deltaText && (
              <span className='bg-background/80 text-foreground/90 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums'>
                {deltaText}
              </span>
            )}
          </div>

          <div
            role='progressbar'
            aria-label={percentLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clampedPercent)}
            className='bg-muted/80 ring-foreground/8 relative h-2.5 w-full overflow-hidden rounded-full ring-1'
          >
            {MILESTONE_TICKS.map((tick) => (
              <span
                key={tick}
                aria-hidden='true'
                className='bg-background/70 pointer-events-none absolute inset-y-0 z-10 w-px'
                style={{ left: `${tick}%` }}
              />
            ))}
            {shouldReduce ? (
              <div
                className={cn(
                  'h-full rounded-full',
                  isChampion
                    ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300'
                    : 'from-primary/80 via-primary bg-gradient-to-r to-sky-400'
                )}
                style={{ width: `${clampedPercent}%` }}
              />
            ) : (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${clampedPercent}%` }}
                transition={{ type: 'spring', stiffness: 180, damping: 26 }}
                className={cn(
                  'h-full rounded-full',
                  isChampion
                    ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300'
                    : 'from-primary/80 via-primary bg-gradient-to-r to-sky-400'
                )}
              />
            )}
          </div>
        </div>

        {(showLocateButton || showRecordsButton) && (
          <div className='flex shrink-0 flex-wrap items-center gap-2 lg:justify-end'>
            {showLocateButton && props.onLocateMe && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='bg-background/80'
                onClick={props.onLocateMe}
              >
                <Crosshair data-icon='inline-start' aria-hidden='true' />
                {t('Locate me')}
              </Button>
            )}
            {showRecordsButton && props.onOpenCheckin && (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={props.onOpenCheckin}
              >
                <CalendarCheck data-icon='inline-start' aria-hidden='true' />
                {t('View check-in records')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
