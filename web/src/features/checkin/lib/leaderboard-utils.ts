import type { CheckinLeaderboard, CheckinLeaderboardEntry } from '../types'

export type LeaderboardTab = 'today' | 'highlights' | 'total'
export type HighlightSortMode = 'reward' | 'recent'
export type HighlightViewMode = 'all' | 'winners'
export type TierTone = 'jackpot' | 'high' | 'mid' | 'base'

export interface DisplayLeaderboardEntry extends CheckinLeaderboardEntry {
  id: string
  displayRank: number
  hitCount?: number
  totalQuota?: number
  isMe: boolean
  shareOfTop: number
  shareOfTotal: number
  tierTone: TierTone
}

export interface TierSummary {
  name: string
  count: number
  totalQuota: number
  maxQuota: number
  sharePercent: number
  tone: TierTone
}

export interface BoardMetrics {
  entryCount: number
  uniqueWinners: number
  topQuota: number
  totalQuota: number
  avgQuota: number
  medianQuota: number
  topTierName: string
  topTierCount: number
  topThreeSharePercent: number
}

export interface MyRankInsight {
  rank: number
  quota: number
  surpassedPercent: number
  status: 'champion' | 'podium' | 'on_board' | 'ranked'
  gapToFirst: number
  gapToPodium: number
  gapToBoard: number
  boardSize: number
  inTopList: boolean
}

export interface ResetCountdown {
  hours: number
  minutes: number
}

export interface TierToneStyle {
  badge: string
  dot: string
  segment: string
  bar: string
}

export interface RankMedalStyle {
  badge: string
  card: string
  accent: string
  avatar: string
  amount: string
}

const TIER_TONE_STYLES: Record<TierTone, TierToneStyle> = {
  jackpot: {
    badge:
      'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    dot: 'bg-amber-500',
    segment: 'bg-amber-500',
    bar: 'bg-amber-500/80 dark:bg-amber-400/80',
  },
  high: {
    badge:
      'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    segment: 'bg-emerald-500',
    bar: 'bg-emerald-500/80 dark:bg-emerald-400/80',
  },
  mid: {
    badge: 'border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-300',
    dot: 'bg-sky-500',
    segment: 'bg-sky-500',
    bar: 'bg-sky-500/80 dark:bg-sky-400/80',
  },
  base: {
    badge: 'border-border bg-muted/70 text-muted-foreground',
    dot: 'bg-muted-foreground/60',
    segment: 'bg-muted-foreground/45',
    bar: 'bg-primary/65',
  },
}

const RANK_MEDAL_STYLES: Record<1 | 2 | 3, RankMedalStyle> = {
  1: {
    badge:
      'border border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    card: 'border-amber-500/35 bg-gradient-to-b from-amber-500/12 via-amber-500/4 to-card ring-amber-500/25',
    accent: 'bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400',
    avatar:
      'bg-amber-500/15 text-amber-800 ring-2 ring-amber-500/35 dark:text-amber-200',
    amount: 'text-amber-800 dark:text-amber-300',
  },
  2: {
    badge:
      'border border-slate-400/40 bg-slate-500/12 text-slate-700 dark:text-slate-300',
    card: 'border-slate-400/30 bg-gradient-to-b from-slate-400/10 via-slate-400/3 to-card ring-slate-400/20',
    accent: 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-300',
    avatar:
      'bg-slate-500/12 text-slate-700 ring-2 ring-slate-400/30 dark:text-slate-200',
    amount: 'text-foreground',
  },
  3: {
    badge:
      'border border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-400/35 dark:bg-orange-500/15 dark:text-orange-300',
    card: 'border-orange-500/25 bg-gradient-to-b from-orange-500/10 via-orange-500/3 to-card ring-orange-500/20',
    accent: 'bg-gradient-to-r from-orange-400 via-amber-600 to-orange-400',
    avatar:
      'bg-orange-100 text-orange-800 ring-2 ring-orange-300 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-400/35',
    amount: 'text-foreground',
  },
}

export function getEntryDisplayName(entry: CheckinLeaderboardEntry): string {
  return entry.display_name || entry.username || '***'
}

export function getEntryInitial(entry: CheckinLeaderboardEntry): string {
  const name = getEntryDisplayName(entry).trim()
  for (const char of name) {
    if (char !== '*' && char.trim() !== '') {
      return char.toUpperCase()
    }
  }
  return '#'
}

function getEntryUserKey(entry: CheckinLeaderboardEntry): string {
  return `${entry.display_name || ''}\0${entry.username || ''}`
}

export function isCurrentUserTodayEntry(
  entry: CheckinLeaderboardEntry,
  board: CheckinLeaderboard,
  tab: LeaderboardTab
): boolean {
  if (tab !== 'today') return false
  if (board.my_rank === undefined || board.my_quota === undefined) return false
  return entry.rank === board.my_rank && entry.quota_awarded === board.my_quota
}

function assignTierTone(index: number, totalTiers: number): TierTone {
  if (totalTiers <= 1) return 'jackpot'
  if (index === 0) return 'jackpot'
  if (totalTiers === 2) return 'high'
  if (index === totalTiers - 1) return 'base'
  if (index === 1) return 'high'
  return 'mid'
}

export function extractTierSummaries(
  entries: CheckinLeaderboardEntry[]
): TierSummary[] {
  const grouped = new Map<
    string,
    { count: number; totalQuota: number; maxQuota: number }
  >()
  let totalWithTier = 0
  for (const entry of entries) {
    const tierName = (entry.tier_name || '').trim()
    if (!tierName) continue
    totalWithTier += 1
    const existing = grouped.get(tierName)
    if (existing) {
      existing.count += 1
      existing.totalQuota += entry.quota_awarded
      if (entry.quota_awarded > existing.maxQuota) {
        existing.maxQuota = entry.quota_awarded
      }
    } else {
      grouped.set(tierName, {
        count: 1,
        totalQuota: entry.quota_awarded,
        maxQuota: entry.quota_awarded,
      })
    }
  }
  const sorted = [...grouped.entries()].sort((left, right) => {
    if (right[1].maxQuota !== left[1].maxQuota) {
      return right[1].maxQuota - left[1].maxQuota
    }
    return right[1].count - left[1].count
  })
  return sorted.map(([name, stats], index) => ({
    name,
    count: stats.count,
    totalQuota: stats.totalQuota,
    maxQuota: stats.maxQuota,
    sharePercent: totalWithTier > 0 ? (stats.count * 100) / totalWithTier : 0,
    tone: assignTierTone(index, sorted.length),
  }))
}

export function buildTierToneMap(
  summaries: TierSummary[]
): Map<string, TierTone> {
  const map = new Map<string, TierTone>()
  for (const summary of summaries) {
    map.set(summary.name, summary.tone)
  }
  return map
}

export function getTierToneStyles(tone: TierTone): TierToneStyle {
  return TIER_TONE_STYLES[tone]
}

export function getRankMedalStyles(rank: number): RankMedalStyle | null {
  if (rank === 1 || rank === 2 || rank === 3) {
    return RANK_MEDAL_STYLES[rank]
  }
  return null
}

interface AggregatedWinner {
  entry: CheckinLeaderboardEntry
  hitCount: number
  totalQuota: number
  latestDate: string
  firstRank: number
}

export function groupHighlightWinners(
  entries: CheckinLeaderboardEntry[]
): Array<
  CheckinLeaderboardEntry & {
    hitCount: number
    totalQuota: number
  }
> {
  const winners = new Map<string, AggregatedWinner>()
  for (const entry of entries) {
    const userKey = getEntryUserKey(entry)
    const existing = winners.get(userKey)
    if (!existing) {
      winners.set(userKey, {
        entry,
        hitCount: 1,
        totalQuota: entry.quota_awarded,
        latestDate: entry.checkin_date || '',
        firstRank: entry.rank,
      })
      continue
    }
    existing.hitCount += 1
    existing.totalQuota += entry.quota_awarded
    const entryDate = entry.checkin_date || ''
    if (entryDate > existing.latestDate) {
      existing.latestDate = entryDate
    }
    if (
      entry.quota_awarded > existing.entry.quota_awarded ||
      (entry.quota_awarded === existing.entry.quota_awarded &&
        entryDate > (existing.entry.checkin_date || ''))
    ) {
      existing.entry = entry
    }
  }
  const sorted = [...winners.values()].sort((left, right) => {
    if (right.entry.quota_awarded !== left.entry.quota_awarded) {
      return right.entry.quota_awarded - left.entry.quota_awarded
    }
    if (right.hitCount !== left.hitCount) {
      return right.hitCount - left.hitCount
    }
    return left.firstRank - right.firstRank
  })
  return sorted.map((item, index) => ({
    ...item.entry,
    rank: index + 1,
    checkin_date: item.latestDate || item.entry.checkin_date,
    hitCount: item.hitCount,
    totalQuota: item.totalQuota,
  }))
}

export function buildDisplayEntries(options: {
  entries: CheckinLeaderboardEntry[]
  board: CheckinLeaderboard
  tab: LeaderboardTab
  tierToneMap: Map<string, TierTone>
  highlightView?: HighlightViewMode
  highlightSort?: HighlightSortMode
  searchQuery?: string
  tierFilter?: string
}): DisplayLeaderboardEntry[] {
  const isGroupedHighlights =
    options.tab === 'highlights' && options.highlightView === 'winners'
  const working: Array<
    CheckinLeaderboardEntry & { hitCount?: number; totalQuota?: number }
  > = isGroupedHighlights
    ? groupHighlightWinners(options.entries)
    : [...options.entries]

  if (options.tab === 'highlights' && options.highlightSort === 'recent') {
    working.sort((left, right) => {
      const leftDate = left.checkin_date || ''
      const rightDate = right.checkin_date || ''
      if (rightDate !== leftDate) return rightDate.localeCompare(leftDate)
      if (right.quota_awarded !== left.quota_awarded) {
        return right.quota_awarded - left.quota_awarded
      }
      return left.rank - right.rank
    })
  }

  let topQuota = 0
  let totalQuota = 0
  for (const item of working) {
    if (item.quota_awarded > topQuota) topQuota = item.quota_awarded
    totalQuota += item.quota_awarded
  }

  const normalizedQuery = (options.searchQuery || '').trim().toLowerCase()
  const normalizedTier = (options.tierFilter || '').trim()

  const enriched = working.map((item, index) => {
    const displayRank =
      options.tab === 'highlights' && options.highlightSort === 'recent'
        ? index + 1
        : item.rank || index + 1
    const tierName = (item.tier_name || '').trim()
    const tierTone = tierName
      ? (options.tierToneMap.get(tierName) ?? 'base')
      : 'base'
    const shareOfTop =
      topQuota > 0
        ? Math.max(4, Math.min(100, (item.quota_awarded * 100) / topQuota))
        : 0
    const shareOfTotal =
      totalQuota > 0 ? (item.quota_awarded * 100) / totalQuota : 0

    return {
      ...item,
      id: `${options.tab}-${item.rank}-${index}-${item.checkin_date || ''}-${getEntryUserKey(item)}`,
      displayRank,
      isMe: isCurrentUserTodayEntry(item, options.board, options.tab),
      shareOfTop,
      shareOfTotal,
      tierTone,
    }
  })

  return enriched.filter((entry) => {
    if (normalizedTier && (entry.tier_name || '').trim() !== normalizedTier) {
      return false
    }
    if (!normalizedQuery) return true
    const haystack = [
      entry.display_name,
      entry.username,
      entry.tier_name,
      entry.checkin_date,
      `#${entry.displayRank}`,
      String(entry.displayRank),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

export function selectPodiumEntries(options: {
  entries: CheckinLeaderboardEntry[]
  board: CheckinLeaderboard
  tab: LeaderboardTab
  tierToneMap: Map<string, TierTone>
}): DisplayLeaderboardEntry[] {
  if (options.entries.length === 0) return []
  const source = buildDisplayEntries({
    entries: options.entries,
    board: options.board,
    tab: options.tab,
    tierToneMap: options.tierToneMap,
    highlightView: options.tab === 'highlights' ? 'winners' : 'all',
    highlightSort: 'reward',
  })
  return source.slice(0, 3)
}

export function computeBoardMetrics(
  entries: CheckinLeaderboardEntry[],
  tierSummaries: TierSummary[]
): BoardMetrics {
  if (entries.length === 0) {
    return {
      entryCount: 0,
      uniqueWinners: 0,
      topQuota: 0,
      totalQuota: 0,
      avgQuota: 0,
      medianQuota: 0,
      topTierName: '',
      topTierCount: 0,
      topThreeSharePercent: 0,
    }
  }
  const uniqueKeys = new Set<string>()
  const quotas: number[] = []
  let totalQuota = 0
  let topQuota = 0
  for (const entry of entries) {
    uniqueKeys.add(getEntryUserKey(entry))
    quotas.push(entry.quota_awarded)
    totalQuota += entry.quota_awarded
    if (entry.quota_awarded > topQuota) topQuota = entry.quota_awarded
  }
  quotas.sort((left, right) => left - right)
  const middle = Math.floor(quotas.length / 2)
  const medianQuota =
    quotas.length % 2 === 0
      ? (quotas[middle - 1] + quotas[middle]) / 2
      : quotas[middle]

  const topThreeSum = entries
    .slice(0, 3)
    .reduce((sum, entry) => sum + entry.quota_awarded, 0)
  const topTier = tierSummaries[0]

  return {
    entryCount: entries.length,
    uniqueWinners: uniqueKeys.size,
    topQuota,
    totalQuota,
    avgQuota: totalQuota / entries.length,
    medianQuota,
    topTierName: topTier?.name ?? '',
    topTierCount: topTier?.count ?? 0,
    topThreeSharePercent: totalQuota > 0 ? (topThreeSum * 100) / totalQuota : 0,
  }
}

export function computeMyRankInsight(
  board: CheckinLeaderboard
): MyRankInsight | null {
  if (board.my_rank === undefined) return null
  const rank = board.my_rank
  const quota = board.my_quota ?? 0
  const surpassedPercent = Math.max(
    0,
    Math.min(100, (board.surpassed_bps ?? 0) / 100)
  )
  const top = board.top ?? []
  const boardSize = top.length
  const firstQuota = top[0]?.quota_awarded ?? 0
  const thirdQuota = top[2]?.quota_awarded ?? 0
  const cutoffQuota = top.at(-1)?.quota_awarded ?? 0

  let status: MyRankInsight['status'] = 'ranked'
  if (rank === 1) {
    status = 'champion'
  } else if (rank <= 3) {
    status = 'podium'
  } else if (boardSize > 0 && rank <= boardSize) {
    status = 'on_board'
  }

  const inTopList = top.some(
    (entry) => entry.rank === rank && entry.quota_awarded === quota
  )

  return {
    rank,
    quota,
    surpassedPercent,
    status,
    gapToFirst: rank > 1 && firstQuota > quota ? firstQuota - quota : 0,
    gapToPodium:
      rank > 3 && top.length >= 3 && thirdQuota >= quota
        ? thirdQuota - quota
        : 0,
    gapToBoard:
      boardSize > 0 && rank > boardSize && cutoffQuota >= quota
        ? cutoffQuota - quota
        : 0,
    boardSize,
    inTopList,
  }
}

export function getTimeUntilNextReset(
  timezone?: string,
  now: Date = new Date()
): ResetCountdown | null {
  if (!timezone) return null
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = formatter.formatToParts(now)
    const hourPart = Number(
      parts.find((part) => part.type === 'hour')?.value ?? '0'
    )
    const minutePart = Number(
      parts.find((part) => part.type === 'minute')?.value ?? '0'
    )
    const secondPart = Number(
      parts.find((part) => part.type === 'second')?.value ?? '0'
    )
    if (
      Number.isNaN(hourPart) ||
      Number.isNaN(minutePart) ||
      Number.isNaN(secondPart)
    ) {
      return null
    }
    const normalizedHour = hourPart === 24 ? 0 : hourPart
    const elapsedSeconds = normalizedHour * 3600 + minutePart * 60 + secondPart
    const remainingSeconds = Math.max(0, 86400 - elapsedSeconds)
    const totalRemainingMinutes = Math.ceil(remainingSeconds / 60)
    const hours = Math.floor(totalRemainingMinutes / 60)
    const minutes = totalRemainingMinutes % 60
    return { hours, minutes }
  } catch {
    return null
  }
}
