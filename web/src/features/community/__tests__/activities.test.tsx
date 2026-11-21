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
import type { CommunityEvent, CommunityEventInput } from '../event-api'
import { EventTiming } from '../event-card'
import { EventDetail } from '../event-detail'
import { EventForm } from '../event-form'
import { communityEventFormSchema } from '../lib/event-form'
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
  show(<EventForm onClose={vi.fn()} onSaved={created} />)
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
  show(<EventForm onClose={vi.fn()} onSaved={vi.fn()} />)
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

test('administrators can edit a published event and refresh its board and detail', async () => {
  vi.spyOn(Date, 'now').mockReturnValue((event.starts_at - 3600) * 1000)
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Admin', role: 10 } },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, input) => {
    events = [{ ...event, ...(input as CommunityEventInput) }]
    return { data: { success: true, data: events[0] } }
  })
  const user = userEvent.setup()
  show(
    <>
      <BoardHarness onOpenEvent={vi.fn()} onCreateEvent={vi.fn()} />
      <EventDetail id={80} onClose={vi.fn()} onLocate={vi.fn()} />
    </>
  )
  await user.click(await screen.findByRole('button', { name: 'Edit event' }))
  const form = screen.getByRole('dialog', { name: 'Edit event' })
  expect(within(form).getByLabelText('Event title')).toHaveValue(event.title)
  expect(within(form).getByLabelText('Event details')).toHaveValue(
    event.description
  )
  await user.clear(within(form).getByLabelText('Event title'))
  await user.type(within(form).getByLabelText('Event title'), 'Updated evening')
  await user.clear(within(form).getByLabelText('Event details'))
  await user.selectOptions(
    within(form).getByLabelText('Event type'),
    'red_packet'
  )
  const startsAt = new Date((event.starts_at + 1800) * 1000)
  const endsAt = new Date((event.ends_at + 1800) * 1000)
  fireEvent.change(within(form).getByLabelText('Starts at · Time'), {
    target: { value: startsAt.toTimeString().slice(0, 5) },
  })
  fireEvent.change(within(form).getByLabelText('Ends at · Time'), {
    target: { value: endsAt.toTimeString().slice(0, 5) },
  })
  await user.click(within(form).getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('dialog', { name: 'Event details' })
  expect(put).toHaveBeenCalledWith('/api/community/events/80', {
    title: 'Updated evening',
    description: '',
    kind: 'red_packet',
    starts_at: event.starts_at + 1800,
    ends_at: event.ends_at + 1800,
  })
  expect(api.post).not.toHaveBeenCalled()
  expect(
    await screen.findByRole('heading', { name: 'Updated evening' })
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: /Updated evening/, hidden: true })
  ).toBeInTheDocument()
})

test('saving an event preserves the draft on server failure and blocks duplicate submissions while pending', async () => {
  vi.spyOn(Date, 'now').mockReturnValue((event.starts_at - 3600) * 1000)
  const user = userEvent.setup()
  const saved = vi.fn()
  const close = vi.fn()
  const put = vi.spyOn(api, 'put').mockResolvedValueOnce({
    data: { success: false, message: 'Event is unavailable' },
  })
  show(<EventForm event={event} onClose={close} onSaved={saved} />)
  await user.clear(screen.getByLabelText('Event title'))
  await user.type(screen.getByLabelText('Event title'), 'My revised event')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Event title')).toHaveValue('My revised event')
  expect(saved).not.toHaveBeenCalled()
  let complete:
    | ((response: { data: { success: boolean; data: CommunityEvent } }) => void)
    | undefined
  put.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByLabelText('Event title')).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(close).not.toHaveBeenCalled()
  const updated = { ...event, title: 'My revised event' }
  await act(async () => complete?.({ data: { success: true, data: updated } }))
  await waitFor(() => expect(saved).toHaveBeenCalledWith(updated))
})

test('editing an ongoing event retains its past start and allows saving changed details', async () => {
  vi.spyOn(Date, 'now').mockReturnValue((event.starts_at + 1800) * 1000)
  const user = userEvent.setup()
  const saved = vi.fn()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: event } })
  show(<EventForm event={event} onClose={vi.fn()} onSaved={saved} />)
  expect(screen.getByRole('button', { name: 'Starts at' })).toBeDisabled()
  expect(screen.getByLabelText('Starts at · Time')).toBeDisabled()
  await user.type(screen.getByLabelText('Event details'), ' — Updated agenda')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(saved).toHaveBeenCalledWith(event))
  expect(put).toHaveBeenCalledWith(
    '/api/community/events/80',
    expect.objectContaining({
      starts_at: event.starts_at,
      description: 'Meet in the chat — Updated agenda',
    })
  )
})

test('event publication accepts start and end dates several years in the future', () => {
  vi.spyOn(Date, 'now').mockReturnValue(
    new Date('2026-11-16T00:00:00Z').getTime()
  )
  const values = {
    title: 'Long-term community event',
    description: 'Community announcements',
    kind: 'event',
    starts_at: new Date('2030-01-01T11:00:00Z'),
    ends_at: new Date('2040-12-31T12:00:00Z'),
  }
  expect(communityEventFormSchema().parse(values)).toEqual(values)
})

test.each([
  ['2026-11-09T11:00:00Z', '2027-12-31T12:00:00Z'],
  ['2030-01-01T11:00:00Z', '2040-12-31T12:00:00Z'],
])(
  'editing an event starting at %s saves details with an end date beyond a year',
  async (startsAt, endsAt) => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-11-16T00:00:00Z').getTime()
    )
    const longEvent = {
      ...event,
      starts_at: new Date(startsAt).getTime() / 1000,
      ends_at: new Date(endsAt).getTime() / 1000,
    }
    const saved = vi.fn()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, data: longEvent },
    })
    show(<EventForm event={longEvent} onClose={vi.fn()} onSaved={saved} />)
    fireEvent.change(screen.getByLabelText('Event details'), {
      target: { value: 'Updated community announcement' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith(longEvent))
    expect(put).toHaveBeenCalledWith('/api/community/events/80', {
      title: longEvent.title,
      description: 'Updated community announcement',
      kind: longEvent.kind,
      starts_at: longEvent.starts_at,
      ends_at: longEvent.ends_at,
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

test('invalid event edits cannot be saved and cancelling the draft restores the original detail', async () => {
  vi.spyOn(Date, 'now').mockReturnValue((event.starts_at - 3600) * 1000)
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Admin', role: 10 } },
  }))
  const put = vi.spyOn(api, 'put')
  const user = userEvent.setup()
  show(<EventDetail id={80} onClose={vi.fn()} onLocate={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'Edit event' }))
  await user.clear(screen.getByLabelText('Event title'))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter a title, an event type, and a valid time range'
  )
  expect(screen.getByLabelText('Event title')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  await user.type(screen.getByLabelText('Event title'), 'Revised')
  await user.click(screen.getByRole('button', { name: 'Clear · Ends at' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    await screen.findByRole('heading', { name: event.title })
  ).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
})

test.each(['member', 'cancelled', 'ended'])(
  '%s events do not expose editing controls',
  async (state) => {
    vi.spyOn(Date, 'now').mockReturnValue((event.starts_at - 3600) * 1000)
    if (state !== 'member') {
      useAuthStore.setState((current) => ({
        auth: { ...current.auth, user: { id: 1, username: 'Admin', role: 10 } },
      }))
    }
    if (state === 'cancelled') events[0].cancelled = true
    if (state === 'ended') {
      vi.mocked(Date.now).mockReturnValue(event.ends_at * 1000)
    }
    show(<EventDetail id={80} onClose={vi.fn()} onLocate={vi.fn()} />)
    await screen.findByRole('heading', { name: event.title })
    expect(
      screen.queryByRole('button', { name: 'Edit event' })
    ).not.toBeInTheDocument()
  }
)

test('the check-in dialog separates sections and shows its title once', async () => {
  const user = userEvent.setup()
  show(<CommunityCheckin />)
  await user.click(await screen.findByRole('button', { name: 'Open check-in' }))
  const dialog = await screen.findByRole('dialog', { name: 'Daily Check-in' })
  await within(dialog).findByRole('button', { name: 'Check in now' })
  expect(within(dialog).getAllByText('Daily Check-in')).toHaveLength(1)
  const content = within(dialog).getByRole('region', {
    name: 'Check-in reward details',
  })
  expect(content).toHaveClass('flex', 'flex-col', 'gap-4')
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

test('the full leaderboard opens from check-in and switches between today and recent totals', async () => {
  const get = vi.mocked(api.get).getMockImplementation()
  if (!get) throw new Error('Expected the default API fixture')
  vi.mocked(api.get).mockImplementation(async (url, options) => {
    if (url !== '/api/user/checkin/leaderboard') return get(url, options)
    return {
      data: {
        success: true,
        data: {
          enabled: true,
          today: '2030-01-01',
          timezone: 'Asia/Shanghai',
          retention_days: 7,
          my_rank: 12,
          my_quota: 1000000,
          surpassed_bps: 6000,
          top: [
            {
              rank: 1,
              username: 'a***b',
              display_name: 'Winner',
              quota_awarded: 5000000,
              tier_name: 'Lucky',
              checkin_date: '2030-01-01',
            },
          ],
          recent_highlights: [],
          recent_totals: [
            {
              rank: 1,
              username: 'c***d',
              display_name: 'Weekly winner',
              quota_awarded: 10000000,
              tier_name: '',
              checkin_date: '',
            },
          ],
        },
      },
    }
  })
  show(<CommunityCheckin />)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'View full leaderboard' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Check-in leaderboard',
  })
  await within(dialog).findByText('#12')
  await user.click(
    within(dialog).getByRole('tab', { name: 'Recent total rewards' })
  )
  expect(within(dialog).getAllByText('Weekly winner')).toHaveLength(2)
  await user.click(within(dialog).getByRole('tab', { name: 'Recent jackpots' }))
  expect(await within(dialog).findByText('No check-ins yet')).toBeVisible()
})

test('hiding jackpots while open falls back to actual today entries', async () => {
  const get = vi.mocked(api.get).getMockImplementation()
  if (!get) throw new Error('Expected the default API fixture')
  let highlightsEnabled = true
  vi.mocked(api.get).mockImplementation(async (url, options) => {
    if (url !== '/api/user/checkin/leaderboard') return get(url, options)
    return {
      data: {
        success: true,
        data: {
          enabled: true,
          today: '2030-01-01',
          timezone: 'UTC',
          top: [
            {
              rank: 1,
              display_name: 'Today winner',
              username: 'winner',
              quota_awarded: 100,
            },
          ],
          ...(highlightsEnabled ? { recent_highlights: [] } : {}),
        },
      },
    }
  })
  show(<CommunityCheckin />)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'View full leaderboard' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Check-in leaderboard',
  })
  await user.click(
    await within(dialog).findByRole('tab', { name: 'Recent jackpots' })
  )
  highlightsEnabled = false
  await user.click(within(dialog).getByRole('button', { name: 'Refresh' }))
  await waitFor(() =>
    expect(
      within(dialog).queryByRole('tab', { name: 'Recent jackpots' })
    ).not.toBeInTheDocument()
  )
  expect(
    within(dialog).getByRole('tab', { name: 'Today’s lucky winners' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(within(dialog).queryAllByText('Today winner')).toHaveLength(2)
})
