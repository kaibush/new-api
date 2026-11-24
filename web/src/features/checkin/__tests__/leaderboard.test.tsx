import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CheckinLeaderboard } from '../components/leaderboard'
import { CheckinLeaderboardPage } from '../components/leaderboard-page'
import { CheckinRewardRevealBanner } from '../components/reward-celebration'
import {
  buildTierToneMap,
  computeBoardMetrics,
  computeCheckinStreak,
  computeMyRankInsight,
  evaluateCheckinRoll,
  extractTierSummaries,
  formatHourWindow,
  formatResetCountdownClock,
  getTimeUntilNextReset,
  selectPodiumEntries,
} from '../lib/leaderboard-utils'
import type { CheckinLeaderboard as CheckinLeaderboardData } from '../types'

vi.mock('@/components/layout', async () => {
  const React = await import('react')
  function Title(_props: { children?: ReactNode }) {
    return null
  }
  function Actions(_props: { children?: ReactNode }) {
    return null
  }
  function Content(_props: { children?: ReactNode }) {
    return null
  }
  function SectionPageLayout(props: { children: ReactNode }) {
    let title: ReactNode = null
    let actions: ReactNode = null
    let content: ReactNode = null
    React.Children.forEach(props.children, (child) => {
      if (!React.isValidElement<{ children?: ReactNode }>(child)) return
      if (child.type === Title) title = child.props.children
      else if (child.type === Actions) actions = child.props.children
      else if (child.type === Content) content = child.props.children
    })
    return (
      <div>
        <h1>{title}</h1>
        <div>{actions}</div>
        <div>{content}</div>
      </div>
    )
  }
  SectionPageLayout.Title = Title
  SectionPageLayout.Actions = Actions
  SectionPageLayout.Content = Content
  return { SectionPageLayout }
})

vi.mock('@/features/profile/components/checkin-calendar-card', () => ({
  CheckinCalendarCard: () => <div data-testid='mock-checkin-calendar' />,
}))

const clients: QueryClient[] = []

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
}

afterEach(() => {
  while (clients.length > 0) {
    clients.pop()?.clear()
  }
  vi.restoreAllMocks()
})

const sampleBoard: CheckinLeaderboardData = {
  enabled: true,
  today: '2030-05-15',
  timezone: 'Asia/Shanghai',
  retention_days: 30,
  top_n: 20,
  today_checkins: 48,
  yesterday_checkins: 36,
  today_peak_hour: 9,
  today_peak_hour_checkins: 14,
  recent_participants: 120,
  recent_checkins: 860,
  my_rank: 4,
  my_quota: 250000,
  surpassed_bps: 7500,
  top: [
    {
      rank: 1,
      username: 'a***1',
      display_name: 'Alice',
      quota_awarded: 2000000,
      tier_name: 'Jackpot',
      checkin_date: '2030-05-15',
    },
    {
      rank: 2,
      username: 'b***2',
      display_name: 'Bob',
      quota_awarded: 900000,
      tier_name: 'Lucky',
      checkin_date: '2030-05-15',
    },
    {
      rank: 3,
      username: 'c***3',
      display_name: 'Carol',
      quota_awarded: 500000,
      tier_name: 'Lucky',
      checkin_date: '2030-05-15',
    },
    {
      rank: 4,
      username: 'm***4',
      display_name: 'MeUser',
      quota_awarded: 250000,
      tier_name: 'Standard',
      checkin_date: '2030-05-15',
    },
  ],
  recent_highlights: [
    {
      rank: 1,
      username: 'w***1',
      display_name: 'RepeatChamp',
      quota_awarded: 3000000,
      tier_name: 'Jackpot',
      checkin_date: '2030-05-10',
    },
    {
      rank: 2,
      username: 'w***1',
      display_name: 'RepeatChamp',
      quota_awarded: 2800000,
      tier_name: 'Jackpot',
      checkin_date: '2030-05-14',
    },
    {
      rank: 3,
      username: 'w***1',
      display_name: 'RepeatChamp',
      quota_awarded: 2600000,
      tier_name: 'Jackpot',
      checkin_date: '2030-05-12',
    },
    {
      rank: 4,
      username: 'd***4',
      display_name: 'Diana',
      quota_awarded: 2400000,
      tier_name: 'Jackpot',
      checkin_date: '2030-05-15',
    },
    {
      rank: 5,
      username: 'e***5',
      display_name: 'Evan',
      quota_awarded: 1900000,
      tier_name: 'Super',
      checkin_date: '2030-05-11',
    },
  ],
  recent_totals: [
    {
      rank: 1,
      username: 'w***1',
      display_name: 'RepeatChamp',
      quota_awarded: 12000000,
      tier_name: '',
      checkin_date: '',
    },
    {
      rank: 2,
      username: 'd***4',
      display_name: 'Diana',
      quota_awarded: 6000000,
      tier_name: '',
      checkin_date: '',
    },
    {
      rank: 3,
      username: 'e***5',
      display_name: 'Evan',
      quota_awarded: 2000000,
      tier_name: '',
      checkin_date: '',
    },
  ],
}

describe('leaderboard-utils', () => {
  test('extractTierSummaries sorts tiers by peak quota and assigns semantic tones', () => {
    const summaries = extractTierSummaries(sampleBoard.top ?? [])
    expect(summaries.map((item) => [item.name, item.tone, item.count])).toEqual(
      [
        ['Jackpot', 'jackpot', 1],
        ['Lucky', 'high', 2],
        ['Standard', 'base', 1],
      ]
    )
  })

  test('selectPodiumEntries deduplicates repeat jackpot winners on highlights', () => {
    const highlights = sampleBoard.recent_highlights ?? []
    const toneMap = buildTierToneMap(extractTierSummaries(highlights))
    const podium = selectPodiumEntries({
      entries: highlights,
      board: sampleBoard,
      tab: 'highlights',
      tierToneMap: toneMap,
    })
    expect(podium.map((entry) => entry.display_name)).toEqual([
      'RepeatChamp',
      'Diana',
      'Evan',
    ])
    expect(podium[0]?.hitCount).toBe(3)
    expect(podium[0]?.checkin_date).toBe('2030-05-14')
  })

  test('computeMyRankInsight derives status and gap to next milestone', () => {
    const onBoard = computeMyRankInsight(sampleBoard)
    expect(onBoard).toMatchObject({
      rank: 4,
      status: 'on_board',
      gapToPodium: 250000,
      inTopList: true,
    })

    const champion = computeMyRankInsight({
      ...sampleBoard,
      my_rank: 1,
      my_quota: 2000000,
      surpassed_bps: 10000,
    })
    expect(champion).toMatchObject({
      status: 'champion',
      gapToFirst: 0,
      inTopList: true,
    })

    const outside = computeMyRankInsight({
      ...sampleBoard,
      my_rank: 12,
      my_quota: 100000,
      surpassed_bps: 2000,
    })
    expect(outside).toMatchObject({
      status: 'ranked',
      gapToPodium: 400000,
      gapToBoard: 150000,
      inTopList: false,
    })
  })

  test('computeBoardMetrics and formatHourWindow compute non-sensitive board stats', () => {
    const highlights = sampleBoard.recent_highlights ?? []
    const summaries = extractTierSummaries(highlights)
    const metrics = computeBoardMetrics(highlights, summaries)
    expect(metrics).toEqual({
      entryCount: 5,
      uniqueWinners: 3,
      topQuota: 3000000,
      totalQuota: 12700000,
      avgQuota: 2540000,
      medianQuota: 2600000,
      topThreeSharePercent: (8400000 * 100) / 12700000,
      cutoffQuota: 1900000,
      cutoffRank: 5,
      topWinnerName: 'RepeatChamp',
      topTierName: 'Jackpot',
      topTierCount: 4,
      maxHitCount: 3,
      activeDaysCount: 5,
      latestDate: '2030-05-15',
    })
    expect(formatHourWindow(9)).toBe('09:00–10:00')
    expect(formatHourWindow(23)).toBe('23:00–00:00')
  })

  test('getTimeUntilNextReset computes remaining time in target timezone', () => {
    const now = new Date('2030-05-15T14:30:15Z')
    expect(getTimeUntilNextReset('Asia/Shanghai', now)).toEqual({
      hours: 1,
      minutes: 30,
    })
    expect(formatResetCountdownClock('Asia/Shanghai', now)).toBe('01:29:45')
    expect(getTimeUntilNextReset('Invalid/Zone', now)).toBeNull()
    expect(formatResetCountdownClock('Invalid/Zone', now)).toBeNull()
  })

  test('evaluateCheckinRoll and computeCheckinStreak classify luck and consecutive days', () => {
    expect(evaluateCheckinRoll(950000, 100000, 1000000)).toEqual({
      tone: 'jackpot',
      luckPercent: 94,
      hasRange: true,
    })
    expect(evaluateCheckinRoll(600000, 100000, 1000000)).toEqual({
      tone: 'lucky',
      luckPercent: 56,
      hasRange: true,
    })
    expect(evaluateCheckinRoll(150000, 100000, 1000000)).toEqual({
      tone: 'steady',
      luckPercent: 6,
      hasRange: true,
    })
    expect(evaluateCheckinRoll(100000, 100000, 100000)).toEqual({
      tone: 'lucky',
      luckPercent: null,
      hasRange: false,
    })

    expect(
      computeCheckinStreak(
        ['2030-05-12', '2030-05-14', '2030-05-15'],
        '2030-05-15'
      )
    ).toBe(2)
    expect(
      computeCheckinStreak(
        ['2030-05-12', '2030-05-13', '2030-05-14'],
        '2030-05-15'
      )
    ).toBe(3)
    expect(computeCheckinStreak(['2030-05-12'], '2030-05-15')).toBe(0)
  })
})

describe('CheckinLeaderboard', () => {
  test('filters by tier and search, highlights current user, and supports locate-me from another tab', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: sampleBoard },
    })
    const user = userEvent.setup()
    renderWithQuery(<CheckinLeaderboard />)

    expect(await screen.findByText('#4')).toBeInTheDocument()
    expect(screen.getByText('/ 48')).toBeInTheDocument()
    expect(screen.getByText('48 checked in today')).toBeInTheDocument()
    expect(screen.getByText('Board total')).toBeInTheDocument()
    expect(screen.getByText('Median')).toBeInTheDocument()
    const insights = screen.getByRole('group', { name: 'Activity' })
    expect(within(insights).getByText("Today's check-ins")).toBeInTheDocument()
    expect(within(insights).getByText('Yesterday: 36')).toBeInTheDocument()
    expect(within(insights).getByText('Board coverage')).toBeInTheDocument()
    expect(within(insights).getByText('4 / 48')).toBeInTheDocument()
    expect(within(insights).getByText('Board cutoff')).toBeInTheDocument()
    expect(within(insights).getByText('Peak hour')).toBeInTheDocument()
    expect(within(insights).getByText('09:00–10:00')).toBeInTheDocument()
    expect(within(insights).getByText('14 check-ins')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Live lucky feed')).toBeInTheDocument()
    expect(screen.getByText('Hall of fortune')).toBeInTheDocument()
    expect(screen.getByText('Tier distribution')).toBeInTheDocument()

    const filterGroup = screen.getByRole('group', { name: 'Filter by tier' })
    await user.click(within(filterGroup).getByRole('button', { name: /Lucky/ }))
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument()

    const championCard = document.querySelector(
      '[data-podium-rank="1"] [role="button"]'
    )
    expect(championCard).not.toBeNull()
    await user.click(championCard as HTMLElement)
    expect(screen.queryByText('Showing 2 of 4')).not.toBeInTheDocument()

    const searchInput = screen.getByRole('textbox', {
      name: 'Search leaderboard',
    })
    await user.keyboard('/')
    expect(searchInput).toHaveFocus()
    await user.keyboard('Bob{Escape}')
    expect(searchInput).toHaveValue('')
    await user.type(searchInput, 'nobody-here')
    expect(screen.getByText('No results found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.queryByText('No results found')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Recent total rewards' }))
    expect(screen.getByText('Board total')).toBeInTheDocument()
    expect(screen.getAllByText(/Last 30 days ·/)).toHaveLength(3)
    const totalInsights = screen.getByRole('group', { name: 'Activity' })
    expect(
      within(totalInsights).getByText('Active participants')
    ).toBeInTheDocument()
    expect(within(totalInsights).getByText('120')).toBeInTheDocument()
    expect(within(totalInsights).getByText('860')).toBeInTheDocument()
    expect(
      within(totalInsights).getByText('Check-ins per user')
    ).toBeInTheDocument()
    expect(within(totalInsights).getByText('7.2')).toBeInTheDocument()

    const scrollSpy = vi.fn()
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollSpy
    try {
      await user.click(screen.getByRole('button', { name: 'Locate me' }))
      expect(
        screen.getByRole('tab', { name: 'Today’s lucky winners' })
      ).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('MeUser')).toBeInTheDocument()
    } finally {
      Element.prototype.scrollIntoView = originalScroll
    }
  })

  test('deduplicates repeat jackpot winners on podium and toggles grouping and sort', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: sampleBoard },
    })
    const user = userEvent.setup()
    renderWithQuery(<CheckinLeaderboard initialTab='highlights' />)

    expect(await screen.findByText('Jackpot hits')).toBeInTheDocument()
    expect(screen.getByText('3 unique winners')).toBeInTheDocument()
    expect(screen.getByText('Board total')).toBeInTheDocument()
    expect(screen.getByText('Median')).toBeInTheDocument()
    const highlightInsights = screen.getByRole('group', { name: 'Activity' })
    expect(
      within(highlightInsights).getByText('Lucky winners')
    ).toBeInTheDocument()
    expect(
      within(highlightInsights).getByText('Most hits: ×3')
    ).toBeInTheDocument()
    expect(within(highlightInsights).getByText('Top tier')).toBeInTheDocument()
    expect(within(highlightInsights).getByText('4 hits')).toBeInTheDocument()
    expect(
      within(highlightInsights).getByText('Latest jackpot')
    ).toBeInTheDocument()
    expect(
      within(highlightInsights).getByText('5 active days')
    ).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()
    const filterGroup = screen.getByRole('group', { name: 'Filter by tier' })
    expect(
      within(filterGroup).getByRole('button', { name: /All tiers.*5/ })
    ).toBeInTheDocument()
    expect(
      within(filterGroup).getByRole('button', { name: /Jackpot.*4/ })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unique winners' }))
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(
      within(filterGroup).getByRole('button', { name: /All tiers.*3/ })
    ).toBeInTheDocument()
    expect(
      within(filterGroup).getByRole('button', { name: /Jackpot.*2/ })
    ).toBeInTheDocument()
    expect(
      within(filterGroup).getByRole('button', { name: /Super.*1/ })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Latest' }))
    const orderedNames = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(orderedNames[0]).toContain('Diana')
    expect(orderedNames[1]).toContain('RepeatChamp')
    expect(orderedNames[2]).toContain('Evan')
  })

  test('shows unchecked-in CTA and disabled/error states cleanly', async () => {
    const onOpenCheckin = vi.fn()
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...sampleBoard,
          my_rank: undefined,
          my_quota: undefined,
          surpassed_bps: undefined,
        },
      },
    })
    const user = userEvent.setup()
    renderWithQuery(
      <CheckinLeaderboard
        checkinPrompt={{
          checkedIn: false,
          minQuota: 50000,
          maxQuota: 500000,
          allowed: true,
        }}
        onOpenCheckin={onOpenCheckin}
      />
    )

    expect(await screen.findByText('Not checked in today')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check in now' }))
    expect(onOpenCheckin).toHaveBeenCalledTimes(1)
  })

  test('renders disabled empty state when leaderboard is turned off', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: { success: true, data: { enabled: false } },
    })
    renderWithQuery(<CheckinLeaderboard />)
    expect(
      await screen.findByText('Leaderboard is disabled')
    ).toBeInTheDocument()
  })
})

describe('CheckinLeaderboardPage', () => {
  test('shows header check-in button and opens the check-in dialog', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/status') {
        return { data: { success: true, data: { checkin_enabled: true } } }
      }
      if (url === '/api/user/checkin') {
        return {
          data: {
            success: true,
            data: {
              enabled: true,
              eligibility: {
                allowed: true,
                min_quota: 50000,
                max_quota: 500000,
                today: '2030-05-15',
              },
              stats: { checked_in_today: false, records: [] },
            },
          },
        }
      }
      return {
        data: {
          success: true,
          data: {
            ...sampleBoard,
            my_rank: undefined,
            my_quota: undefined,
            surpassed_bps: undefined,
          },
        },
      }
    })
    const user = userEvent.setup()
    renderWithQuery(<CheckinLeaderboardPage />)

    const buttons = await screen.findAllByRole('button', {
      name: 'Check in now',
    })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    await user.click(buttons[0])
    expect(
      await screen.findByTestId('mock-checkin-calendar')
    ).toBeInTheDocument()
  })
})

describe('CheckinRewardRevealBanner', () => {
  test('renders jackpot roll reveal, luck meter, streak badge, and celebration actions', async () => {
    const onAction = vi.fn()
    const onReplay = vi.fn()
    const onDismiss = vi.fn()
    const user = userEvent.setup()

    renderWithQuery(
      <CheckinRewardRevealBanner
        quotaAwarded={4500000}
        minQuota={100000}
        maxQuota={5000000}
        streakDays={5}
        actionLabel='See my rank'
        onAction={onAction}
        onReplayConfetti={onReplay}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByText('Jackpot roll')).toBeInTheDocument()
    expect(screen.getByText('5-day streak')).toBeInTheDocument()
    expect(screen.getByText('Luck 90%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'See my rank' }))
    expect(onAction).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Replay confetti' }))
    expect(onReplay).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
