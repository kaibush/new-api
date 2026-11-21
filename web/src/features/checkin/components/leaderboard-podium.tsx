import { Award, Crown, Medal, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
  onSelectEntry?: (entry: DisplayLeaderboardEntry) => void
}

function LaurelWreath(props: { className?: string }) {
  return (
    <svg
      viewBox='0 0 80 80'
      fill='none'
      aria-hidden='true'
      className={cn('pointer-events-none select-none', props.className)}
    >
      <path
        d='M35 69C20 64 11 50 12 33C12.5 23 17 15 24 10'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        opacity='0.65'
      />
      <path
        d='M45 69C60 64 69 50 68 33C67.5 23 63 15 56 10'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        opacity='0.65'
      />
      <ellipse
        cx='14.5'
        cy='47'
        rx='4.2'
        ry='2.1'
        transform='rotate(-38 14.5 47)'
        fill='currentColor'
        opacity='0.75'
      />
      <ellipse
        cx='12.5'
        cy='36'
        rx='4.2'
        ry='2.1'
        transform='rotate(-16 12.5 36)'
        fill='currentColor'
        opacity='0.82'
      />
      <ellipse
        cx='15'
        cy='25'
        rx='4.2'
        ry='2.1'
        transform='rotate(14 15 25)'
        fill='currentColor'
        opacity='0.88'
      />
      <ellipse
        cx='21'
        cy='15.5'
        rx='4'
        ry='2'
        transform='rotate(38 21 15.5)'
        fill='currentColor'
        opacity='0.92'
      />
      <ellipse
        cx='21'
        cy='57.5'
        rx='4.2'
        ry='2.1'
        transform='rotate(-56 21 57.5)'
        fill='currentColor'
        opacity='0.68'
      />
      <ellipse
        cx='65.5'
        cy='47'
        rx='4.2'
        ry='2.1'
        transform='rotate(38 65.5 47)'
        fill='currentColor'
        opacity='0.75'
      />
      <ellipse
        cx='67.5'
        cy='36'
        rx='4.2'
        ry='2.1'
        transform='rotate(16 67.5 36)'
        fill='currentColor'
        opacity='0.82'
      />
      <ellipse
        cx='65'
        cy='25'
        rx='4.2'
        ry='2.1'
        transform='rotate(-14 65 25)'
        fill='currentColor'
        opacity='0.88'
      />
      <ellipse
        cx='59'
        cy='15.5'
        rx='4'
        ry='2'
        transform='rotate(-38 59 15.5)'
        fill='currentColor'
        opacity='0.92'
      />
      <ellipse
        cx='59'
        cy='57.5'
        rx='4.2'
        ry='2.1'
        transform='rotate(56 59 57.5)'
        fill='currentColor'
        opacity='0.68'
      />
      <path
        d='M35 69L40 72L45 69'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
        opacity='0.7'
      />
    </svg>
  )
}

export function LeaderboardPodium(props: LeaderboardPodiumProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  if (props.entries.length === 0) return null

  let gridClass = 'grid grid-cols-1 sm:mx-auto sm:w-full sm:max-w-md'
  if (props.entries.length === 2) {
    gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end sm:gap-4'
  } else if (props.entries.length >= 3) {
    gridClass = 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:items-end sm:gap-4'
  }

  return (
    <div className='bg-card/75 ring-foreground/10 relative overflow-hidden rounded-2xl px-3 pt-4 pb-3 ring-1 sm:px-6 sm:pt-5 sm:pb-0'>
      <div
        aria-hidden='true'
        className='leaderboard-stage-grid pointer-events-none absolute inset-0 opacity-70'
      />
      <div
        aria-hidden='true'
        className='pointer-events-none absolute -top-24 left-1/2 h-56 w-4/5 -translate-x-1/2 rounded-full bg-radial from-amber-400/22 via-amber-500/6 to-transparent blur-2xl dark:from-amber-400/24 dark:via-amber-500/8'
      />

      <div className='relative mb-3 flex items-center justify-center sm:mb-4'>
        <span className='inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-0.5 text-[11px] font-semibold tracking-wide text-amber-800 shadow-2xs dark:text-amber-300'>
          <Crown className='size-3 text-amber-500' aria-hidden='true' />
          <span>{t('Hall of fortune')}</span>
          <Sparkles className='size-2.5 text-amber-500/80' aria-hidden='true' />
        </span>
      </div>

      <div className={cn('relative', gridClass)}>
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

          let pedestalHeightClass = 'sm:h-11'
          let staggerDelay = 0.16
          if (rank === 1) {
            pedestalHeightClass = 'sm:h-20'
            staggerDelay = 0.04
          } else if (rank === 2) {
            pedestalHeightClass = 'sm:h-14'
            staggerDelay = 0.1
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

          const interactive = Boolean(props.onSelectEntry)

          const columnContent = (
            <div className='flex flex-col items-stretch'>
              <div
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={
                  interactive ? () => props.onSelectEntry?.(entry) : undefined
                }
                onKeyDown={
                  interactive
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          props.onSelectEntry?.(entry)
                        }
                      }
                    : undefined
                }
                className={cn(
                  'group/podium relative overflow-hidden rounded-2xl border ring-1 transition-all duration-300 sm:rounded-b-none sm:border-b-0',
                  medal?.card,
                  entry.isMe && 'ring-primary/55 ring-2',
                  interactive &&
                    'focus-visible:ring-ring cursor-pointer hover:-translate-y-1 focus-visible:ring-2 focus-visible:outline-none'
                )}
              >
                {isFirst && (
                  <div
                    aria-hidden='true'
                    className='leaderboard-champion-border pointer-events-none absolute inset-0 z-10'
                  />
                )}
                <div
                  aria-hidden='true'
                  className='leaderboard-podium-sheen pointer-events-none absolute inset-0 z-10'
                />
                <div
                  aria-hidden='true'
                  className={cn(
                    'pointer-events-none absolute -top-10 left-1/2 h-28 w-40 -translate-x-1/2 rounded-full bg-radial opacity-80 blur-xl transition-opacity duration-300 group-hover/podium:opacity-100',
                    medal?.glow
                  )}
                />
                <div
                  aria-hidden='true'
                  className={cn(
                    'absolute inset-x-0 top-0 h-1',
                    medal?.accent ?? 'bg-muted'
                  )}
                />

                <div
                  className={cn(
                    'relative p-3.5 pt-4 sm:px-4',
                    isFirst && isThreeUp
                      ? 'flex items-center justify-between gap-3 sm:flex-col sm:justify-center sm:pt-6 sm:pb-4 sm:text-center'
                      : 'flex flex-col items-center text-center sm:pt-4 sm:pb-3.5'
                  )}
                >
                  <div
                    className={cn(
                      'flex min-w-0 items-center gap-3',
                      isFirst && isThreeUp
                        ? 'flex-row sm:flex-col sm:gap-2'
                        : 'flex-col gap-2'
                    )}
                  >
                    <div
                      className={cn(
                        'relative flex shrink-0 items-center justify-center',
                        isFirst ? 'size-16 sm:size-20' : 'size-14 sm:size-16'
                      )}
                    >
                      {isFirst &&
                        (shouldReduce ? (
                          <Crown
                            aria-hidden='true'
                            className='absolute -top-2.5 left-1/2 z-20 size-4 -translate-x-1/2 fill-amber-400/35 text-amber-500 drop-shadow-xs sm:-top-3 sm:size-5 dark:text-amber-300'
                          />
                        ) : (
                          <motion.span
                            aria-hidden='true'
                            animate={{ y: [0, -3, 0] }}
                            transition={{
                              duration: 2.6,
                              repeat: Number.POSITIVE_INFINITY,
                              ease: 'easeInOut',
                            }}
                            className='absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 sm:-top-3'
                          >
                            <Crown className='size-4 fill-amber-400/35 text-amber-500 drop-shadow-xs sm:size-5 dark:text-amber-300' />
                          </motion.span>
                        ))}
                      <LaurelWreath
                        className={cn(
                          'absolute inset-0 size-full',
                          medal?.wreath
                        )}
                      />
                      <Avatar
                        size={isFirst ? 'lg' : 'default'}
                        aria-hidden='true'
                        className={cn(
                          'relative z-10',
                          isFirst ? 'size-11 sm:size-13' : 'size-9 sm:size-10'
                        )}
                      >
                        <AvatarFallback
                          className={cn(
                            'font-bold',
                            medal?.avatar ?? 'bg-muted text-muted-foreground'
                          )}
                        >
                          {initial}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        aria-hidden='true'
                        className={cn(
                          'absolute right-0.5 bottom-0.5 z-20 flex size-5 items-center justify-center rounded-full shadow-xs',
                          medal?.badge ?? 'bg-muted text-muted-foreground'
                        )}
                      >
                        <RankIcon className='size-3' />
                      </span>
                    </div>

                    <div
                      className={cn(
                        'min-w-0',
                        isFirst && isThreeUp
                          ? 'text-left sm:text-center'
                          : 'w-full'
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
                        : 'mt-2 items-center'
                    )}
                  >
                    <p
                      className={cn(
                        'font-extrabold tracking-tight tabular-nums',
                        isFirst
                          ? 'text-2xl sm:text-3xl'
                          : 'text-lg sm:text-2xl',
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
                </div>
              </div>

              <div
                aria-hidden='true'
                className={cn(
                  'relative hidden flex-col items-center justify-center overflow-hidden border-x border-t sm:flex',
                  pedestalHeightClass,
                  medal?.pedestal
                )}
              >
                <div
                  className={cn(
                    'absolute inset-x-0 top-0 h-1.5',
                    medal?.pedestalLedge
                  )}
                />
                <span
                  className={cn(
                    'font-black tracking-tighter tabular-nums select-none',
                    isFirst ? 'text-4xl' : 'text-3xl',
                    medal?.pedestalNumber
                  )}
                >
                  {rank}
                </span>
              </div>
            </div>
          )

          if (shouldReduce) {
            return (
              <div
                key={entry.id}
                data-podium-rank={rank}
                className={orderClass}
              >
                {columnContent}
              </div>
            )
          }

          return (
            <motion.div
              key={`${props.tab}-${entry.id}`}
              data-podium-rank={rank}
              className={orderClass}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 24,
                delay: staggerDelay,
              }}
            >
              {columnContent}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
