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
      announcements: [
        info,
        { ...info, id: 4, type: 'success' },
        { ...info, id: 5, type: 'ongoing' },
      ],
    },
  ])(
    'does not open a reminder for disabled or noncritical announcements: %j',
    (status) => {
      client.setQueryData(['status'], status)
      renderNotifications()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

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

  it('shows a newly published or edited warning after earlier reminders are dismissed by keyboard', async () => {
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
    expect(within(dialog).queryByText(error.content)).not.toBeInTheDocument()
  })
})
