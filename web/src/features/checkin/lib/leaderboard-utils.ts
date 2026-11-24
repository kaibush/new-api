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
  topThreeSharePercent: number
  cutoffQuota: number
  cutoffRank: number
  topWinnerName: string
  topTierName: string
  topTierCount: number
  maxHitCount: number
  activeDaysCount: number
  latestDate: string
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
  wreath: string
  glow: string
  pedestal: string
  pedestalLedge: string
  pedestalNumber: string
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
    card: 'border-amber-500/40 bg-gradient-to-b from-amber-500/16 via-amber-500/5 to-card/95 ring-amber-500/30 shadow-[0_12px_36px_-14px_rgba(245,158,11,0.35)]',
    accent: 'bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400',
    avatar:
      'bg-gradient-to-br from-amber-200/80 via-amber-400/25 to-amber-500/20 text-amber-900 ring-2 ring-amber-500/45 dark:from-amber-400/25 dark:via-amber-500/20 dark:to-amber-600/15 dark:text-amber-200',
    amount:
      'bg-gradient-to-b from-amber-700 via-amber-800 to-amber-950 bg-clip-text text-transparent dark:from-yellow-200 dark:via-amber-300 dark:to-amber-500',
    wreath: 'text-amber-500/85 dark:text-amber-400/90',
    glow: 'from-amber-400/30 via-yellow-400/10 to-transparent dark:from-amber-400/28',
    pedestal:
      'border-amber-500/30 bg-gradient-to-b from-amber-500/22 via-amber-500/10 to-amber-500/4 dark:from-amber-500/24 dark:via-amber-500/10 dark:to-transparent',
    pedestalLedge:
      'bg-gradient-to-r from-amber-400/45 via-yellow-300/85 to-amber-500/45 dark:from-amber-500/40 dark:via-yellow-300/65 dark:to-amber-500/40',
    pedestalNumber:
      'bg-gradient-to-b from-amber-600/45 to-amber-600/10 bg-clip-text text-transparent dark:from-amber-300/45 dark:to-amber-400/8',
  },
  2: {
    badge:
      'border border-slate-400/40 bg-slate-500/12 text-slate-700 dark:text-slate-300',
    card: 'border-slate-400/35 bg-gradient-to-b from-slate-400/14 via-slate-400/4 to-card/95 ring-slate-400/25 shadow-[0_10px_28px_-14px_rgba(100,116,139,0.28)]',
    accent: 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-300',
    avatar:
      'bg-gradient-to-br from-slate-200/80 via-slate-400/20 to-slate-500/15 text-slate-800 ring-2 ring-slate-400/40 dark:from-slate-300/20 dark:via-slate-400/15 dark:to-slate-500/10 dark:text-slate-200',
    amount: 'text-foreground',
    wreath: 'text-slate-400 dark:text-slate-300/85',
    glow: 'from-slate-400/22 via-slate-400/6 to-transparent dark:from-slate-300/18',
    pedestal:
      'border-slate-400/25 bg-gradient-to-b from-slate-400/18 via-slate-400/8 to-slate-400/3 dark:from-slate-400/20 dark:via-slate-400/8 dark:to-transparent',
    pedestalLedge:
      'bg-gradient-to-r from-slate-300/45 via-slate-200/90 to-slate-400/45 dark:from-slate-400/35 dark:via-slate-200/55 dark:to-slate-400/35',
    pedestalNumber:
      'bg-gradient-to-b from-slate-500/40 to-slate-500/8 bg-clip-text text-transparent dark:from-slate-300/40 dark:to-slate-400/8',
  },
  3: {
    badge:
      'border border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-400/35 dark:bg-orange-500/15 dark:text-orange-300',
    card: 'border-orange-400/35 bg-gradient-to-b from-orange-500/14 via-orange-500/4 to-card/95 ring-orange-500/25 shadow-[0_10px_28px_-14px_rgba(234,88,12,0.25)]',
    accent: 'bg-gradient-to-r from-orange-400 via-amber-600 to-orange-400',
    avatar:
      'bg-orange-100 text-orange-800 ring-2 ring-orange-300 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-400/35',
    amount: 'text-foreground',
    wreath: 'text-orange-500/80 dark:text-orange-400/85',
    glow: 'from-orange-400/22 via-orange-400/6 to-transparent dark:from-orange-400/20',
    pedestal:
      'border-orange-400/25 bg-gradient-to-b from-orange-500/18 via-orange-500/8 to-orange-500/3 dark:from-orange-500/20 dark:via-orange-500/8 dark:to-transparent',
    pedestalLedge:
      'bg-gradient-to-r from-orange-400/45 via-amber-300/80 to-orange-500/45 dark:from-orange-500/35 dark:via-amber-300/55 dark:to-orange-500/35',
    pedestalNumber:
      'bg-gradient-to-b from-orange-600/40 to-orange-600/8 bg-clip-text text-transparent dark:from-orange-300/40 dark:to-orange-400/8',
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
      topThreeSharePercent: 0,
      cutoffQuota: 0,
      cutoffRank: 0,
      topWinnerName: '',
      topTierName: '',
      topTierCount: 0,
      maxHitCount: 0,
      activeDaysCount: 0,
      latestDate: '',
    }
  }
  const hitCounts = new Map<string, number>()
  const dates = new Set<string>()
  let topEntry = entries[0]
  let latestDate = ''
  let maxHitCount = 0
  for (const entry of entries) {
    const key = getEntryUserKey(entry)
    const nextCount = (hitCounts.get(key) ?? 0) + 1
    hitCounts.set(key, nextCount)
    if (nextCount > maxHitCount) maxHitCount = nextCount
    if (entry.quota_awarded > topEntry.quota_awarded) {
      topEntry = entry
    }
    const date = (entry.checkin_date || '').trim()
    if (date) {
      dates.add(date)
      if (date > latestDate) latestDate = date
    }
  }

  const quotas = entries
    .map((entry) => entry.quota_awarded)
    .sort((left, right) => left - right)
  const totalQuota = quotas.reduce((sum, quota) => sum + quota, 0)
  const middle = Math.floor(quotas.length / 2)
  const medianQuota =
    quotas.length % 2 === 0
      ? (quotas[middle - 1] + quotas[middle]) / 2
      : quotas[middle]
  const topThreeSum = entries
    .slice(0, 3)
    .reduce((sum, entry) => sum + entry.quota_awarded, 0)

  const lastEntry = entries.at(-1)
  const topTier = tierSummaries[0]

  return {
    entryCount: entries.length,
    uniqueWinners: hitCounts.size,
    topQuota: topEntry.quota_awarded,
    totalQuota,
    avgQuota: totalQuota / entries.length,
    medianQuota,
    topThreeSharePercent: totalQuota > 0 ? (topThreeSum * 100) / totalQuota : 0,
    cutoffQuota: lastEntry?.quota_awarded ?? 0,
    cutoffRank: lastEntry?.rank || entries.length,
    topWinnerName: getEntryDisplayName(topEntry),
    topTierName: topTier?.name ?? '',
    topTierCount: topTier?.count ?? 0,
    maxHitCount,
    activeDaysCount: dates.size,
    latestDate,
  }
}

export function formatHourWindow(hour: number): string {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  const next = (normalized + 1) % 24
  return `${String(normalized).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00`
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

function getRemainingSecondsInTimezone(
  timezone?: string,
  now: Date = new Date()
): number | null {
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
    return Math.max(0, 86400 - elapsedSeconds)
  } catch {
    return null
  }
}

export function getTimeUntilNextReset(
  timezone?: string,
  now: Date = new Date()
): ResetCountdown | null {
  const remainingSeconds = getRemainingSecondsInTimezone(timezone, now)
  if (remainingSeconds === null) return null
  const totalRemainingMinutes = Math.ceil(remainingSeconds / 60)
  const hours = Math.floor(totalRemainingMinutes / 60)
  const minutes = totalRemainingMinutes % 60
  return { hours, minutes }
}

export function formatResetCountdownClock(
  timezone?: string,
  now: Date = new Date()
): string | null {
  const remainingSeconds = getRemainingSecondsInTimezone(timezone, now)
  if (remainingSeconds === null) return null
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds % 60
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export type CheckinRollTone = 'jackpot' | 'lucky' | 'steady'

export interface CheckinRollEvaluation {
  tone: CheckinRollTone
  luckPercent: number | null
  hasRange: boolean
}

export function evaluateCheckinRoll(
  quotaAwarded: number,
  minQuota?: number,
  maxQuota?: number
): CheckinRollEvaluation {
  if (
    minQuota !== undefined &&
    maxQuota !== undefined &&
    maxQuota > minQuota &&
    Number.isFinite(quotaAwarded)
  ) {
    const ratio = Math.max(
      0,
      Math.min(1, (quotaAwarded - minQuota) / (maxQuota - minQuota))
    )
    const luckPercent = Math.round(ratio * 100)
    let tone: CheckinRollTone = 'steady'
    if (ratio >= 0.8) {
      tone = 'jackpot'
    } else if (ratio >= 0.45) {
      tone = 'lucky'
    }
    return { tone, luckPercent, hasRange: true }
  }
  return { tone: 'lucky', luckPercent: null, hasRange: false }
}

function parseUtcDayMs(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return Date.UTC(year, month - 1, day)
}

function formatUtcDayMs(timestampMs: number): string {
  const date = new Date(timestampMs)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function computeCheckinStreak(
  dates: Iterable<string>,
  today: string
): number {
  const todayMs = parseUtcDayMs(today)
  if (todayMs === null) return 0
  const dateSet = new Set<string>()
  for (const item of dates) {
    if (item) dateSet.add(item.trim())
  }
  if (dateSet.size === 0) return 0

  const dayMs = 86_400_000
  let cursorMs = todayMs
  if (!dateSet.has(formatUtcDayMs(cursorMs))) {
    cursorMs -= dayMs
    if (!dateSet.has(formatUtcDayMs(cursorMs))) {
      return 0
    }
  }

  let streak = 0
  while (dateSet.has(formatUtcDayMs(cursorMs))) {
    streak += 1
    cursorMs -= dayMs
  }
  return streak
}
