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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { NotificationPopover } from '@/components/notification-popover'
import { useNotifications } from '@/hooks/use-notifications'
import { useNotificationStore } from '@/stores/notification-store'

function Notifications() {
  const notifications = useNotifications()
  return (
    <NotificationPopover
      open={notifications.popoverOpen}
      onOpenChange={notifications.setPopoverOpen}
      unreadCount={notifications.unreadCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      notice={notifications.notice}
      announcements={notifications.announcements}
      loading={notifications.loading}
      importantAnnouncements={notifications.importantAnnouncements}
      onDismissImportantAnnouncements={
        notifications.dismissImportantAnnouncements
      }
    />
  )
}

const warning = {
  id: 1,
  type: 'warning',
  content: 'Scheduled maintenance',
  extra: 'Save your work',
}
const error = { id: 2, type: 'error', content: 'Service unavailable' }
const info = { id: 3, type: 'default', content: 'Welcome aboard' }
let client: QueryClient

function renderNotifications() {
  return render(
    <QueryClientProvider client={client}>
      <Notifications />
    </QueryClientProvider>
  )
}

function expectTimelineOrder(dialog: HTMLElement, contents: string[]) {
  const nodes = contents.map((content) => within(dialog).getByText(content))
  for (let index = 0; index < nodes.length - 1; index += 1) {
    expect(
      nodes[index].compareDocumentPosition(nodes[index + 1]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
  }
}

const originalGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalGetAnimations
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

beforeEach(() => {
  localStorage.clear()
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['notice'], { success: true, data: '' })
  client.setQueryData(['status'], {
    announcements_enabled: true,
    announcements: [warning, error, info],
  })
})

afterEach(() => {
  client.clear()
  localStorage.clear()
})

describe('important announcement reminders', () => {
  it('automatically shows unread warnings and errors when entering the system', async () => {
    renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expect(within(dialog).getByText(warning.content)).toBeVisible()
    expect(within(dialog).getByText(warning.extra)).toBeVisible()
    expect(within(dialog).getByText(error.content)).toBeVisible()
    expect(within(dialog).queryByText(info.content)).not.toBeInTheDocument()
  })

  it.each([
    { announcements_enabled: false, announcements: [warning] },
    { announcements_enabled: true, announcements: [] },
    {
      announcements_enabled: true,
      announcements: [info, { ...info, id: 4, content: 'Another note' }],
    },
  ])(
    'does not open a reminder for disabled or noncritical announcements: %j',
    (status) => {
      client.setQueryData(['status'], status)
      renderNotifications()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it.each(['ongoing', 'success'] as const)(
    'opens a reminder for an unread %s announcement and hides default notices',
    async (type) => {
      client.setQueryData(['status'], {
        announcements_enabled: true,
        announcements: [info, { id: 8, type, content: `${type} announcement` }],
      })
      renderNotifications()
      const dialog = await screen.findByRole('dialog', {
        name: 'System Announcements',
      })
      expect(within(dialog).getByText(`${type} announcement`)).toBeVisible()
      expect(within(dialog).queryByText(info.content)).not.toBeInTheDocument()
    }
  )

  it('shows earlier non-default announcements with the newest one, newest first', async () => {
    const user = userEvent.setup()
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [
        {
          id: 11,
          type: 'error',
          content: 'Service outage',
          publishDate: '2026-10-13T10:00:00Z',
        },
      ],
    })
    renderNotifications()
    const firstDialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    await user.click(within(firstDialog).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )

    act(() =>
      client.setQueryData(['status'], {
        announcements_enabled: true,
        announcements: [
          {
            id: 11,
            type: 'error',
            content: 'Service outage',
            publishDate: '2026-10-13T10:00:00Z',
          },
          {
            id: 12,
            type: 'default',
            content: 'Routine note',
            publishDate: '2026-10-13T16:00:00Z',
          },
          {
            id: 13,
            type: 'success',
            content: 'Service recovered',
            publishDate: '2026-10-13T15:20:00Z',
          },
        ],
      })
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    const recovered = within(dialog).getByText('Service recovered')
    const outage = within(dialog).getByText('Service outage')
    expect(recovered).toBeVisible()
    expect(outage).toBeVisible()
    expect(within(dialog).queryByText('Routine note')).not.toBeInTheDocument()
    expectTimelineOrder(dialog, ['Service recovered', 'Service outage'])

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Notifications' })
    ).toHaveTextContent('1')
  })

  it('keeps every unread announcement and only three recent read announcements', async () => {
    const user = userEvent.setup()
    const history = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      type: 'error',
      content: `Incident ${index + 1}`,
      publishDate: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: history,
    })
    renderNotifications()
    const firstDialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    for (const item of history) {
      expect(within(firstDialog).getByText(item.content)).toBeVisible()
    }
    await user.click(within(firstDialog).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )

    act(() =>
      client.setQueryData(['status'], {
        announcements_enabled: true,
        announcements: [
          ...history,
          {
            id: 20,
            type: 'default',
            content: 'Routine note',
            publishDate: '2026-10-13T12:00:00Z',
          },
          {
            id: 21,
            type: 'success',
            content: 'Service recovered',
            publishDate: '2026-10-13T15:20:00Z',
          },
        ],
      })
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expectTimelineOrder(dialog, [
      'Service recovered',
      'Incident 5',
      'Incident 4',
      'Incident 3',
    ])
    expect(within(dialog).queryByText('Incident 2')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Incident 1')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Routine note')).not.toBeInTheDocument()
  })

  it('keeps announcements with the same publish time in their incoming order', async () => {
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [
        {
          id: 1,
          type: 'warning',
          content: 'Same time first',
          publishDate: '2026-10-13T15:20:00Z',
        },
        {
          id: 2,
          type: 'error',
          content: 'Same time second',
          publishDate: '2026-10-13T15:20:00Z',
        },
        {
          id: 3,
          type: 'success',
          content: 'Newer notice',
          publishDate: '2026-10-14T00:00:00Z',
        },
      ],
    })
    renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expectTimelineOrder(dialog, [
      'Newer notice',
      'Same time first',
      'Same time second',
    ])
  })

  it('does not move an undated announcement behind dated announcements', async () => {
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [
        {
          id: 1,
          type: 'success',
          content: 'Undated recovery',
          publishDate: 'not-a-date',
        },
        {
          id: 2,
          type: 'error',
          content: 'Dated outage',
          publishDate: '2026-10-01T00:00:00Z',
        },
      ],
    })
    renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expectTimelineOrder(dialog, ['Undated recovery', 'Dated outage'])
  })

  it('scrolls a long unread announcement timeline', async () => {
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        type: 'warning',
        content: `Maintenance ${index + 1}`,
        publishDate: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      })),
    })
    renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    const timeline = within(dialog).getByRole('list')
    expect(timeline.parentElement).toHaveAttribute(
      'data-slot',
      'announcement-timeline'
    )
    expect(timeline.parentElement).toHaveClass(
      'max-h-[min(52vh,28rem)]',
      'overflow-y-auto'
    )
    expect(within(dialog).getByText('Maintenance 6')).toBeVisible()
    expectTimelineOrder(dialog, ['Maintenance 12', 'Maintenance 1'])
  })

  it('keeps the notification timeline list separate from the popup', async () => {
    const user = userEvent.setup()
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [
        info,
        {
          ...info,
          id: 4,
          content: 'Second note',
          publishDate: '2026-10-13T00:00:00Z',
        },
      ],
    })
    renderNotifications()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    await user.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByText(info.content)).toBeVisible()
    expect(screen.getByText('Second note')).toBeVisible()
    expect(screen.getByText(/2026-10-13 00:00:00/)).toBeVisible()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows important announcements when status arrives after the initial render', async () => {
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [],
    })
    renderNotifications()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() =>
      client.setQueryData(['status'], {
        announcements_enabled: true,
        announcements: [warning],
      })
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expect(within(dialog).getByText(warning.content)).toBeVisible()
  })

  it('does not miss important announcements after the first twenty ordinary entries', async () => {
    client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [
        ...Array.from({ length: 20 }, (_, index) => ({
          ...info,
          id: index + 10,
        })),
        warning,
      ],
    })
    renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expect(within(dialog).getByText(warning.content)).toBeVisible()
  })

  it('persists dismissed reminders across visits while leaving ordinary announcements unread', async () => {
    const user = userEvent.setup()
    const view = renderNotifications()
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Notifications' })
    ).toHaveTextContent('1')
    view.unmount()
    await act(async () => {
      await useNotificationStore.persist.rehydrate()
    })
    renderNotifications()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an edited warning together with earlier announcements after keyboard dismiss', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByRole('dialog', { name: 'System Announcements' })
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    act(() =>
      client.setQueryData(['status'], {
        announcements_enabled: true,
        announcements: [{ ...warning, content: 'Maintenance extended' }, error],
      })
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'System Announcements',
    })
    expect(within(dialog).getByText('Maintenance extended')).toBeVisible()
    expect(within(dialog).getByText(error.content)).toBeVisible()
    expect(within(dialog).queryByText(info.content)).not.toBeInTheDocument()
  })
})
