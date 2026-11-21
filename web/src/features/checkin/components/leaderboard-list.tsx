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
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
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
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  topQuota?: number
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
  highlightedEntryId?: string | null
  myRowRef?: RefObject<HTMLLIElement | null>
  onRowElement?: (id: string, element: HTMLLIElement | null) => void
}

export function LeaderboardList(props: LeaderboardListProps) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)

  const hasActiveFilter =
    props.searchQuery.trim() !== '' || props.tierFilter.trim() !== ''
  const showTierDistribution = props.tierSummaries.length >= 2
  const showToolbar =
    props.totalCount > 1 ||
    hasActiveFilter ||
    (props.tab === 'highlights' && props.totalCount > 0)

  useEffect(() => {
    if (!showToolbar) return
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) {
        const tagName = activeEl.tagName
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          activeEl.isContentEditable
        ) {
          return
        }
      }
      const openDialogs = document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"]'
      )
      if (openDialogs.length > 0) {
        const topmostDialog = [...openDialogs].at(-1)
        if (
          !containerRef.current ||
          !topmostDialog?.contains(containerRef.current)
        ) {
          return
        }
      }
      if (!searchInputRef.current) return
      event.preventDefault()
      searchInputRef.current.focus()
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [showToolbar])

  const handleResetFilters = () => {
    props.onSearchQueryChange('')
    props.onTierFilterChange('')
  }

  return (
    <div ref={containerRef} className='flex flex-col gap-3'>
      {showTierDistribution && (
        <div className='bg-card/85 ring-foreground/10 flex flex-col gap-3 rounded-2xl p-4 ring-1'>
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
          <TooltipProvider delay={120}>
            <div
              aria-hidden='true'
              className='bg-muted/80 ring-foreground/6 flex h-3 w-full gap-0.5 overflow-hidden rounded-full p-0.5 ring-1'
            >
              {props.tierSummaries.map((tier) => {
                const toneStyle = getTierToneStyles(tier.tone)
                const active = props.tierFilter === tier.name
                const dimmed =
                  props.tierFilter !== '' && props.tierFilter !== tier.name
                return (
                  <Tooltip key={tier.name}>
                    <TooltipTrigger
                      render={
                        <div
                          onClick={() =>
                            props.onTierFilterChange(active ? '' : tier.name)
                          }
                          style={{ width: `${tier.sharePercent}%` }}
                          className={cn(
                            'h-full cursor-pointer rounded-full transition-all duration-300 hover:brightness-110',
                            toneStyle.segment,
                            dimmed && 'opacity-25'
                          )}
                        />
                      }
                    />
                    <TooltipContent className='tabular-nums'>
                      <span>{tier.name}</span>
                      <span>·</span>
                      <span>
                        {formatNumber(tier.count, props.locale)} (
                        {formatCheckinPercent(tier.sharePercent, props.locale)})
                      </span>
                      {tier.maxQuota > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            {t('Peak {{amount}}', {
                              amount: formatQuotaWithCurrency(tier.maxQuota),
                            })}
                          </span>
                        </>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
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
              ref={searchInputRef}
              value={props.searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  if (props.searchQuery !== '') {
                    event.preventDefault()
                    event.stopPropagation()
                    props.onSearchQueryChange('')
                  } else {
                    searchInputRef.current?.blur()
                  }
                }
              }}
              onChange={(event) =>
                props.onSearchQueryChange(event.target.value)
              }
              placeholder={t('Search user, tier, or #rank')}
              aria-label={t('Search leaderboard')}
              className='text-xs sm:text-sm'
            />
            {props.searchQuery ? (
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='icon-xs'
                  aria-label={t('Clear search')}
                  onClick={() => props.onSearchQueryChange('')}
                >
                  <X className='size-3.5' />
                </InputGroupButton>
              </InputGroupAddon>
            ) : (
              !searchFocused && (
                <InputGroupAddon
                  align='inline-end'
                  title={t('Press / to search')}
                >
                  <Kbd aria-hidden='true'>/</Kbd>
                </InputGroupAddon>
              )
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
        <div className='bg-card ring-foreground/10 overflow-hidden rounded-2xl ring-1'>
          <div className='bg-muted/35 text-muted-foreground flex items-center justify-between border-b px-4 py-2.5 text-[11px] font-medium'>
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

          <TooltipProvider delay={160}>
            <LayoutGroup id={`leaderboard-list-${props.tab}`}>
              <ol className='divide-border/70 divide-y'>
                {props.entries.map((entry, rowIndex) => {
                  const rank = entry.displayRank
                  const medal = getRankMedalStyles(rank)
                  const tierStyle = getTierToneStyles(entry.tierTone)
                  const name = getEntryDisplayName(entry)
                  const initial = getEntryInitial(entry)
                  const isTopThree = rank >= 1 && rank <= 3
                  const isSpotlight =
                    (entry.isMe && props.highlightedMe) ||
                    (Boolean(props.highlightedEntryId) &&
                      props.highlightedEntryId === entry.id)
                  let barTone = 'bg-primary/70'
                  if (entry.tier_name && entry.tierTone !== 'base') {
                    barTone = tierStyle.bar
                  } else if (rank === 1) {
                    barTone = 'bg-amber-500/85 dark:bg-amber-400/85'
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

                  const attachRef = (node: HTMLLIElement | null) => {
                    if (entry.isMe && props.myRowRef) {
                      props.myRowRef.current = node
                    }
                    props.onRowElement?.(entry.id, node)
                  }

                  const rowClassName = cn(
                    'group/row hover:bg-muted/40 relative flex items-center justify-between gap-3 px-4 py-3 transition-colors',
                    entry.isMe && 'bg-primary/6 hover:bg-primary/10',
                    isSpotlight &&
                      'bg-amber-500/10 ring-2 ring-amber-500/55 ring-inset dark:bg-amber-500/12'
                  )
                  let rowIndicatorClass =
                    'bg-primary/70 opacity-0 group-hover/row:opacity-100'
                  if (entry.isMe) {
                    rowIndicatorClass = 'bg-primary w-1 opacity-100'
                  } else if (rank === 1) {
                    rowIndicatorClass =
                      'bg-amber-500/85 opacity-85 group-hover/row:opacity-100'
                  } else if (rank === 2) {
                    rowIndicatorClass =
                      'bg-slate-400/80 opacity-75 group-hover/row:opacity-100'
                  } else if (rank === 3) {
                    rowIndicatorClass =
                      'bg-orange-400/80 opacity-75 group-hover/row:opacity-100'
                  }

                  const gapFromTop =
                    props.topQuota !== undefined &&
                    props.topQuota > entry.quota_awarded
                      ? props.topQuota - entry.quota_awarded
                      : 0
                  let shareTooltip = ''
                  if (rank === 1) {
                    shareTooltip = t('Leading today')
                  } else if (gapFromTop > 0) {
                    shareTooltip = t('{{amount}} behind #1', {
                      amount: formatQuotaWithCurrency(gapFromTop),
                    })
                  }

                  const avatarToneClass =
                    medal?.avatar ?? 'bg-muted text-muted-foreground'

                  const shareIndicator = (
                    <div
                      aria-hidden='true'
                      className='hidden items-center gap-2 sm:flex'
                    >
                      <div className='bg-muted/85 h-2 w-24 overflow-hidden rounded-full md:w-32'>
                        {shouldReduce ? (
                          <div
                            className={cn('h-full rounded-full', barTone)}
                            style={{ width: `${entry.shareOfTop}%` }}
                          />
                        ) : (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${entry.shareOfTop}%` }}
                            transition={{
                              type: 'spring',
                              stiffness: 220,
                              damping: 28,
                              delay: Math.min(rowIndex * 0.02, 0.24),
                            }}
                            className={cn('h-full rounded-full', barTone)}
                          />
                        )}
                      </div>
                      <span className='text-muted-foreground hidden w-9 text-right text-[11px] tabular-nums lg:inline-block'>
                        {Math.round(entry.shareOfTop)}%
                      </span>
                    </div>
                  )

                  const rowInner = (
                    <>
                      <span
                        aria-hidden='true'
                        className={cn(
                          'pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-r-full transition-opacity duration-200',
                          rowIndicatorClass
                        )}
                      />
                      <div className='flex min-w-0 flex-1 items-center gap-3'>
                        <div className='flex w-7 shrink-0 items-center justify-center'>
                          {isTopThree && medal ? (
                            <span
                              className={cn(
                                'inline-flex size-7 items-center justify-center rounded-full text-xs font-bold shadow-2xs tabular-nums',
                                medal.badge
                              )}
                            >
                              {rank === 1 ? (
                                <Crown
                                  className='size-3.5'
                                  aria-hidden='true'
                                />
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
                            <span className='bg-muted/60 text-muted-foreground group-hover/row:bg-muted group-hover/row:text-foreground inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors'>
                              {formatNumber(rank, props.locale)}
                            </span>
                          )}
                        </div>

                        <Avatar
                          size='sm'
                          aria-hidden='true'
                          className='hidden size-8 sm:flex'
                        >
                          <AvatarFallback
                            className={cn(
                              'text-xs font-semibold',
                              entry.isMe
                                ? 'bg-primary/15 text-primary ring-primary/30 ring-1'
                                : avatarToneClass
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
                            {entry.hitCount !== undefined &&
                              entry.hitCount > 1 && (
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
                              {showCumulative &&
                                entry.totalQuota !== undefined && (
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
                        {shareTooltip ? (
                          <Tooltip>
                            <TooltipTrigger render={shareIndicator} />
                            <TooltipContent className='tabular-nums'>
                              {shareTooltip}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          shareIndicator
                        )}
                        <div className='min-w-16 text-right'>
                          <span
                            className={cn(
                              'text-sm font-bold tabular-nums',
                              rank === 1 && medal?.amount
                            )}
                          >
                            {formatQuotaWithCurrency(entry.quota_awarded)}
                          </span>
                        </div>
                      </div>
                    </>
                  )

                  if (shouldReduce) {
                    return (
                      <li
                        key={entry.id}
                        ref={attachRef}
                        data-my-rank-row={entry.isMe ? 'true' : undefined}
                        className={rowClassName}
                      >
                        {rowInner}
                      </li>
                    )
                  }

                  return (
                    <motion.li
                      key={entry.id}
                      layout='position'
                      ref={attachRef}
                      data-my-rank-row={entry.isMe ? 'true' : undefined}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        layout: { type: 'spring', stiffness: 360, damping: 32 },
                        opacity: { duration: 0.18 },
                        y: { duration: 0.18 },
                      }}
                      className={rowClassName}
                    >
                      {rowInner}
                    </motion.li>
                  )
                })}
              </ol>
            </LayoutGroup>
          </TooltipProvider>
        </div>
      )}
    </div>
  )
}
