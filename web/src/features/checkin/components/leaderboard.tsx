/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import {
  Award,
  BarChart3,
  Calendar,
  Clock,
  Globe,
  History,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getCheckinLeaderboard } from '../api'
import { formatCheckinPercent } from '../format'
import {
  buildDisplayEntries,
  buildTierToneMap,
  computeBoardMetrics,
  computeMyRankInsight,
  extractTierSummaries,
  formatResetCountdownClock,
  getEntryDisplayName,
  getTierToneStyles,
  groupHighlightWinners,
  selectPodiumEntries,
  type DisplayLeaderboardEntry,
  type HighlightSortMode,
  type HighlightViewMode,
  type LeaderboardTab,
} from '../lib/leaderboard-utils'
import { LeaderboardList } from './leaderboard-list'
import {
  LeaderboardMyRank,
  type LeaderboardCheckinPrompt,
} from './leaderboard-my-rank'
import { LeaderboardPodium } from './leaderboard-podium'

export interface CheckinLeaderboardProps {
  mode?: 'page' | 'dialog'
  initialTab?: LeaderboardTab
  checkinPrompt?: LeaderboardCheckinPrompt
  onOpenCheckin?: () => void
}

const SKELETON_KPI_KEYS = ['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4'] as const
const SKELETON_PODIUM_KEYS = ['podium-1', 'podium-2', 'podium-3'] as const
const SKELETON_ROW_KEYS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'] as const

function LeaderboardSkeleton() {
  return (
    <div className='space-y-4' aria-busy='true'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Skeleton className='h-6 w-28 rounded-full' />
          <Skeleton className='h-6 w-24 rounded-full' />
          <Skeleton className='h-6 w-32 rounded-full' />
        </div>
        <Skeleton className='h-8 w-20 rounded-md' />
      </div>
      <Skeleton className='h-24 w-full rounded-xl' />
      <Skeleton className='h-9 w-72 max-w-full rounded-lg' />
      <div className='grid grid-cols-2 gap-2.5 lg:grid-cols-4'>
        {SKELETON_KPI_KEYS.map((key) => (
          <Skeleton key={key} className='h-20 rounded-xl' />
        ))}
      </div>
      <div className='grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3.5'>
        {SKELETON_PODIUM_KEYS.map((key, idx) => (
          <Skeleton
            key={key}
            className={cn(
              'h-36 rounded-xl',
              idx === 0 && 'col-span-2 h-24 sm:col-span-1 sm:h-40'
            )}
          />
        ))}
      </div>
      <div className='bg-card ring-foreground/10 divide-border/70 divide-y overflow-hidden rounded-xl ring-1'>
        {SKELETON_ROW_KEYS.map((key) => (
          <div
            key={key}
            className='flex items-center justify-between gap-3 px-4 py-3'
          >
            <div className='flex items-center gap-3'>
              <Skeleton className='size-7 rounded-full' />
              <div className='space-y-1.5'>
                <Skeleton className='h-4 w-28' />
                <Skeleton className='h-3 w-20' />
              </div>
            </div>
            <Skeleton className='h-4 w-16' />
          </div>
        ))}
      </div>
    </div>
  )
}

interface MarqueeFeedItem {
  id: string
  name: string
  quota: number
  tierName: string
  date?: string
  dotClass: string
}

function LeaderboardMarquee(props: { items: MarqueeFeedItem[] }) {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  if (props.items.length < 2) return null

  const renderChip = (item: MarqueeFeedItem, suffix: string) => (
    <span
      key={`${item.id}-${suffix}`}
      className='bg-background/80 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs shadow-2xs'
    >
      <span
        aria-hidden='true'
        className={cn('size-1.5 shrink-0 rounded-full', item.dotClass)}
      />
      <span className='max-w-28 truncate font-medium'>{item.name}</span>
      <span className='font-bold text-amber-700 tabular-nums dark:text-amber-300'>
        +{formatQuotaWithCurrency(item.quota)}
      </span>
      {item.tierName && (
        <span className='text-muted-foreground hidden text-[11px] sm:inline'>
          · {item.tierName}
        </span>
      )}
    </span>
  )

  return (
    <div className='leaderboard-marquee bg-muted/35 ring-foreground/8 flex items-center gap-2.5 overflow-hidden rounded-xl px-3 py-1.5 ring-1'>
      <span className='inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300'>
        <span className='relative flex size-1.5' aria-hidden='true'>
          {!shouldReduce && (
            <span className='absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75' />
          )}
          <span className='relative inline-flex size-1.5 rounded-full bg-amber-500' />
        </span>
        <Zap className='size-3' aria-hidden='true' />
        <span>{t('Live lucky feed')}</span>
      </span>

      <div className='relative min-w-0 flex-1 overflow-hidden mask-[linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]'>
        {shouldReduce ? (
          <div className='flex [scrollbar-width:none] items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden'>
            {props.items.slice(0, 6).map((item) => renderChip(item, 'static'))}
          </div>
        ) : (
          <div className='leaderboard-marquee-track'>
            <div className='flex items-center gap-2 pr-2'>
              {props.items.map((item) => renderChip(item, 'a'))}
            </div>
            <div aria-hidden='true' className='flex items-center gap-2 pr-2'>
              {props.items.map((item) => renderChip(item, 'b'))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function CheckinLeaderboard(props: CheckinLeaderboardProps = {}) {
  const { t, i18n } = useTranslation()
  const shouldReduce = useReducedMotion()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const isDialog = props.mode === 'dialog'
  const [tab, setTab] = useState<LeaderboardTab>(props.initialTab ?? 'today')
  const [searchQuery, setSearchQuery] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [highlightView, setHighlightView] = useState<HighlightViewMode>('all')
  const [highlightSort, setHighlightSort] =
    useState<HighlightSortMode>('reward')
  const [highlightedMe, setHighlightedMe] = useState(false)
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(
    null
  )
  const [pendingLocateTarget, setPendingLocateTarget] = useState<
    'me' | string | null
  >(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const myRowRef = useRef<HTMLLIElement | null>(null)
  const rowElementsRef = useRef<Map<string, HTMLLIElement>>(new Map())
  const highlightTimerRef = useRef<number | null>(null)

  const query = useQuery({
    queryKey: ['checkin-leaderboard'],
    queryFn: getCheckinLeaderboard,
    staleTime: 15000,
    refetchInterval: 30000,
  })

  const board = query.data
  const hasHighlights = board?.recent_highlights !== undefined
  const activeTab: LeaderboardTab =
    !hasHighlights && tab === 'highlights' ? 'today' : tab

  useEffect(() => {
    if (!board?.timezone) return
    if (shouldReduce) return
    const interval = window.setInterval(() => {
      setNowTick(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [board?.timezone, shouldReduce])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!pendingLocateTarget) return
    const target = pendingLocateTarget
    setPendingLocateTarget(null)
    const frame = window.requestAnimationFrame(() => {
      const element =
        target === 'me'
          ? myRowRef.current
          : (rowElementsRef.current.get(target) ?? null)
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    pendingLocateTarget,
    activeTab,
    searchQuery,
    tierFilter,
    highlightView,
    highlightSort,
  ])

  const rawEntries = useMemo(() => {
    if (!board?.enabled) return []
    if (activeTab === 'highlights') return board.recent_highlights ?? []
    if (activeTab === 'total') return board.recent_totals ?? []
    return board.top ?? []
  }, [board, activeTab])

  const tierSummaries = useMemo(
    () => extractTierSummaries(rawEntries),
    [rawEntries]
  )
  const tierToneMap = useMemo(
    () => buildTierToneMap(tierSummaries),
    [tierSummaries]
  )
  const listTierSummaries = useMemo(() => {
    if (activeTab !== 'highlights' || highlightView !== 'winners') {
      return tierSummaries
    }
    return extractTierSummaries(groupHighlightWinners(rawEntries)).map(
      (summary) => ({
        ...summary,
        tone: tierToneMap.get(summary.name) ?? summary.tone,
      })
    )
  }, [activeTab, highlightView, rawEntries, tierSummaries, tierToneMap])
  const podiumEntries = useMemo(() => {
    if (!board?.enabled) return []
    return selectPodiumEntries({
      entries: rawEntries,
      board,
      tab: activeTab,
      tierToneMap,
    })
  }, [rawEntries, board, activeTab, tierToneMap])

  const displayEntries = useMemo(() => {
    if (!board?.enabled) return []
    return buildDisplayEntries({
      entries: rawEntries,
      board,
      tab: activeTab,
      tierToneMap,
      highlightView,
      highlightSort,
      searchQuery,
      tierFilter,
    })
  }, [
    rawEntries,
    board,
    activeTab,
    tierToneMap,
    highlightView,
    highlightSort,
    searchQuery,
    tierFilter,
  ])

  const metrics = useMemo(
    () => computeBoardMetrics(rawEntries, tierSummaries),
    [rawEntries, tierSummaries]
  )
  const myRankInsight = useMemo(
    () => (board?.enabled ? computeMyRankInsight(board) : null),
    [board]
  )
  const resetClock = useMemo(
    () => formatResetCountdownClock(board?.timezone, new Date(nowTick)),
    [board?.timezone, nowTick]
  )
  const marqueeItems = useMemo<MarqueeFeedItem[]>(() => {
    if (!board?.enabled) return []
    const source =
      board.recent_highlights && board.recent_highlights.length >= 2
        ? board.recent_highlights
        : (board.top ?? [])
    if (source.length < 2) return []
    const toneMap = buildTierToneMap(extractTierSummaries(source))
    return source.slice(0, 8).map((entry, idx) => {
      const tierName = (entry.tier_name || '').trim()
      const tone = tierName ? (toneMap.get(tierName) ?? 'jackpot') : 'jackpot'
      return {
        id: `${entry.rank}-${entry.checkin_date || ''}-${idx}`,
        name: getEntryDisplayName(entry),
        quota: entry.quota_awarded,
        tierName,
        date: entry.checkin_date,
        dotClass: getTierToneStyles(tone).dot,
      }
    })
  }, [board])

  if (query.isPending) return <LeaderboardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  if (!board?.enabled) {
    return (
      <EmptyState
        icon={Trophy}
        bordered
        title={t('Leaderboard is disabled')}
        className='min-h-48 rounded-xl'
      />
    )
  }

  const retentionDays = board.retention_days ?? 30

  const handleTabChange = (value: unknown) => {
    const next = String(value)
    if (next === 'today' || next === 'highlights' || next === 'total') {
      setTab(next)
      setTierFilter('')
      setSearchQuery('')
    }
  }

  const handleLocateMe = () => {
    setTab('today')
    setSearchQuery('')
    setTierFilter('')
    setHighlightedMe(true)
    setHighlightedEntryId(null)
    setPendingLocateTarget('me')
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMe(false)
    }, 2400)
  }

  const handleSelectPodiumEntry = (entry: DisplayLeaderboardEntry) => {
    setSearchQuery('')
    setTierFilter('')
    if (activeTab === 'highlights') {
      setHighlightView('winners')
      setHighlightSort('reward')
    }
    setHighlightedMe(false)
    setHighlightedEntryId(entry.id)
    setPendingLocateTarget(entry.id)
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedEntryId(null)
    }, 2400)
  }

  const handleRowElement = (id: string, element: HTMLLIElement | null) => {
    if (element) {
      rowElementsRef.current.set(id, element)
    } else {
      rowElementsRef.current.delete(id)
    }
  }

  const todayTopQuota = board.top?.[0]?.quota_awarded
  const canOfferCheckinAction =
    Boolean(props.onOpenCheckin) &&
    props.checkinPrompt?.checkedIn !== true &&
    props.checkinPrompt?.allowed !== false

  const avgSubtext = t('Avg {{amount}}', {
    amount: formatQuotaWithCurrency(metrics.avgQuota),
  })
  let winnersSubtext: string | undefined
  if (activeTab === 'total') {
    winnersSubtext = t('Last {{count}} days', { count: retentionDays })
  } else if (tierSummaries.length >= 2) {
    winnersSubtext = t('{{count}} tiers', { count: tierSummaries.length })
  }

  const kpiCards: Array<{
    id: string
    label: string
    value: string
    subtext?: string
    tone: IconBadgeTone
    icon: typeof Trophy
    glowClass: string
  }> =
    activeTab === 'highlights'
      ? [
          {
            id: 'top',
            label: t('Top reward'),
            value: formatQuotaWithCurrency(metrics.topQuota),
            subtext: metrics.topTierName || undefined,
            tone: 'warning',
            icon: Trophy,
            glowClass: 'from-amber-400/20 to-transparent',
          },
          {
            id: 'hits',
            label: t('Jackpot hits'),
            value: formatNumber(metrics.entryCount, locale),
            subtext: t('{{count}} unique winners', {
              count: metrics.uniqueWinners,
            }),
            tone: 'primary',
            icon: Sparkles,
            glowClass: 'from-primary/18 to-transparent',
          },
          {
            id: 'total',
            label: t('Board total'),
            value: formatQuotaWithCurrency(metrics.totalQuota),
            subtext: t('Last {{count}} days', { count: retentionDays }),
            tone: 'success',
            icon: Wallet,
            glowClass: 'from-emerald-400/18 to-transparent',
          },
          {
            id: 'median',
            label: t('Median'),
            value: formatQuotaWithCurrency(metrics.medianQuota),
            subtext: avgSubtext,
            tone: 'info',
            icon: BarChart3,
            glowClass: 'from-sky-400/18 to-transparent',
          },
        ]
      : [
          {
            id: 'top',
            label: t('Top reward'),
            value: formatQuotaWithCurrency(metrics.topQuota),
            subtext:
              activeTab === 'today'
                ? metrics.topTierName || undefined
                : undefined,
            tone: 'warning',
            icon: Trophy,
            glowClass: 'from-amber-400/20 to-transparent',
          },
          {
            id: 'total',
            label: t('Board total'),
            value: formatQuotaWithCurrency(metrics.totalQuota),
            subtext:
              rawEntries.length >= 3
                ? `${t('Top 3 share')} ${formatCheckinPercent(metrics.topThreeSharePercent, locale)}`
                : undefined,
            tone: 'success',
            icon: Wallet,
            glowClass: 'from-emerald-400/18 to-transparent',
          },
          {
            id: 'winners',
            label: t('Winners'),
            value: formatNumber(metrics.entryCount, locale),
            subtext: winnersSubtext,
            tone: 'primary',
            icon: Users,
            glowClass: 'from-primary/18 to-transparent',
          },
          {
            id: 'median',
            label: t('Median'),
            value: formatQuotaWithCurrency(metrics.medianQuota),
            subtext: avgSubtext,
            tone: 'info',
            icon: BarChart3,
            glowClass: 'from-sky-400/18 to-transparent',
          },
        ]

  const tabDefinitions: Array<{
    value: LeaderboardTab
    label: string
    icon: typeof Trophy
    count: number
  }> = [
    {
      value: 'today',
      label: t('Today’s lucky winners'),
      icon: Trophy,
      count: board.top?.length ?? 0,
    },
    ...(hasHighlights
      ? [
          {
            value: 'highlights' as const,
            label: t('Recent jackpots'),
            icon: Sparkles,
            count: board.recent_highlights?.length ?? 0,
          },
        ]
      : []),
    {
      value: 'total',
      label: t('Recent total rewards'),
      icon: Award,
      count: board.recent_totals?.length ?? 0,
    },
  ]

  return (
    <section
      className={cn(isDialog ? 'space-y-4' : 'space-y-5')}
      aria-label={t('Check-in leaderboard')}
    >
      <div className='flex items-start justify-between gap-2.5 sm:items-center'>
        <div className='text-muted-foreground flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs'>
          {board.today && (
            <span className='bg-muted/55 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tabular-nums'>
              <Calendar className='size-3.5 shrink-0' aria-hidden='true' />
              {board.today}
            </span>
          )}
          {board.timezone && (
            <span className='bg-muted/55 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1'>
              <Globe className='size-3.5 shrink-0' aria-hidden='true' />
              {board.timezone}
            </span>
          )}
          <span className='bg-muted/55 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tabular-nums'>
            <History className='size-3.5 shrink-0' aria-hidden='true' />
            {t('Last {{count}} days', { count: retentionDays })}
          </span>
          {resetClock && (
            <span className='bg-primary/8 text-primary border-primary/25 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium tabular-nums'>
              <Clock className='size-3.5 shrink-0' aria-hidden='true' />
              {t('Resets in {{countdown}}', {
                countdown: resetClock,
              })}
            </span>
          )}
        </div>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='shrink-0'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            data-icon='inline-start'
            aria-hidden='true'
            className={cn(query.isFetching && 'animate-spin')}
          />
          {t('Refresh')}
        </Button>
      </div>

      <LeaderboardMarquee items={marqueeItems} />

      <LeaderboardMyRank
        insight={myRankInsight}
        locale={locale}
        checkinPrompt={props.checkinPrompt}
        todayTopQuota={todayTopQuota}
        showRecordsAction={isDialog}
        onLocateMe={handleLocateMe}
        onOpenCheckin={props.onOpenCheckin}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className='-mx-1 [scrollbar-width:none] overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden'>
          <LayoutGroup
            id={
              isDialog
                ? 'checkin-leaderboard-tabs-dialog'
                : 'checkin-leaderboard-tabs'
            }
          >
            <TabsList
              className={cn(
                'inline-flex h-9 w-max min-w-full flex-nowrap p-1 sm:w-fit sm:min-w-0',
                !shouldReduce &&
                  '[&_[data-slot=tabs-trigger]]:data-active:bg-transparent [&_[data-slot=tabs-trigger]]:data-active:shadow-none dark:[&_[data-slot=tabs-trigger]]:data-active:border-transparent dark:[&_[data-slot=tabs-trigger]]:data-active:bg-transparent'
              )}
            >
              {tabDefinitions.map((item) => {
                const TabIcon = item.icon
                const isActive = activeTab === item.value
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className='relative shrink-0 gap-1 px-2 text-[11px] sm:gap-1.5 sm:px-3.5 sm:text-sm'
                  >
                    {!shouldReduce && isActive && (
                      <motion.span
                        layoutId={
                          isDialog
                            ? 'checkin-leaderboard-tab-pill-dialog'
                            : 'checkin-leaderboard-tab-pill'
                        }
                        aria-hidden='true'
                        transition={{
                          type: 'spring',
                          stiffness: 420,
                          damping: 32,
                        }}
                        className='bg-background dark:border-input dark:bg-input/40 absolute inset-0 rounded-md shadow-xs dark:border'
                      />
                    )}
                    <span className='relative z-10 inline-flex items-center gap-1.5'>
                      <TabIcon
                        className={cn(
                          'hidden size-3.5 shrink-0 sm:inline-block',
                          isActive &&
                            item.value === 'today' &&
                            'text-amber-600 dark:text-amber-400',
                          isActive &&
                            item.value === 'highlights' &&
                            'text-amber-500 dark:text-amber-300',
                          isActive && item.value === 'total' && 'text-primary'
                        )}
                        aria-hidden='true'
                      />
                      <span>{item.label}</span>
                      {item.count > 0 && (
                        <span
                          aria-hidden='true'
                          className={cn(
                            'hidden rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums md:inline-block',
                            isActive
                              ? 'bg-primary/12 text-primary'
                              : 'bg-background/70 text-muted-foreground'
                          )}
                        >
                          {formatNumber(item.count, locale)}
                        </span>
                      )}
                    </span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </LayoutGroup>
        </div>

        <TabsContent value={activeTab} className='space-y-4 pt-3'>
          {rawEntries.length === 0 ? (
            <EmptyState
              icon={Trophy}
              bordered
              title={t('No check-ins yet')}
              description={t('Check in today and try your luck.')}
              className='min-h-48 rounded-xl'
              action={
                canOfferCheckinAction ? (
                  <Button type='button' size='sm' onClick={props.onOpenCheckin}>
                    <Sparkles data-icon='inline-start' aria-hidden='true' />
                    {t('Check in now')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {rawEntries.length >= 2 && (
                <div className='grid grid-cols-2 gap-2.5 lg:grid-cols-4'>
                  {kpiCards.map((item) => {
                    const CardIcon = item.icon
                    return (
                      <Card
                        key={item.id}
                        data-card-hover='false'
                        className='group/kpi relative overflow-hidden py-0 transition-transform duration-200 hover:-translate-y-0.5'
                      >
                        <div
                          aria-hidden='true'
                          className={cn(
                            'pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-radial opacity-75 blur-xl transition-opacity group-hover/kpi:opacity-100',
                            item.glowClass
                          )}
                        />
                        <CardContent
                          className={cn(
                            'relative flex items-start justify-between gap-2',
                            isDialog ? 'p-3' : 'p-3.5'
                          )}
                        >
                          <div className='min-w-0'>
                            <p className='text-muted-foreground truncate text-xs'>
                              {item.label}
                            </p>
                            <p className='mt-1 truncate text-lg font-bold tracking-tight tabular-nums sm:text-xl'>
                              {item.value}
                            </p>
                            {item.subtext && (
                              <p className='text-muted-foreground mt-0.5 truncate text-[11px] tabular-nums'>
                                {item.subtext}
                              </p>
                            )}
                          </div>
                          <IconBadge tone={item.tone} size='stat'>
                            <CardIcon />
                          </IconBadge>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}

              <LeaderboardPodium
                entries={podiumEntries}
                tab={activeTab}
                retentionDays={retentionDays}
                locale={locale}
                onSelectEntry={handleSelectPodiumEntry}
              />

              <LeaderboardList
                entries={displayEntries}
                totalCount={
                  activeTab === 'highlights' && highlightView === 'winners'
                    ? metrics.uniqueWinners
                    : rawEntries.length
                }
                tab={activeTab}
                retentionDays={retentionDays}
                locale={locale}
                tierSummaries={listTierSummaries}
                tierFilter={tierFilter}
                onTierFilterChange={setTierFilter}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                highlightView={highlightView}
                onHighlightViewChange={setHighlightView}
                highlightSort={highlightSort}
                onHighlightSortChange={setHighlightSort}
                highlightedMe={highlightedMe}
                highlightedEntryId={highlightedEntryId}
                myRowRef={myRowRef}
                onRowElement={handleRowElement}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}
