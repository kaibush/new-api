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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { InputAuditViewer } from '..'
import { AuditLogs } from '../../audit'

const settings = {
  enabled: false,
  retention_days: 7,
  max_records: 20000,
  max_chars: 2048,
}
const entry = {
  id: 1,
  user_id: 4,
  username: 'alice',
  created_at: 1700000000,
  model: 'model-a',
  token_id: 5,
  request_id: 'request-a',
  route: '/v1/chat/completions',
  ip: '192.0.2.8',
  content: 'beginning<script>secret</script>…ending',
  content_hash: 'full-text-hash',
  content_chars: 9000,
  truncated: true,
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/input-audit/status') {
      return {
        data: {
          success: true,
          data: { settings, pending: 0, dropped: 2, write_failures: 0 },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          items: url === '/api/input-audit' ? [entry] : [],
          total: url === '/api/input-audit' ? 41 : 0,
        },
      },
    }
  })
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
})

it.each([1, 10])('role %i cannot open user message audits', (role) => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
  render(
    <QueryClientProvider client={client}>
      <AuditLogs />
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('tab', { name: 'Input Audits' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith(
    '/api/input-audit',
    expect.anything()
  )
})

it('root opens message audits on demand and sees safe text, first receive time and truncation details', async () => {
  render(
    <QueryClientProvider client={client}>
      <AuditLogs />
    </QueryClientProvider>
  )
  expect(api.get).not.toHaveBeenCalledWith(
    '/api/input-audit',
    expect.anything()
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Input Audits' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
  expect(within(dialog).getByText(entry.content)).toBeVisible()
  expect(dialog.querySelector('script')).toBeNull()
  expect(
    within(dialog).getByText(
      'Long messages retain the beginning and end; the middle is omitted.'
    )
  ).toBeVisible()
  expect(within(dialog).getByText('9,000')).toBeVisible()
  expect(within(dialog).getByText('full-text-hash')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('invalid user IDs are rejected and valid user filters reset pagination', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '-1' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByText('Invalid audit filters')).toBeVisible()
  expect(api.get).not.toHaveBeenCalledWith('/api/input-audit', {
    params: expect.objectContaining({ user_id: -1 }),
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '4' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({ user_id: 4, p: 1 }),
    })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByRole('textbox', { name: 'User ID' })).toHaveValue('')
})

it('next page requests server pagination while keeping the user filter', async () => {
  render(
    <QueryClientProvider client={client}>
      <AuditLogs />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Input Audits' }))
  await screen.findByText('alice (#4)')
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '4' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({ user_id: 4, p: 1 }),
    })
  )
  const next = await screen.findByRole('button', { name: 'Go to next page' })
  await waitFor(() => expect(next).toBeEnabled())
  await userEvent.click(next)
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({ user_id: 4, p: 2, page_size: 20 }),
    })
  )
})

it('settings remain open after a rejected save and close after a successful retry', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Database unavailable' },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Input audit settings' })
  fireEvent.change(
    within(dialog).getByRole('spinbutton', { name: 'Stored characters' }),
    { target: { value: '4096' } }
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(dialog).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(put).toHaveBeenLastCalledWith('/api/input-audit/settings', {
    ...settings,
    max_chars: 4096,
  })
})

it('out-of-range storage settings show validation without sending an update', async () => {
  const put = vi.spyOn(api, 'put')
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Input audit settings' })
  fireEvent.change(
    within(dialog).getByRole('spinbutton', { name: 'Stored characters' }),
    { target: { value: '1' } }
  )
  // Submit directly so schema validation is verified independently of native HTML bounds.
  fireEvent.submit(
    within(dialog).getByRole('form', { name: 'Input audit settings' })
  )
  expect(
    await within(dialog).findByText(
      'Please enter an integer between 256 and 8192'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

it('failed queries show an error and retry can restore the records', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('alice (#4)')).toBeVisible()
})

it('search with unchanged filters refreshes newly captured messages', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  const before = vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => url === '/api/input-audit').length
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(
      vi
        .mocked(api.get)
        .mock.calls.filter(([url]) => url === '/api/input-audit').length
    ).toBeGreaterThan(before)
  )
})
