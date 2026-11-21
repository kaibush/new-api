import {
  ArrowDownWideNarrow,
  Clock,
  Crown,
  Layers,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatCheckinPercent } from '../format'
import {
  getEntryDisplayName,
  getEntryInitial,
  getRankMedalStyles,
  getTierToneStyles,
  type DisplayLeaderboardEntry,
  type HighlightSortMode,
  type HighlightViewMode,
  type LeaderboardTab,
  type TierSummary,
} from '../lib/leaderboard-utils'

interface LeaderboardListProps {
  entries: DisplayLeaderboardEntry[]
  totalCount: number
  tab: LeaderboardTab
  retentionDays: number
  locale?: string
  tierSummaries: TierSummary[]
  tierFilter: string
  onTierFilterChange: (tier: string) => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  highlightView: HighlightViewMode
  onHighlightViewChange: (mode: HighlightViewMode) => void
  highlightSort: HighlightSortMode
  onHighlightSortChange: (mode: HighlightSortMode) => void
  highlightedMe: boolean
  myRowRef?: RefObject<HTMLLIElement | null>
}

export function LeaderboardList(props: LeaderboardListProps) {
  const { t } = useTranslation()
  const hasActiveFilter =
    props.searchQuery.trim() !== '' || props.tierFilter.trim() !== ''
  const showTierDistribution = props.tierSummaries.length >= 2
  const showToolbar =
    props.totalCount > 1 ||
    hasActiveFilter ||
    (props.tab === 'highlights' && props.totalCount > 0)

  const handleResetFilters = () => {
    props.onSearchQueryChange('')
    props.onTierFilterChange('')
  }

  return (
    <div className='flex flex-col gap-3'>
      {showTierDistribution && (
        <div className='bg-card ring-foreground/10 flex flex-col gap-2.5 rounded-xl p-3.5 ring-1'>
          <div className='flex items-center justify-between gap-2'>
            <p className='text-muted-foreground text-xs font-medium'>
              {t('Tier distribution')}
            </p>
            {props.tierFilter && (
              <Button
                type='button'
                size='xs'
                variant='ghost'
                onClick={() => props.onTierFilterChange('')}
              >
                {t('All tiers')}
              </Button>
            )}
          </div>
          <div
            aria-hidden='true'
            className='bg-muted flex h-2 w-full overflow-hidden rounded-full'
          >
            {props.tierSummaries.map((tier) => {
              const toneStyle = getTierToneStyles(tier.tone)
              const dimmed =
                props.tierFilter !== '' && props.tierFilter !== tier.name
              return (
                <div
                  key={tier.name}
                  title={`${tier.name}: ${formatNumber(tier.count, props.locale)} (${formatCheckinPercent(tier.sharePercent, props.locale)})`}
                  className={cn(
                    'h-full transition-opacity first:rounded-l-full last:rounded-r-full',
                    toneStyle.segment,
                    dimmed && 'opacity-25'
                  )}
                  style={{ width: `${tier.sharePercent}%` }}
                />
              )
            })}
          </div>
          <div
            role='group'
            aria-label={t('Filter by tier')}
            className='flex flex-wrap items-center gap-1.5'
          >
            <Button
              type='button'
              size='xs'
              variant={props.tierFilter === '' ? 'secondary' : 'outline'}
              aria-pressed={props.tierFilter === ''}
              onClick={() => props.onTierFilterChange('')}
              className='rounded-full'
            >
              {t('All tiers')}
              <span className='text-muted-foreground tabular-nums'>
                {formatNumber(props.totalCount, props.locale)}
              </span>
            </Button>
            {props.tierSummaries.map((tier) => {
              const toneStyle = getTierToneStyles(tier.tone)
              const active = props.tierFilter === tier.name
              return (
                <Button
                  key={tier.name}
                  type='button'
                  size='xs'
                  variant={active ? 'secondary' : 'outline'}
                  aria-pressed={active}
                  onClick={() =>
                    props.onTierFilterChange(active ? '' : tier.name)
                  }
                  className={cn(
                    'rounded-full',
                    active && 'ring-ring/40 ring-1'
                  )}
                >
                  <span
                    aria-hidden='true'
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      toneStyle.dot
                    )}
                  />
                  <span>{tier.name}</span>
                  <span className='text-muted-foreground tabular-nums'>
                    {formatNumber(tier.count, props.locale)}
                  </span>
                </Button>
              )
            })}
          </div>
        </div>
      )}

      {showToolbar && (
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <InputGroup className='min-w-0 flex-1 sm:max-w-xs'>
            <InputGroupAddon align='inline-start'>
              <Search aria-hidden='true' className='size-3.5' />
            </InputGroupAddon>
            <InputGroupInput
              value={props.searchQuery}
              onChange={(event) =>
                props.onSearchQueryChange(event.target.value)
              }
              placeholder={t('Search user, tier, or #rank')}
              aria-label={t('Search leaderboard')}
              className='text-xs sm:text-sm'
            />
            {props.searchQuery && (
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='icon-xs'
                  aria-label={t('Clear search')}
                  onClick={() => props.onSearchQueryChange('')}
                >
                  <X className='size-3.5' />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          {props.tab === 'highlights' && props.totalCount > 1 && (
            <div className='flex flex-wrap items-center gap-2'>
              <ToggleGroup
                variant='outline'
                size='sm'
                aria-label={t('Highlight grouping')}
                value={[props.highlightView]}
                onValueChange={(next) => {
                  const first = next[0]
                  if (first === 'all' || first === 'winners') {
                    props.onHighlightViewChange(first)
                  }
                }}
              >
                <ToggleGroupItem value='all' className='h-8 gap-1 text-xs'>
                  <Layers className='size-3.5' aria-hidden='true' />
                  {t('All hits')}
                </ToggleGroupItem>
                <ToggleGroupItem value='winners' className='h-8 gap-1 text-xs'>
                  <Users className='size-3.5' aria-hidden='true' />
                  {t('Unique winners')}
                </ToggleGroupItem>
              </ToggleGroup>

              <ToggleGroup
                variant='outline'
                size='sm'
                aria-label={t('Sort order')}
                value={[props.highlightSort]}
                onValueChange={(next) => {
                  const first = next[0]
                  if (first === 'reward' || first === 'recent') {
                    props.onHighlightSortChange(first)
                  }
                }}
              >
                <ToggleGroupItem value='reward' className='h-8 gap-1 text-xs'>
                  <ArrowDownWideNarrow
                    className='size-3.5'
                    aria-hidden='true'
                  />
                  {t('Highest')}
                </ToggleGroupItem>
                <ToggleGroupItem value='recent' className='h-8 gap-1 text-xs'>
                  <Clock className='size-3.5' aria-hidden='true' />
                  {t('Latest')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
        </div>
      )}

      {props.entries.length === 0 ? (
        <EmptyState
          icon={Search}
          bordered
          title={t('No results found')}
          description={t('Try adjusting your search or tier filter.')}
          className='min-h-40 rounded-xl'
          action={
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={handleResetFilters}
            >
              {t('Clear filters')}
            </Button>
          }
        />
      ) : (
        <div className='bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1'>
          <div className='bg-muted/35 text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-[11px] font-medium'>
            <div className='flex items-center gap-3'>
              <span className='w-7 text-center'>{t('Rank')}</span>
              <span>{t('User')}</span>
            </div>
            <div className='flex items-center gap-3'>
              {hasActiveFilter && (
                <span className='tabular-nums'>
                  {t('Showing {{shown}} of {{total}}', {
                    shown: formatNumber(props.entries.length, props.locale),
                    total: formatNumber(props.totalCount, props.locale),
                  })}
                </span>
              )}
              <span>{t('Reward')}</span>
            </div>
          </div>

          <ol className='divide-border/70 divide-y'>
            {props.entries.map((entry) => {
              const rank = entry.displayRank
              const medal = getRankMedalStyles(rank)
              const tierStyle = getTierToneStyles(entry.tierTone)
              const name = getEntryDisplayName(entry)
              const initial = getEntryInitial(entry)
              const isTopThree = rank >= 1 && rank <= 3
              let barTone = 'bg-primary/65'
              if (entry.tier_name && entry.tierTone !== 'base') {
                barTone = tierStyle.bar
              } else if (rank === 1) {
                barTone = 'bg-amber-500/80 dark:bg-amber-400/80'
              }
              const showCumulative =
                entry.totalQuota !== undefined &&
                entry.hitCount !== undefined &&
                entry.hitCount > 1
              const hasMeta = Boolean(
                entry.tier_name ||
                entry.checkin_date ||
                props.tab === 'total' ||
                showCumulative
              )

              return (
                <li
                  key={entry.id}
                  ref={entry.isMe ? props.myRowRef : undefined}
                  data-my-rank-row={entry.isMe ? 'true' : undefined}
                  className={cn(
                    'hover:bg-muted/35 flex items-center justify-between gap-3 px-4 py-3 transition-colors',
                    entry.isMe && 'bg-primary/6 hover:bg-primary/10',
                    entry.isMe &&
                      props.highlightedMe &&
                      'ring-primary/50 ring-2 ring-inset'
                  )}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-3'>
                    <div className='flex w-7 shrink-0 items-center justify-center'>
                      {isTopThree && medal ? (
                        <span
                          className={cn(
                            'inline-flex size-7 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                            medal.badge
                          )}
                        >
                          {rank === 1 ? (
                            <Crown className='size-3.5' aria-hidden='true' />
                          ) : (
                            formatNumber(rank, props.locale)
                          )}
                          {rank === 1 && (
                            <span className='sr-only'>
                              {formatNumber(rank, props.locale)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className='text-muted-foreground text-xs font-medium tabular-nums'>
                          {formatNumber(rank, props.locale)}
                        </span>
                      )}
                    </div>

                    <Avatar
                      size='sm'
                      aria-hidden='true'
                      className='hidden size-7 sm:flex'
                    >
                      <AvatarFallback
                        className={cn(
                          'text-xs font-medium',
                          entry.isMe
                            ? 'bg-primary/15 text-primary'
                            : (medal?.avatar ??
                                'bg-muted text-muted-foreground')
                        )}
                      >
                        {initial}
                      </AvatarFallback>
                    </Avatar>

                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <p
                          className='truncate text-sm font-medium'
                          title={name}
                        >
                          {name}
                        </p>
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
                            variant='secondary'
                            className='h-4 px-1.5 text-[10px] tabular-nums'
                          >
                            ×{formatNumber(entry.hitCount, props.locale)}
                          </Badge>
                        )}
                      </div>

                      {hasMeta && (
                        <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                          {entry.tier_name && (
                            <Badge
                              variant='outline'
                              className={cn(
                                'h-4.5 px-1.5 text-[11px]',
                                tierStyle.badge
                              )}
                            >
                              {entry.tierTone === 'jackpot' && (
                                <Sparkles
                                  data-icon='inline-start'
                                  aria-hidden='true'
                                  className='size-2.5'
                                />
                              )}
                              {entry.tier_name}
                            </Badge>
                          )}
                          {entry.checkin_date && (
                            <span className='tabular-nums'>
                              {entry.checkin_date}
                            </span>
                          )}
                          {props.tab === 'total' && (
                            <span className='tabular-nums'>
                              {t('Last {{count}} days', {
                                count: props.retentionDays,
                              })}{' '}
                              ·{' '}
                              {formatCheckinPercent(
                                entry.shareOfTotal,
                                props.locale
                              )}
                            </span>
                          )}
                          {showCumulative && entry.totalQuota !== undefined && (
                            <span className='tabular-nums'>
                              {t('Cumulative')}:{' '}
                              {formatQuotaWithCurrency(entry.totalQuota)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className='flex shrink-0 items-center gap-3 sm:gap-4'>
                    <div
                      aria-hidden='true'
                      className='bg-muted hidden h-1.5 w-20 overflow-hidden rounded-full sm:block md:w-28'
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          barTone
                        )}
                        style={{ width: `${entry.shareOfTop}%` }}
                      />
                    </div>
                    <div className='min-w-16 text-right'>
                      <span
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          rank === 1 && medal?.amount
                        )}
                      >
                        {formatQuotaWithCurrency(entry.quota_awarded)}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
