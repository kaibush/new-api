import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { useSidebarData } from '@/hooks/use-sidebar-data'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TicketsPage } from '..'
import type { TicketSettings } from '../api'
import { TicketSettingsForm } from '../settings'

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

function Inbox() {
  const [selected, onSelect] = useState<number>()
  const item = useSidebarData()
    .navGroups.flatMap((group) => group.items)
    .find((link) => 'url' in link && link.url === '/tickets')
  return (
    <>
      <nav>{item?.title}</nav>
      <TicketsPage selected={selected} onSelect={onSelect} />
    </>
  )
}

it('publishes the switch and menu name to the sidebar and page, and hides both without losing the name', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['community-status'], { enabled: false })
  client.setQueryData(['ticket-settings'], { enabled: false, name: '' })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [], total: 0, has_more: false } },
  })
  const save = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_url, data) => ({
      data: { success: true, data },
    }))
  const view = render(
    <QueryClientProvider client={client}>
      <TicketSettingsForm inline />
      <Inbox />
    </QueryClientProvider>
  )
  expect(screen.getByRole('navigation')).toBeEmptyDOMElement()
  expect(screen.getByText('Support tickets are disabled.')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('switch', { name: 'Enable support tickets' })
  )
  fireEvent.change(screen.getByLabelText('Ticket menu name'), {
    target: { value: '帮助台' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(save).toHaveBeenCalledWith('/api/tickets/settings', {
    enabled: true,
    name: '帮助台',
  } satisfies TicketSettings)
  expect(
    await screen.findByRole('heading', { name: '帮助台' })
  ).toBeInTheDocument()
  expect(screen.getByRole('navigation')).toHaveTextContent('帮助台')
  expect(await screen.findByText('No tickets yet')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Ticket menu name'), {
    target: { value: '' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.getByRole('navigation')).toHaveTextContent('Support tickets')
  )
  await user.click(
    screen.getByRole('switch', { name: 'Enable support tickets' })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText('Support tickets are disabled.')
  ).toBeInTheDocument()
  expect(screen.getByRole('navigation')).toBeEmptyDOMElement()
  view.unmount()
  client.clear()
})

it('opens a private ticket, shows replies and prevents replies after closure', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['community-status'], { enabled: false })
  client.setQueryData(['ticket-settings'], { enabled: true, name: '' })
  useAuthStore
    .getState()
    .auth.setUser({ id: 9, username: 'requester', role: 1 })
  const ticket = {
    id: 21,
    title: 'Account question',
    user_id: 9,
    status: 'awaiting_user',
    updated_at: 100,
  }
  let opened = false
  const messages = [
    {
      id: 2,
      staff: true,
      author_id: 3,
      body: 'Please send details',
      created_at: 100,
    },
  ]
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/tickets/21'
          ? { ticket, messages: [...messages], has_more: false }
          : {
              items: opened ? [ticket] : [],
              total: Number(opened),
              has_more: false,
            },
    },
  }))
  const post = vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
    if (url === '/api/tickets') opened = true
    else {
      messages.unshift({
        id: 3,
        staff: false,
        author_id: 9,
        body: (data as { body: string }).body,
        created_at: 101,
      })
      ticket.status = 'closed'
    }
    return { data: { success: true, data: ticket } }
  })
  const view = render(
    <QueryClientProvider client={client}>
      <Inbox />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'New ticket' }))
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: ticket.title },
  })
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Initial details' },
  })
  await user.click(screen.getByRole('button', { name: 'Create ticket' }))
  expect(await screen.findByText('Please send details')).toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Ticket status' })
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), {
    target: { value: 'Follow-up' },
  })
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  expect(post).toHaveBeenCalledWith('/api/tickets/21/messages', {
    body: 'Follow-up',
  })
  expect(await screen.findByText('This ticket is closed.')).toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Reply' })
  ).not.toBeInTheDocument()
  view.unmount()
  client.clear()
})
