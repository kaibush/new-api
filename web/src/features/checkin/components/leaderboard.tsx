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
} from 'lucide-react'
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
  getTimeUntilNextReset,
  groupHighlightWinners,
  selectPodiumEntries,
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

export function CheckinLeaderboard(props: CheckinLeaderboardProps = {}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const isDialog = props.mode === 'dialog'
  const [tab, setTab] = useState<LeaderboardTab>(props.initialTab ?? 'today')
  const [searchQuery, setSearchQuery] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [highlightView, setHighlightView] = useState<HighlightViewMode>('all')
  const [highlightSort, setHighlightSort] =
    useState<HighlightSortMode>('reward')
  const [highlightedMe, setHighlightedMe] = useState(false)
  const [pendingLocate, setPendingLocate] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const myRowRef = useRef<HTMLLIElement | null>(null)
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
    const interval = window.setInterval(() => {
      setNowTick(Date.now())
    }, 60000)
    return () => window.clearInterval(interval)
  }, [board?.timezone])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!pendingLocate) return
    setPendingLocate(false)
    const frame = window.requestAnimationFrame(() => {
      const element = myRowRef.current
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingLocate, activeTab, searchQuery, tierFilter])

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
  const resetCountdown = useMemo(
    () => getTimeUntilNextReset(board?.timezone, new Date(nowTick)),
    [board?.timezone, nowTick]
  )

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
    setPendingLocate(true)
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMe(false)
    }, 2400)
  }

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
          },
          {
            id: 'total',
            label: t('Board total'),
            value: formatQuotaWithCurrency(metrics.totalQuota),
            subtext: t('Last {{count}} days', { count: retentionDays }),
            tone: 'success',
            icon: Wallet,
          },
          {
            id: 'median',
            label: t('Median'),
            value: formatQuotaWithCurrency(metrics.medianQuota),
            subtext: avgSubtext,
            tone: 'info',
            icon: BarChart3,
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
          },
          {
            id: 'winners',
            label: t('Winners'),
            value: formatNumber(metrics.entryCount, locale),
            subtext: winnersSubtext,
            tone: 'primary',
            icon: Users,
          },
          {
            id: 'median',
            label: t('Median'),
            value: formatQuotaWithCurrency(metrics.medianQuota),
            subtext: avgSubtext,
            tone: 'info',
            icon: BarChart3,
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
            <span className='bg-muted/60 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tabular-nums'>
              <Calendar className='size-3.5 shrink-0' aria-hidden='true' />
              {board.today}
            </span>
          )}
          {board.timezone && (
            <span className='bg-muted/60 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1'>
              <Globe className='size-3.5 shrink-0' aria-hidden='true' />
              {board.timezone}
            </span>
          )}
          <span className='bg-muted/60 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tabular-nums'>
            <History className='size-3.5 shrink-0' aria-hidden='true' />
            {t('Last {{count}} days', { count: retentionDays })}
          </span>
          {resetCountdown && (
            <span className='bg-primary/8 text-primary border-primary/20 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium tabular-nums'>
              <Clock className='size-3.5 shrink-0' aria-hidden='true' />
              {t('Resets in {{hours}}h {{minutes}}m', {
                hours: resetCountdown.hours,
                minutes: resetCountdown.minutes,
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

      <LeaderboardMyRank
        insight={myRankInsight}
        locale={locale}
        checkinPrompt={props.checkinPrompt}
        showRecordsAction={isDialog}
        onLocateMe={handleLocateMe}
        onOpenCheckin={props.onOpenCheckin}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className='-mx-1 [scrollbar-width:none] overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden'>
          <TabsList className='inline-flex w-max min-w-full flex-nowrap sm:w-fit sm:min-w-0'>
            <TabsTrigger
              value='today'
              className='shrink-0 gap-1 px-1.5 text-[11px] sm:gap-1.5 sm:px-3 sm:text-sm'
            >
              <Trophy
                className='hidden size-3.5 shrink-0 sm:inline-block'
                aria-hidden='true'
              />
              {t('Today’s lucky winners')}
            </TabsTrigger>
            {hasHighlights && (
              <TabsTrigger
                value='highlights'
                className='shrink-0 gap-1 px-1.5 text-[11px] sm:gap-1.5 sm:px-3 sm:text-sm'
              >
                <Sparkles
                  className='hidden size-3.5 shrink-0 sm:inline-block'
                  aria-hidden='true'
                />
                {t('Recent jackpots')}
              </TabsTrigger>
            )}
            <TabsTrigger
              value='total'
              className='shrink-0 gap-1 px-1.5 text-[11px] sm:gap-1.5 sm:px-3 sm:text-sm'
            >
              <Award
                className='hidden size-3.5 shrink-0 sm:inline-block'
                aria-hidden='true'
              />
              {t('Recent total rewards')}
            </TabsTrigger>
          </TabsList>
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
                        className='py-0'
                      >
                        <CardContent
                          className={cn(
                            'flex items-start justify-between gap-2',
                            isDialog ? 'p-3' : 'p-3.5'
                          )}
                        >
                          <div className='min-w-0'>
                            <p className='text-muted-foreground truncate text-xs'>
                              {item.label}
                            </p>
                            <p className='mt-1 truncate text-base font-semibold tracking-tight tabular-nums sm:text-lg'>
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
                myRowRef={myRowRef}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}
