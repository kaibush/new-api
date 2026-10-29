import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import '@/features/profile/components/checkin-calendar-card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommunityBoard } from '../community-board'
import { CommunityCheckin } from '../community-checkin'
import type { CommunityEvent } from '../event-api'
import { EventTiming } from '../event-card'
import { EventCreate } from '../event-create'
import { EventDetail } from '../event-detail'
import { useRedPackets } from '../use-red-packets'

const event: CommunityEvent = {
  id: 80,
  user_id: 2,
  name: 'Admin',
  title: 'Community evening',
  description: 'Meet in the chat',
  kind: 'event',
  starts_at: 1893492000,
  ends_at: 1893495600,
  created_at: 1893488400,
  cancelled: false,
}
let events: CommunityEvent[]
let checkinEnabled: boolean
let checked: boolean
let allowed: boolean
const clients: QueryClient[] = []

function show(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
}

function BoardHarness(props: {
  onOpenEvent: (id: number) => void
  onCreateEvent: () => void
}) {
  const packets = useRedPackets([])
  return (
    <CommunityBoard
      packetMessages={[]}
      packets={packets}
      onOpen={() => {}}
      onCreate={() => {}}
      {...props}
    />
  )
}

beforeEach(() => {
  localStorage.clear()
  checked = false
  allowed = true
  checkinEnabled = true
  events = [{ ...event }]
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Alice', role: 1 } },
  }))
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = {}
    if (url === '/api/status') data = { checkin_enabled: checkinEnabled }
    else if (url === '/api/community/events') data = events
    else if (url === '/api/community/events/80') data = events[0]
    else if (url === '/api/community/red-packets') data = []
    else if (url.startsWith('/api/user/checkin')) {
      data = {
        enabled: true,
        eligibility: {
          allowed,
          limited: false,
          mode: 1,
          today: '2030-01-01',
          reasons: [],
          min_quota: 100,
          max_quota: 100,
          base_min_quota: 100,
          base_max_quota: 100,
          activity_percent: 100,
          reward_percent: 100,
          reward_numerator: 1,
          reward_denominator: 1,
          monthly_remaining: 1000,
          monthly_cap: 1000,
          monthly_awarded: 0,
          history_complete: true,
          recent_spend: 0,
          minimum_spend: 0,
          spending_gap: 0,
          activity_days: 30,
          grace_remaining_days: 0,
          pending_count: 0,
        },
        stats: {
          checked_in_today: checked,
          total_checkins: checked ? 1 : 0,
          total_quota: checked ? 100 : 0,
          checkin_count: checked ? 1 : 0,
          records: checked
            ? [{ checkin_date: '2030-01-01', quota_awarded: 100 }]
            : [],
        },
      }
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/checkin') {
      checked = true
      return { data: { success: true, data: { quota_awarded: 100 } } }
    }
    return { data: { success: true, data: event } }
  })
  vi.spyOn(api, 'delete').mockImplementation(async () => {
    events = [{ ...event, cancelled: true }]
    return { data: { success: true } }
  })
})
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('members can expand event previews and open details without publication controls', async () => {
  const user = userEvent.setup()
  events = Array.from({ length: 4 }, (_, i) => ({
    ...event,
    id: 80 + i,
    title: `Event ${i + 1}`,
  }))
  const open = vi.fn()
  show(<BoardHarness onOpenEvent={open} onCreateEvent={vi.fn()} />)
  const section = screen.getByRole('region', { name: 'Upcoming events' })
  await within(section).findByRole('button', { name: /Event 1/ })
  expect(
    within(section).queryByRole('button', { name: /Event 4/ })
  ).not.toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Show more' }))
  await user.click(within(section).getByRole('button', { name: /Event 4/ }))
  expect(open).toHaveBeenCalledWith(83)
  expect(
    screen.queryByRole('button', { name: 'Publish event' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Send a red packet' })
  ).not.toBeInTheDocument()
})

test('administrators can publish from an empty event board', async () => {
  events = []
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Admin', role: 10 } },
  }))
  const create = vi.fn()
  show(<BoardHarness onOpenEvent={vi.fn()} onCreateEvent={create} />)
  expect(
    await screen.findByText(
      'No upcoming events. New announcements will appear here.'
    )
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(create).toHaveBeenCalledOnce()
})

test('event publication validates required fields and preserves edits after a failed request', async () => {
  const user = userEvent.setup()
  const created = vi.fn()
  show(<EventCreate onClose={vi.fn()} onCreated={created} />)
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter a title, an event type, and a future time range'
  )
  expect(api.post).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Event title'), 'Evening gifts')
  await user.selectOptions(screen.getByLabelText('Event type'), 'red_packet')
  expect(
    screen.getByText(
      'This is a preview. An administrator sends the red packet when the event starts.'
    )
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Starts at · Time')).toHaveAttribute(
    'type',
    'time'
  )
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Unavailable'))
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Publish event' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Event title')).toHaveValue('Evening gifts')
  expect(created).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await waitFor(() => expect(created).toHaveBeenCalledWith(event))
  expect(api.post).toHaveBeenLastCalledWith(
    '/api/community/events',
    expect.objectContaining({
      title: 'Evening gifts',
      kind: 'red_packet',
      starts_at: expect.any(Number),
      ends_at: expect.any(Number),
    })
  )
})

test('clearing an event date prevents publication', async () => {
  show(<EventCreate onClose={vi.fn()} onCreated={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Event title'), {
    target: { value: 'Evening gifts' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clear · Ends at' }))
  fireEvent.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('event countdown moves from upcoming to live and ended, while cancellation takes precedence', () => {
  vi.useFakeTimers()
  vi.setSystemTime(event.starts_at * 1000 - 1000)
  const view = render(<EventTiming event={event} />)
  expect(screen.getByText('Upcoming')).toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByText('Live now')).toBeInTheDocument()
  act(() => {
    vi.setSystemTime(event.ends_at * 1000)
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByText('Ended')).toBeInTheDocument()
  view.rerender(<EventTiming event={{ ...event, cancelled: true }} />)
  expect(screen.getByText('Cancelled')).toBeInTheDocument()
  expect(screen.queryByText('Ended')).not.toBeInTheDocument()
})

test('cancelling an event requires confirmation and refreshes its detail', async () => {
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Admin', role: 10 } },
  }))
  const user = userEvent.setup()
  show(<EventDetail id={80} onClose={vi.fn()} onLocate={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'Cancel event' }))
  expect(api.delete).not.toHaveBeenCalled()
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel event',
    })
  )
  expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  expect(api.delete).toHaveBeenCalledWith('/api/community/events/80')
  expect(
    screen.queryByRole('button', { name: 'Cancel event' })
  ).not.toBeInTheDocument()
})

test('check-in from the board reuses reward confirmation and immediately refreshes the entry after claiming', async () => {
  const user = userEvent.setup()
  show(<CommunityCheckin />)
  await user.click(await screen.findByRole('button', { name: 'Open check-in' }))
  const dialog = await screen.findByRole('dialog', { name: 'Daily Check-in' })
  await user.click(
    await within(dialog).findByRole('button', { name: 'Check in now' })
  )
  expect(api.post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Claim this reward' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
  )
  await user.keyboard('{Escape}')
  expect(
    await screen.findByRole('button', { name: 'View check-in records' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Open check-in' })
  ).not.toBeInTheDocument()
})

test('a restricted check-in exposes the existing explanation and cannot claim', async () => {
  allowed = false
  const user = userEvent.setup()
  show(<CommunityCheckin />)
  await user.click(
    await screen.findByRole('button', { name: 'Check-in reward details' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Daily Check-in' })
  await user.click(
    await within(dialog).findByRole('button', {
      name: 'Check-in reward details',
    })
  )
  expect(
    screen.getByRole('button', { name: 'Claim this reward' })
  ).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

test('disabled check-in hides the entry without requesting reward data', async () => {
  checkinEnabled = false
  const view = show(<CommunityCheckin />)
  await waitFor(() => expect(view.container).toBeEmptyDOMElement())
  expect(
    vi
      .mocked(api.get)
      .mock.calls.some(([url]) => url.startsWith('/api/user/checkin'))
  ).toBe(false)
})

test('check-in status failure offers retry without enabling a claim', async () => {
  const user = userEvent.setup()
  const get = vi.mocked(api.get).getMockImplementation()
  if (!get) throw new Error('API fixture missing')
  let failed = true
  vi.mocked(api.get).mockImplementation(async (...args) => {
    if (args[0].startsWith('/api/user/checkin') && failed) {
      throw new Error('Unavailable')
    }
    return get(...args)
  })
  show(<CommunityCheckin />)
  const retry = await screen.findByRole('button', { name: /Retry/ })
  expect(
    screen.queryByRole('button', { name: 'Open check-in' })
  ).not.toBeInTheDocument()
  failed = false
  await user.click(retry)
  expect(
    await screen.findByRole('button', { name: 'Open check-in' })
  ).toBeEnabled()
})
