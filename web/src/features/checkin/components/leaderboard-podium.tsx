import { Award, Crown, Medal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  getEntryDisplayName,
  getEntryInitial,
  getRankMedalStyles,
  getTierToneStyles,
  type DisplayLeaderboardEntry,
  type LeaderboardTab,
} from '../lib/leaderboard-utils'

interface LeaderboardPodiumProps {
  entries: DisplayLeaderboardEntry[]
  tab: LeaderboardTab
  retentionDays: number
  locale?: string
}

export function LeaderboardPodium(props: LeaderboardPodiumProps) {
  const { t } = useTranslation()
  if (props.entries.length === 0) return null

  let gridClass = 'grid grid-cols-1 sm:mx-auto sm:w-full sm:max-w-md'
  if (props.entries.length === 2) {
    gridClass = 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3.5'
  } else if (props.entries.length >= 3) {
    gridClass =
      'grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:items-end sm:gap-3.5'
  }

  return (
    <div className={gridClass}>
      {props.entries.map((entry, index) => {
        const rank = index + 1
        const medal = getRankMedalStyles(rank)
        const tierStyles = getTierToneStyles(entry.tierTone)
        const name = getEntryDisplayName(entry)
        const initial = getEntryInitial(entry)
        const isFirst = rank === 1
        const isThreeUp = props.entries.length >= 3

        let orderClass = ''
        if (isThreeUp && rank === 1) {
          orderClass = 'col-span-2 sm:col-span-1 sm:order-2'
        } else if (isThreeUp && rank === 2) {
          orderClass = 'col-span-1 sm:order-1'
        } else if (isThreeUp && rank === 3) {
          orderClass = 'col-span-1 sm:order-3'
        }

        let RankIcon = Award
        if (rank === 1) RankIcon = Crown
        else if (rank === 2) RankIcon = Medal

        let secondaryMeta = ''
        if (props.tab === 'total') {
          secondaryMeta = t('Last {{count}} days', {
            count: props.retentionDays,
          })
        } else if (props.tab === 'highlights' && entry.checkin_date) {
          secondaryMeta = entry.checkin_date
        }

        return (
          <Card
            key={entry.id}
            data-card-hover='false'
            data-podium-rank={rank}
            className={cn(
              'relative overflow-hidden py-0 transition-shadow',
              medal?.card,
              entry.isMe && 'ring-primary/50 ring-2',
              orderClass
            )}
          >
            <div
              aria-hidden='true'
              className={cn(
                'absolute inset-x-0 top-0 h-1',
                medal?.accent ?? 'bg-muted'
              )}
            />
            <CardContent
              className={cn(
                'p-3.5 pt-4 sm:p-4',
                isFirst && isThreeUp
                  ? 'flex items-center justify-between gap-3 sm:flex-col sm:justify-center sm:py-6 sm:text-center'
                  : 'flex flex-col items-center text-center sm:py-4'
              )}
            >
              <div
                className={cn(
                  'flex min-w-0 items-center gap-2.5',
                  isFirst && isThreeUp
                    ? 'flex-row sm:flex-col sm:gap-2'
                    : 'flex-col gap-2'
                )}
              >
                <div className='relative shrink-0'>
                  <Avatar
                    size={isFirst ? 'lg' : 'default'}
                    aria-hidden='true'
                    className={cn(
                      isFirst ? 'size-11 sm:size-12' : 'size-9 sm:size-10'
                    )}
                  >
                    <AvatarFallback
                      className={cn(
                        'font-semibold',
                        medal?.avatar ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    aria-hidden='true'
                    className={cn(
                      'absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full shadow-xs',
                      medal?.badge ?? 'bg-muted text-muted-foreground'
                    )}
                  >
                    <RankIcon className='size-3' />
                  </span>
                </div>

                <div
                  className={cn(
                    'min-w-0',
                    isFirst && isThreeUp ? 'text-left sm:text-center' : 'w-full'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center gap-1.5',
                      isFirst && isThreeUp
                        ? 'justify-start sm:justify-center'
                        : 'justify-center'
                    )}
                  >
                    <span className='text-muted-foreground text-[11px] font-semibold tabular-nums'>
                      #{formatNumber(rank, props.locale)}
                    </span>
                    {entry.isMe && (
                      <Badge
                        variant='default'
                        className='h-4 px-1.5 text-[10px]'
                      >
                        {t('You')}
                      </Badge>
                    )}
                    {entry.hitCount !== undefined && entry.hitCount > 1 && (
                      <Badge
                        variant='outline'
                        className='h-4 px-1.5 text-[10px] tabular-nums'
                      >
                        ×{formatNumber(entry.hitCount, props.locale)}
                      </Badge>
                    )}
                  </div>
                  <p
                    className='mt-0.5 truncate text-sm font-semibold'
                    title={name}
                  >
                    {name}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  'flex shrink-0 flex-col',
                  isFirst && isThreeUp
                    ? 'items-end sm:mt-2 sm:items-center'
                    : 'mt-2.5 items-center'
                )}
              >
                <p
                  className={cn(
                    'font-bold tracking-tight tabular-nums',
                    isFirst ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
                    medal?.amount
                  )}
                >
                  {formatQuotaWithCurrency(entry.quota_awarded)}
                </p>
                <div
                  className={cn(
                    'mt-1.5 flex flex-wrap items-center gap-1',
                    isFirst && isThreeUp
                      ? 'justify-end sm:justify-center'
                      : 'justify-center'
                  )}
                >
                  {entry.tier_name && (
                    <Badge
                      variant='outline'
                      className={cn(
                        'h-5 max-w-28 truncate px-1.5 text-[11px]',
                        tierStyles.badge
                      )}
                    >
                      {entry.tierTone === 'jackpot' && (
                        <Sparkles
                          data-icon='inline-start'
                          aria-hidden='true'
                          className='size-2.5'
                        />
                      )}
                      <span className='truncate'>{entry.tier_name}</span>
                    </Badge>
                  )}
                  {secondaryMeta && (
                    <span className='text-muted-foreground text-[11px] tabular-nums'>
                      {secondaryMeta}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
