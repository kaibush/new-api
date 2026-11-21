import {
  Award,
  CalendarCheck,
  Crosshair,
  Crown,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
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
  showRecordsAction?: boolean
  onLocateMe?: () => void
  onOpenCheckin?: () => void
}

export function LeaderboardMyRank(props: LeaderboardMyRankProps) {
  const { t } = useTranslation()

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
    return (
      <Card
        data-card-hover='false'
        className='border-primary/25 from-primary/8 via-primary/3 to-card bg-gradient-to-r py-0'
      >
        <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3'>
            <IconBadge tone='primary' size='lg'>
              <Sparkles className='size-5' />
            </IconBadge>
            <div className='min-w-0'>
              <p className='text-sm font-semibold'>
                {t('Not checked in today')}
              </p>
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
            className='w-full shrink-0 sm:w-auto'
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

  return (
    <Card
      data-card-hover='false'
      className={cn(
        'relative overflow-hidden py-0',
        isChampion
          ? 'border-amber-500/35 from-amber-500/12 via-amber-500/4 to-card bg-gradient-to-r ring-amber-500/20'
          : 'border-primary/25 from-primary/10 via-primary/4 to-card bg-gradient-to-r ring-primary/15'
      )}
    >
      <div
        aria-hidden='true'
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          isChampion ? 'bg-amber-500' : 'bg-primary'
        )}
      />
      <CardContent className='flex flex-col gap-3.5 p-4 pl-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5'>
        <div className='flex min-w-0 items-center gap-3.5'>
          <IconBadge
            tone={isChampion ? 'warning' : 'primary'}
            size='lg'
            className='size-11'
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
              <span className='text-base font-semibold tabular-nums sm:text-lg'>
                {formatQuotaWithCurrency(insight.quota)}
              </span>
            </div>
          </div>
        </div>

        <div className='flex min-w-0 flex-1 flex-col gap-2 sm:max-w-xs sm:items-end'>
          <div className='flex w-full items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>{percentLabel}</span>
            {deltaText && (
              <span className='text-foreground/80 shrink-0 font-medium'>
                {deltaText}
              </span>
            )}
          </div>
          <Progress
            value={insight.surpassedPercent}
            aria-label={percentLabel}
            className='w-full gap-0'
          />
          {(showLocateButton || showRecordsButton) && (
            <div className='flex flex-wrap items-center gap-2 pt-0.5 sm:justify-end'>
              {showLocateButton && props.onLocateMe && (
                <Button
                  type='button'
                  size='xs'
                  variant='outline'
                  onClick={props.onLocateMe}
                >
                  <Crosshair data-icon='inline-start' aria-hidden='true' />
                  {t('Locate me')}
                </Button>
              )}
              {showRecordsButton && props.onOpenCheckin && (
                <Button
                  type='button'
                  size='xs'
                  variant='ghost'
                  onClick={props.onOpenCheckin}
                >
                  <CalendarCheck data-icon='inline-start' aria-hidden='true' />
                  {t('View check-in records')}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
