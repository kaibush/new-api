import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { ChannelStatus } from '..'
import {
  auditRate,
  getChannelStatus,
  getStatusDashboard,
  type ChannelStatusData,
} from '../api'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getChannelStatus: vi.fn(),
  getStatusDashboard: vi.fn(),
}))
vi.mock('@/components/layout', () => {
  const Slot = (props: { children: ReactNode }) => <div>{props.children}</div>
  return {
    SectionPageLayout: Object.assign(Slot, {
      Title: Slot,
      Actions: Slot,
      Content: Slot,
    }),
  }
})
afterEach(() => {
  cleanup()
  useAuthStore.setState((state) => ({ auth: { ...state.auth, user: null } }))
})
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ChannelStatus />
    </QueryClientProvider>
  )
}
const populated: ChannelStatusData = {
  configured: true,
  summary: {
    name: 'GrokIQ',
    requestCount: 10,
    thinkingRequests: 7,
    thinkingSampleRequests: 8,
    httpSuccessRequests: 9,
  },
  clients: [
    {
      name: 'alice',
      requestCount: 2,
      thinkingRequests: 1,
      thinkingSampleRequests: 2,
      httpSuccessRequests: 2,
    },
  ],
}
describe('channel status page', () => {
  it('shows configuration guidance when integration is absent', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({ configured: false })
    renderPage()
    expect(
      await screen.findByText('GrokIQ is not configured')
    ).toBeInTheDocument()
  })
  it('loads the chosen window and shows quality and HTTP with distinct denominators', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue(populated)
    renderPage()
    expect(await screen.findByText('87.5%')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.queryByText('alice')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Active clients' }))
    expect(await screen.findByText('alice')).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Time range' }),
      '3h'
    )
    await waitFor(() =>
      expect(getChannelStatus).toHaveBeenLastCalledWith(
        '3h',
        expect.any(AbortSignal)
      )
    )
  })
  it('shows no-sample markers and personal empty state instead of a passing rate', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      configured: true,
      summary: {
        name: 'GrokIQ',
        requestCount: 0,
        thinkingRequests: 0,
        thinkingSampleRequests: 0,
        httpSuccessRequests: 0,
      },
      clients: [],
    })
    renderPage()
    expect(
      await screen.findByText('No requests in this time range')
    ).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    for (const marker of screen.getAllByText('—')) {
      expect(marker).toHaveClass('text-muted-foreground')
      expect(marker).not.toHaveClass('text-rose-700')
    }
    const empty = screen.getByText('No requests in this time range')
    expect(empty.closest('[data-slot="card"]')).not.toBeNull()
    expect(empty.closest('[data-slot="empty"]')).toHaveClass('min-h-0')
    await userEvent.click(screen.getByRole('tab', { name: 'Active clients' }))
    expect(
      await screen.findByText('No matching client activity')
    ).toBeInTheDocument()
  })
  it.each(['2026-10-21T08:35:00Z', null])(
    'shows one snapshot timestamp with a check-time fallback when updatedAt is %s',
    async (updatedAt) => {
      vi.mocked(getChannelStatus).mockResolvedValue({
        ...populated,
        checkedAt: '2026-10-21T08:36:10Z',
        inventory: {
          reachable: true,
          updatedAt,
          providers: { grok_build: { capacity: 97 } },
        },
      })
      renderPage()
      await screen.findByText('97%')
      expect(screen.getAllByText(/Last updated/)).toHaveLength(1)
      expect(
        screen.getByText(/Last updated/).querySelector('time')
      ).toHaveAttribute('dateTime', updatedAt ?? '2026-10-21T08:36:10Z')
      await userEvent.click(screen.getByRole('tab', { name: 'Active clients' }))
      expect(screen.getAllByText(/Last updated/)).toHaveLength(1)
      expect(
        screen.getByText(/Last updated/).querySelector('time')
      ).toHaveAttribute('dateTime', '2026-10-21T08:36:10Z')
    }
  )
  it('wraps navigation within the page and keeps keyboard tab selection available', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue(populated)
    renderPage()
    const tabs = await screen.findByRole('tablist')
    expect(tabs).toHaveClass(
      'max-w-full',
      'flex-wrap',
      'group-data-horizontal/tabs:h-auto',
      '[&>[role=tab]]:flex-none'
    )
    screen.getByRole('tab', { name: 'Channel availability' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Request health' })).toHaveFocus()
  })
  it('retains audit cards when inventory fails and supports retry', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      ...populated,
      inventoryError: 'GrokIQ returned HTTP 503',
    })
    renderPage()
    expect(await screen.findByText('87.5%')).toBeInTheDocument()
    expect(screen.getByText('GrokIQ returned HTTP 503')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(getChannelStatus).toHaveBeenCalledTimes(2))
  })
  it('keeps quality above tabs and shows public capacity without account inventory', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      ...populated,
      inventory: {
        reachable: true,
        updatedAt: null,
        providers: { grok_build: { capacity: 75 } },
      },
    })
    renderPage()
    const quality = await screen.findByText('87.5%')
    const tabs = screen.getByRole('tablist')
    expect(
      quality.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.queryByText('Recovery queue')).not.toBeInTheDocument()
    expect(getStatusDashboard).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('tab', { name: 'How these metrics are calculated' })
    )
    expect(screen.getByText('87.5%')).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'How these metrics are calculated' })
    ).toHaveAttribute('aria-selected', 'true')
  })
  it('shows administrator recovery and issue details from the authorized response', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      ...populated,
      inventory: {
        reachable: true,
        updatedAt: null,
        providers: {},
        accounts: {
          total: 20,
          available: 15,
          recovering: 3,
          attention: 2,
          risk: 1,
          recovery: { cooldown: 1, waitingReset: 1, probing: 1 },
          issues: { disabled: 1, reauthRequired: 1 },
        },
      },
    })
    renderPage()
    expect(await screen.findByText('Recovery queue')).toBeInTheDocument()
    expect(screen.getByText('Reauthentication required')).toBeInTheDocument()
    expect(screen.getByText('Risk accounts')).toBeInTheDocument()
  })
  it('loads health only when selected and retains quality when it fails', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue(populated)
    vi.mocked(getStatusDashboard).mockRejectedValue(new Error('unavailable'))
    renderPage()
    await screen.findByText('87.5%')
    await userEvent.click(screen.getByRole('tab', { name: 'Request health' }))
    await screen.findByRole('button', { name: 'Retry' })
    expect(getStatusDashboard).toHaveBeenCalledWith(
      'health',
      expect.objectContaining({ period: '24h' }),
      expect.any(AbortSignal)
    )
    expect(screen.getByText('87.5%')).toBeInTheDocument()
  })
  it('loads usage periods and converts a custom Shanghai range to UTC', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      ...populated,
      checkedAt: '2026-10-21T08:36:10Z',
    })
    vi.mocked(getStatusDashboard).mockResolvedValue({
      reachable: true,
      generatedAt: '2026-10-21T08:35:00Z',
      range: { start: null, end: null },
      usage: {
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        tokens: 0,
        billedCostUsdTicks: 0,
        successRate: 0,
        cacheHitRate: 0,
        averageFirstTokenMs: 0,
        outputTokensPerSecond: 0,
        firstTokenSamples: 0,
        throughputSamples: 0,
      },
      series: [],
      activity: [],
      topModels: [],
      providers: [],
    })
    renderPage()
    await screen.findByText('87.5%')
    await userEvent.click(screen.getByRole('tab', { name: 'Usage statistics' }))
    const period = await screen.findByRole('combobox', {
      name: 'Statistics period',
    })
    await screen.findByText('First token latency (ms)')
    expect(screen.getAllByText(/Last updated/)).toHaveLength(1)
    await userEvent.selectOptions(period, '30d')
    await waitFor(() =>
      expect(getStatusDashboard).toHaveBeenLastCalledWith(
        'usage',
        expect.objectContaining({ period: '30d' }),
        expect.any(AbortSignal)
      )
    )
    await userEvent.selectOptions(period, 'custom')
    const start = screen.getByLabelText('Start time')
    const end = screen.getByLabelText('End time')
    fireEvent.change(start, { target: { value: '2026-10-01T00:00' } })
    fireEvent.change(end, { target: { value: '2026-10-02T00:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() =>
      expect(getStatusDashboard).toHaveBeenLastCalledWith(
        'usage',
        {
          period: 'custom',
          start: '2026-09-30T16:00:00.000Z',
          end: '2026-10-01T16:00:00.000Z',
        },
        expect.any(AbortSignal)
      )
    )
  })
  it('does not reuse administrator data after the authenticated role changes', async () => {
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: { id: 1, username: 'alice', role: 10 } },
    }))
    vi.mocked(getChannelStatus)
      .mockResolvedValueOnce({
        ...populated,
        inventory: {
          reachable: true,
          updatedAt: null,
          providers: {},
          accounts: {
            total: 20,
            available: 15,
            recovering: 3,
            attention: 2,
            risk: 1,
            recovery: null,
            issues: null,
          },
        },
      })
      .mockResolvedValue(populated)
    renderPage()
    await screen.findByText('Risk accounts')
    act(() =>
      useAuthStore.setState((state) => ({
        auth: { ...state.auth, user: { id: 1, username: 'alice', role: 1 } },
      }))
    )
    await waitFor(() =>
      expect(screen.queryByText('Risk accounts')).not.toBeInTheDocument()
    )
    await waitFor(() => expect(getChannelStatus).toHaveBeenCalledTimes(2))
  })
  it('colors quality and HTTP rates with the shared five-band scale', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      configured: true,
      summary: {
        name: 'GrokIQ',
        requestCount: 20,
        thinkingRequests: 19,
        thinkingSampleRequests: 20,
        httpSuccessRequests: 16,
      },
      clients: [
        {
          name: 'steady',
          requestCount: 10,
          thinkingRequests: 6,
          thinkingSampleRequests: 10,
          httpSuccessRequests: 4,
        },
        {
          name: 'weak',
          requestCount: 5,
          thinkingRequests: 1,
          thinkingSampleRequests: 5,
          httpSuccessRequests: 0,
        },
      ],
    })
    renderPage()
    const summary = (await screen.findByText('Request quality')).closest(
      '[data-slot="card"]'
    )
    expect(summary).not.toBeNull()
    const summaryCard = within(summary as HTMLElement)
    expect(summaryCard.getByText('95%')).toHaveClass(
      'bg-emerald-500/10',
      'text-emerald-700'
    )
    expect(summaryCard.getByText('80%')).toHaveClass(
      'bg-sky-500/10',
      'text-sky-700'
    )
    expect(
      summaryCard.getByRole('progressbar', { name: 'Quality pass rate' })
    ).toHaveClass('[&_[data-slot=progress-indicator]]:bg-emerald-500')
    expect(
      summaryCard.getByRole('progressbar', { name: 'HTTP success rate' })
    ).toHaveClass('[&_[data-slot=progress-indicator]]:bg-sky-500')
    for (const label of ['≥95%', '≥80%', '≥60%', '≥40%', '<40%']) {
      expect(summaryCard.getByText(label)).toBeInTheDocument()
    }

    await userEvent.click(screen.getByRole('tab', { name: 'Active clients' }))
    const steady = (await screen.findByText('steady')).closest(
      '[data-slot="card"]'
    )
    const weak = screen.getByText('weak').closest('[data-slot="card"]')
    expect(steady).not.toBeNull()
    expect(weak).not.toBeNull()
    const steadyCard = within(steady as HTMLElement)
    const weakCard = within(weak as HTMLElement)
    expect(steadyCard.getByText('60%')).toHaveClass(
      'bg-amber-500/10',
      'text-amber-800'
    )
    expect(steadyCard.getByText('40%')).toHaveClass(
      'bg-orange-500/12',
      'text-orange-700'
    )
    expect(weakCard.getByText('20%')).toHaveClass(
      'bg-rose-500/10',
      'text-rose-700'
    )
    expect(weakCard.getByText('0%')).toHaveClass(
      'bg-rose-500/10',
      'text-rose-700'
    )
    expect(steadyCard.queryByText('≥95%')).not.toBeInTheDocument()
    expect(
      steadyCard.getByRole('progressbar', { name: 'Quality pass rate' })
    ).toHaveClass(
      '[&_[data-slot=progress-indicator]]:bg-amber-500',
      '[&_[data-slot=progress-track]]:bg-muted'
    )
  })
  it('does not invent percentages for missing or inconsistent counts', () => {
    expect(auditRate(1, 0)).toBeNull()
    expect(auditRate(null, 10)).toBeNull()
    expect(auditRate(11, 10)).toBeNull()
    expect(auditRate(0, 10)).toBe(0)
  })
})
