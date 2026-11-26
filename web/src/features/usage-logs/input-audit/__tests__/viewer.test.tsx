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

import { PageFooterProvider } from '@/components/layout/components/page-footer'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { InputAuditViewer } from '..'
import { AuditLogs } from '../../audit'
import type { InputAuditAllowlist } from '../api'
import { InputAuditDetailsDialog } from '../details-dialog'

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
  turn_key: 'turn-a',
  turn_item: 2,
  thread_id: 9,
  item_count: 4,
  new_items: 2,
  request_count: 1,
  first_at: 1700000000,
  last_at: 1700000000,
}
const transcript = {
  request: entry,
  turn_seq: 1,
  turn_requests: [entry],
  turn_request_count: 1,
  outline: [
    { seq: 1, text: 'Fix the login bug', requests: 1, created_at: 1700000000 },
  ],
  source: 'thread',
  thread: {
    id: 9,
    item_count: 4,
    parent_id: 0,
    truncated: false,
    context_missing: false,
    tools: ['shell'],
    request_count: 1,
    first_at: 1700000000,
    last_at: 1700000000,
  },
  offset: 0,
  total: 4,
  items: [
    {
      seq: 0,
      role: 'system',
      kind: 'message',
      text: 'You are a coding agent',
      original_chars: 22,
    },
    {
      seq: 1,
      role: 'user',
      kind: 'message',
      text: 'Fix the login bug',
      original_chars: 17,
      created_at: 1700000000,
    },
    {
      seq: 2,
      role: 'assistant',
      kind: 'tool_call',
      name: 'shell',
      text: '{"cmd":"cat login.go"}',
      original_chars: 22,
    },
    {
      seq: 3,
      role: 'tool',
      kind: 'tool_result',
      text: 'package login',
      original_chars: 13,
    },
  ],
  request_range: { start: 2, end: 4 },
}
let client: QueryClient

beforeEach(() => {
  settings.enabled = false
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (String(url).startsWith('/api/user/search')) {
      return {
        data: {
          success: true,
          data: { items: [{ id: 4, username: 'alice' }] },
        },
      }
    }
    if (url === '/api/input-audit/allowlist/history') {
      return { data: { success: true, data: [] } }
    }
    if (String(url).endsWith('/transcript')) {
      return { data: { success: true, data: transcript } }
    }
    if (String(url).endsWith('/transcript/search')) {
      return { data: { success: true, data: { seqs: [], more: false } } }
    }
    if (url === '/api/input-audit/allowlist') {
      return { data: { success: true, data: { version: 0, entries: [] } } }
    }
    if (url === '/api/task_plugin_options') {
      return {
        data: {
          success: true,
          data: [
            {
              key: 'request-filter',
              transform: true,
              supportsUserAllowlist: true,
            },
            {
              key: 'custom-policy',
              transform: true,
              supportsUserAllowlist: true,
            },
            { key: 'request-redact', transform: true },
          ],
        },
      }
    }
    if (url === '/api/request_plugin/instances') {
      return {
        data: {
          success: true,
          data: {
            instances: [
              {
                id: 'filter-one',
                name: 'Policy A',
                plugin: 'request-filter',
                enabled: true,
              },
              {
                id: 'policy-one',
                name: 'Context policy',
                plugin: 'custom-policy',
                enabled: true,
              },
              {
                id: 'redact',
                name: 'Redaction',
                plugin: 'request-redact',
                enabled: true,
              },
            ],
          },
        },
      }
    }
    if (url === '/api/input-audit/status') {
      return {
        data: {
          success: true,
          data: { settings, pending: 0, dropped: 2, write_failures: 0 },
        },
      }
    }
    const page = Number(config?.params?.p ?? 1)
    const pageEntry =
      page === 1 ? entry : { ...entry, id: page, username: `page-${page}-user` }
    return {
      data: {
        success: true,
        data: {
          items: url === '/api/input-audit' ? [pageEntry] : [],
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
  await userEvent.click(
    await within(dialog).findByRole('tab', { name: 'Request' })
  )
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

it('details open the whole conversation at the user message and mark what the request added', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditDetailsDialog entry={entry} />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
  const outline = await within(dialog).findByRole('navigation', {
    name: 'User messages in this conversation',
  })
  expect(
    within(outline).getByRole('button', { name: /Fix the login bug/ })
  ).toHaveAttribute('aria-current', 'true')
  expect(api.get).toHaveBeenCalledWith('/api/input-audit/1/transcript', {
    params: { offset: undefined, limit: 200 },
  })
  const conversation = within(dialog).getByRole('list', {
    name: 'Conversation',
  })
  expect(within(conversation).getByText('Added by this request')).toBeVisible()
  expect(
    within(conversation).getByText('Added by this request').closest('li')
      ?.nextElementSibling
  ).toHaveAttribute('data-seq', '2')
  expect(within(dialog).getByText(/Requests for this message: 1/)).toBeVisible()
  expect(within(dialog).getByText('Tools: shell')).toBeVisible()
})

it('switching requests of one message and jumping to an unloaded user message load the matching window', async () => {
  const retry = { ...entry, id: 2, created_at: 1700000060, new_items: 0 }
  vi.mocked(api.get).mockImplementation(async () => ({
    data: {
      success: true,
      data: {
        ...transcript,
        turn_requests: [retry, entry],
        turn_request_count: 2,
        outline: [
          ...transcript.outline,
          {
            seq: 450,
            text: 'Later instruction',
            requests: 3,
            created_at: 1700000600,
          },
        ],
        total: 600,
      },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <InputAuditDetailsDialog entry={entry} />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
  await userEvent.selectOptions(
    await within(dialog).findByRole('combobox', {
      name: 'Request for this message',
    }),
    '2'
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/2/transcript', {
      params: { offset: undefined, limit: 200 },
    })
  )
  await userEvent.click(
    within(
      within(dialog).getByRole('navigation', {
        name: 'User messages in this conversation',
      })
    ).getByRole('button', { name: /Later instruction/ })
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/2/transcript', {
      params: { offset: 440, limit: 200 },
    })
  )
})

it('list rows show what the agent did and highlight a searched keyword', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/input-audit'
          ? {
              items: [
                {
                  ...entry,
                  content: `${'x'.repeat(80)} drop the Users table`,
                  activity: {
                    tool_calls: 1000,
                    tools: ['shell', 'apply_patch'],
                    reply: 'Dropped the users table',
                    more: true,
                  },
                },
              ],
              total: 1,
            }
          : { items: [], total: 0 },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  expect(document.querySelector('mark')).toBeNull()
  expect(screen.getByText('Tool calls: 1,000+')).toBeVisible()
  expect(screen.getByText('apply_patch')).toBeVisible()
  expect(screen.getByText('Dropped the users table')).toBeVisible()
  const keyword = screen.getByRole('textbox', { name: 'Message keyword' })
  await userEvent.type(keyword, 'users{Enter}')
  const mark = await screen.findByText('Users', { selector: 'mark' })
  expect(mark.parentElement?.textContent).toMatch(/^…x+ drop the Users table$/)
  expect(mark.parentElement?.textContent?.length).toBeLessThan(60)
  expect(
    screen.getByText('users', { selector: 'mark' }).parentElement
  ).toHaveTextContent('Assistant: Dropped the users table')
})

it('details opened from a keyword search highlight matches and step through the whole conversation', async () => {
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (String(url).endsWith('/transcript/search')) {
      return {
        data: {
          success: true,
          data: {
            seqs: config?.params?.q === 'login' ? [1, 2, 3, 500] : [],
            more: false,
          },
        },
      }
    }
    return { data: { success: true, data: { ...transcript, total: 600 } } }
  })
  render(
    <QueryClientProvider client={client}>
      <InputAuditDetailsDialog entry={entry} keyword=' login ' />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
  const search = await within(dialog).findByRole('textbox', {
    name: 'Search this conversation',
  })
  expect(search).toHaveValue('login')
  expect(await within(dialog).findByRole('status')).toHaveTextContent('1 / 4')
  expect(api.get).toHaveBeenCalledWith('/api/input-audit/1/transcript/search', {
    params: { q: 'login' },
  })
  const conversation = within(dialog).getByRole('list', {
    name: 'Conversation',
  })
  const message = conversation.querySelector('[data-seq="1"]') as HTMLElement
  expect(within(message).getByText('login', { selector: 'mark' })).toBeVisible()
  expect(within(message).getByText('This message')).toBeVisible()

  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Next match' })
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Next match' })
  )
  expect(within(dialog).getByRole('status')).toHaveTextContent('3 / 4')
  const result = conversation.querySelector('[data-seq="3"]') as HTMLElement
  expect(
    within(result).getByRole('button', { name: /Tool result/ })
  ).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(search)
  await userEvent.keyboard('{Enter}')
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/1/transcript', {
      params: { offset: 490, limit: 200 },
    })
  )
  expect(within(dialog).getByRole('status')).toHaveTextContent('4 / 4')

  await userEvent.clear(search)
  await userEvent.type(search, 'nothing here')
  await waitFor(() =>
    expect(within(dialog).getByRole('status')).toHaveTextContent('No matches')
  )
  expect(conversation.querySelector('mark')).toBeNull()
})

it('earlier and later conversation items load on demand', async () => {
  vi.mocked(api.get).mockImplementation(async (_url, config) => {
    const offset = Number(config?.params?.offset ?? 200)
    return {
      data: {
        success: true,
        data: {
          ...transcript,
          turn_seq: 200,
          outline: [],
          offset,
          total: 600,
          items: [
            {
              seq: offset,
              role: 'user',
              kind: 'message',
              text: `instruction-${offset}`,
              original_chars: 15,
            },
          ],
          request_range: { start: 200, end: 201 },
        },
      },
    }
  })
  render(
    <QueryClientProvider client={client}>
      <InputAuditDetailsDialog entry={entry} />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
  expect(await within(dialog).findByText('instruction-200')).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Show earlier items' })
  )
  expect(await within(dialog).findByText('instruction-0')).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/api/input-audit/1/transcript', {
    params: { offset: 0, limit: 200 },
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Show later items' })
  )
  expect(await within(dialog).findByText('instruction-400')).toBeVisible()
  expect(within(dialog).getByText('instruction-200')).toBeVisible()
})

it.each([
  [
    { source: 'preview', reason: 'capacity_evicted', thread: undefined },
    'Evidence was removed by storage limits',
  ],
  [
    { request_range: { start: 4, end: 4 } },
    'This request added no new items. It resent existing history, for example as a retry.',
  ],
])(
  'conversation notices explain missing or resent context',
  async (overrides, notice) => {
    vi.mocked(api.get).mockImplementation(async () => ({
      data: { success: true, data: { ...transcript, ...overrides } },
    }))
    render(
      <QueryClientProvider client={client}>
        <InputAuditDetailsDialog entry={entry} />
      </QueryClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    const dialog = screen.getByRole('dialog', { name: 'Input Audits' })
    expect(await within(dialog).findByText(notice)).toBeVisible()
  }
)

it('selecting a user by name sends its ID and reset clears the selection', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  const picker = screen.getByRole('combobox', {
    name: 'Search users by name or ID',
  })
  await userEvent.click(picker)
  await userEvent.type(picker, 'alice')
  await userEvent.click(
    await screen.findByRole('option', { name: 'alice (#4)' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({ user_id: 4, p: 1 }),
    })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(picker).toHaveValue('')
})

it('grouped audit navigation uses compact buttons and keeps filters inside the active page', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const navigation = screen.getByRole('navigation', {
    name: 'Audit management',
  })
  const tabs = within(navigation).getAllByRole('button')
  expect(tabs).toHaveLength(9)
  expect(navigation).toHaveClass('shrink-0', 'w-44')
  for (const button of tabs) {
    expect(button).toHaveClass('h-10', 'w-full', 'justify-start')
  }
  expect(navigation).not.toContainElement(
    screen.getByRole('textbox', { name: 'Message keyword' })
  )
  expect(tabs[0]).toHaveAttribute('aria-current', 'page')
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'Interception evidence' })
  )
  expect(
    await screen.findByRole('region', { name: 'Interception evidence' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Message keyword' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'User message' })
  )
  expect(screen.getByRole('textbox', { name: 'Message keyword' })).toBeVisible()
})

it('mobile message lists fill the available height and scroll inside the page', async () => {
  const matchMedia = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(max-width: 640px)',
  }))
  const { container } = render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const row = await screen.findByText('alice (#4)')
  expect(container.firstElementChild).toHaveClass('h-full', 'min-h-0')
  expect(container.firstElementChild).not.toHaveClass('h-auto')
  expect(row.closest('.overflow-y-auto')).toHaveClass('min-h-0', 'flex-1')
})

it.each([false, true])(
  'pagination preserves user and keyword filters and a new search returns to page one (mobile=%s)',
  async (mobile) => {
    const matchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...matchMedia(query),
      matches: mobile && query === '(max-width: 640px)',
    }))
    render(
      <QueryClientProvider client={client}>
        <AuditLogs />
      </QueryClientProvider>
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Input Audits' }))
    await screen.findByText('alice (#4)')
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Search users by name or ID' })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'alice (#4)' })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Message keyword' }), {
      target: { value: '审计' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
        params: expect.objectContaining({ user_id: 4, keyword: '审计', p: 1 }),
      })
    )
    const next = await screen.findByRole('button', { name: 'Go to next page' })
    await waitFor(() => expect(next).toBeEnabled())
    if (mobile) {
      expect(
        within(screen.getByRole('navigation', { name: 'Page' })).getByText(
          '1 / 3'
        )
      ).toBeVisible()
    } else {
      expect(screen.getByRole('combobox', { name: '' })).toBeVisible()
    }
    expect(
      screen.getByRole('button', { name: 'Go to previous page' })
    ).toBeDisabled()
    await userEvent.click(next)
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
        params: expect.objectContaining({
          user_id: 4,
          keyword: '审计',
          p: 2,
          page_size: 20,
        }),
      })
    )
    await screen.findByText('page-2-user (#4)')
    if (mobile) expect(screen.getByText('2 / 3')).toBeVisible()
    await waitFor(() => expect(next).toBeEnabled())
    await userEvent.click(next)
    await screen.findByText('page-3-user (#4)')
    expect(next).toBeDisabled()
    expect(api.get).toHaveBeenLastCalledWith('/api/input-audit', {
      params: expect.objectContaining({
        user_id: 4,
        keyword: '审计',
        p: 3,
        page_size: 20,
      }),
    })
    if (mobile) await screen.findByText('3 / 3')
    await userEvent.click(
      screen.getByRole('button', { name: 'Go to previous page' })
    )
    await screen.findByText('page-2-user (#4)')
    await userEvent.click(
      screen.getByRole('button', { name: 'Go to previous page' })
    )
    await screen.findByText('alice (#4)')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Go to previous page' })
      ).toBeDisabled()
    )
    expect(api.get).toHaveBeenLastCalledWith('/api/input-audit', {
      params: expect.objectContaining({
        user_id: 4,
        keyword: '审计',
        p: 1,
        page_size: 20,
      }),
    })
    await userEvent.click(next)
    await screen.findByText('page-2-user (#4)')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
    )
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('alice (#4)')
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({ keyword: '审计', p: 1 }),
    })
  }
)

it('message keyword drafts only apply on search, trim outer spaces, combine with request filters and clear on reset', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  const keyword = screen.getByRole('textbox', { name: 'Message keyword' })
  fireEvent.change(keyword, { target: { value: '  100%_审计  ' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Request ID' }), {
    target: { value: 'request-a' },
  })
  expect(api.get).not.toHaveBeenCalledWith('/api/input-audit', {
    params: expect.objectContaining({ keyword: expect.any(String) }),
  })
  fireEvent.keyDown(keyword, { key: 'Enter', isComposing: true })
  expect(api.get).not.toHaveBeenCalledWith('/api/input-audit', {
    params: expect.objectContaining({ keyword: expect.any(String) }),
  })
  await userEvent.click(keyword)
  await userEvent.keyboard('{Enter}')
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit', {
      params: expect.objectContaining({
        keyword: '100%_审计',
        request_id: 'request-a',
        p: 1,
      }),
    })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(keyword).toHaveValue('')
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith('/api/input-audit', {
      params: { p: 1, page_size: 20 },
    })
  )
})

it('inline settings preserve edits after a rejected save and successful retry', async () => {
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
  await userEvent.click(
    await screen.findByRole('button', { name: 'Input audit settings' })
  )
  const dialog = await screen.findByRole('region', {
    name: 'Input audit settings',
  })
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
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(dialog).toBeVisible()
  expect(put).toHaveBeenLastCalledWith(
    '/api/input-audit/settings',
    expect.objectContaining({
      ...settings,
      max_chars: 4096,
    })
  )
})

it('out-of-range storage settings show validation without sending an update', async () => {
  const put = vi.spyOn(api, 'put')
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Input audit settings' })
  )
  const dialog = await screen.findByRole('region', {
    name: 'Input audit settings',
  })
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

it('allowlisting a user keeps audit collection and only selects content filtering instances', async () => {
  settings.enabled = true
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, policy) => ({
    data: {
      success: true,
      data: { ...(policy as InputAuditAllowlist), version: 1 },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'User allowlist' })
  )
  const dialog = await screen.findByRole('region', { name: 'User allowlist' })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Add to allowlist' })
  )
  expect(
    within(dialog).queryByRole('tab', { name: 'Edit' })
  ).not.toBeInTheDocument()
  const addForm = await screen.findByRole('dialog', {
    name: 'Add to allowlist',
  })
  await userEvent.click(
    within(addForm).getByRole('combobox', {
      name: 'Search users by name or ID',
    })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'alice (#4)' })
  )
  fireEvent.change(within(addForm).getByRole('textbox', { name: 'Reason' }), {
    target: { value: 'Approved test account' },
  })
  await userEvent.click(
    within(addForm).getByRole('combobox', {
      name: 'Content filtering instances',
    })
  )
  await userEvent.click(await screen.findByRole('option', { name: 'Policy A' }))
  await userEvent.click(
    await screen.findByRole('option', { name: 'Context policy' })
  )
  expect(
    screen.queryByRole('option', { name: 'Redaction' })
  ).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(
    within(addForm).getByRole('button', { name: 'Add to allowlist' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/input-audit/allowlist', {
      version: 0,
      entries: [
        expect.objectContaining({
          user_id: 4,
          instances: ['filter-one', 'policy-one'],
          reason: 'Approved test account',
        }),
      ],
    })
  )
  expect(put).not.toHaveBeenCalledWith(
    '/api/input-audit/settings',
    expect.anything()
  )
  expect(await within(dialog).findByText('Approved test account')).toBeVisible()
  await waitFor(() => expect(addForm).not.toBeInTheDocument())
  await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }))
  const editForm = await screen.findByRole('dialog', { name: 'Edit' })
  expect(within(editForm).getByRole('textbox', { name: 'Reason' })).toHaveValue(
    'Approved test account'
  )
  expect(
    within(editForm).getByRole('combobox', {
      name: 'Search users by name or ID',
    })
  ).toBeDisabled()
  fireEvent.change(within(editForm).getByRole('textbox', { name: 'Reason' }), {
    target: { value: 'Updated approval' },
  })
  put.mockRejectedValueOnce(new Error('offline'))
  await userEvent.click(
    within(editForm).getByRole('button', { name: 'Save changes' })
  )
  await waitFor(() =>
    expect(
      within(editForm).getByRole('button', { name: 'Save changes' })
    ).toBeEnabled()
  )
  expect(within(editForm).getByRole('textbox', { name: 'Reason' })).toHaveValue(
    'Updated approval'
  )
  await userEvent.click(
    within(editForm).getByRole('button', { name: 'Save changes' })
  )
  expect(await within(dialog).findByText('Updated approval')).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Add to allowlist' })
  )
  const freshForm = await screen.findByRole('dialog', {
    name: 'Add to allowlist',
  })
  expect(
    within(freshForm).getByRole('textbox', { name: 'Reason' })
  ).toHaveValue('')
  await userEvent.click(
    within(freshForm).getByRole('combobox', {
      name: 'Search users by name or ID',
    })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'alice (#4)' })
  )
  fireEvent.change(within(freshForm).getByRole('textbox', { name: 'Reason' }), {
    target: { value: 'Duplicate approval' },
  })
  await userEvent.click(
    within(freshForm).getByRole('combobox', {
      name: 'Content filtering instances',
    })
  )
  await userEvent.click(await screen.findByRole('option', { name: 'Policy A' }))
  await userEvent.keyboard('{Escape}')
  const savedCalls = put.mock.calls.length
  await userEvent.click(
    within(freshForm).getByRole('button', { name: 'Add to allowlist' })
  )
  expect(
    await within(freshForm).findByText(
      'This user is already on the allowlist. Edit their existing entry.'
    )
  ).toBeVisible()
  expect(put.mock.calls).toHaveLength(savedCalls)
  await userEvent.click(
    within(freshForm).getByRole('button', { name: 'Cancel' })
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
  const confirm = screen.getByRole('alertdialog')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }))
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith('/api/input-audit/allowlist', {
      version: 1,
      entries: [],
    })
  )
})

it('case decisions preserve drafts on conflict, refresh explicitly and require complete evidence for confirmation', async () => {
  const document = {
    source: 'client_request',
    scope: 'submitted_text_messages',
    messages: [{ role: 'user', text: 'exact evidence quote' }],
    truncated: false,
    context_missing: false,
    omitted: [],
  }
  let version = 1
  const get = vi.mocked(api.get)
  const originalMock = get.getMockImplementation()
  get.mockImplementation(async (url, config) => {
    if (url === '/api/input-audit/cases') {
      return { data: { success: true, data: { items: [{ id: 2 }], total: 1 } } }
    }
    if (url === '/api/input-audit/cases/2') {
      return {
        data: {
          success: true,
          data: {
            case: {
              id: 2,
              version,
              status: 'pending',
              reason: 'initial reason',
              created_by: 1,
              expires_at: 2000000000,
            },
            complete: true,
            snapshot: { document, allowlist: { version: 0, entries: [] } },
            decisions: [],
          },
        },
      }
    }
    if (originalMock) return originalMock(url, config)
    throw new Error('Unexpected API request')
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce({
      response: {
        status: 409,
        data: { success: false, message: 'version conflict' },
      },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Review' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Decision' }))
  const form = await screen.findByRole('form', { name: 'Review decision' })
  await userEvent.selectOptions(
    within(form).getByRole('combobox', { name: 'Decision' }),
    'confirmed'
  )
  await userEvent.type(
    within(form).getByRole('textbox', { name: 'Review reason' }),
    'verified review'
  )
  await userEvent.click(
    within(form).getByRole('button', { name: 'Save decision' })
  )
  expect(post).not.toHaveBeenCalled()
  await userEvent.type(
    within(form).getByRole('textbox', { name: 'Exact evidence quote' }),
    'exact evidence quote'
  )
  await userEvent.click(
    within(form).getByRole('button', { name: 'Save decision' })
  )
  await screen.findByText(
    'The decision was not saved. Your draft is preserved. Refresh explicitly if another reviewer changed the case.'
  )
  expect(
    within(form).getByRole('textbox', { name: 'Review reason' })
  ).toHaveValue('verified review')
  expect(
    within(form).getByRole('textbox', { name: 'Exact evidence quote' })
  ).toHaveValue('exact evidence quote')
  version = 2
  await userEvent.click(
    within(form).getByRole('button', { name: 'Refresh case version' })
  )
  await waitFor(() =>
    expect(
      within(form).getByRole('button', { name: 'Refresh case version' })
    ).toBeEnabled()
  )
  await userEvent.click(
    within(form).getByRole('button', { name: 'Save decision' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      '/api/input-audit/cases/2/decisions',
      expect.objectContaining({
        version: 2,
        status: 'confirmed',
        reason: 'verified review',
        references: [{ message_index: 0, quote: 'exact evidence quote' }],
      })
    )
  )
})

it('incomplete case evidence disables confirmation and renders submitted text safely', async () => {
  const get = vi.mocked(api.get)
  const originalMock = get.getMockImplementation()
  get.mockImplementation(async (url, config) => {
    if (url === '/api/input-audit/cases') {
      return { data: { success: true, data: { items: [{ id: 3 }], total: 1 } } }
    }
    if (url === '/api/input-audit/cases/3') {
      return {
        data: {
          success: true,
          data: {
            case: {
              id: 3,
              version: 1,
              status: 'pending',
              reason: 'legacy',
              created_by: 1,
              expires_at: 2000000000,
            },
            complete: false,
            snapshot: {
              document: {
                source: 'legacy_preview',
                scope: 'retained_user_text',
                messages: [{ role: 'user', text: '<script>unsafe</script>' }],
                truncated: true,
                context_missing: true,
                omitted: [],
              },
              allowlist: { version: 0, entries: [] },
            },
            decisions: [],
          },
        },
      }
    }
    if (originalMock) return originalMock(url, config)
    throw new Error('Unexpected API request')
  })
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Review' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Decision' }))
  const form = await screen.findByRole('form', { name: 'Review decision' })
  expect(
    within(form).getByRole('option', { name: 'Confirmed violation' })
  ).toBeDisabled()
  await userEvent.click(
    within(screen.getByRole('tabpanel', { name: 'Review' })).getByRole('tab', {
      name: 'Evidence message',
    })
  )
  expect(screen.getByText('<script>unsafe</script>')).toBeVisible()
  expect(screen.getByRole('dialog').querySelector('script')).toBeNull()
})

it('retained review cases remain reachable from their own paginated and filtered list', async () => {
  const get = vi.mocked(api.get)
  const originalMock = get.getMockImplementation()
  get.mockImplementation(async (url, config) => {
    if (url === '/api/input-audit/cases') {
      const page = Number(config?.params?.p ?? 1)
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                id: page + 6,
                user_id: 4,
                status: 'confirmed',
                updated_at: 1700000000,
              },
            ],
            total: 41,
          },
        },
      }
    }
    if (url === '/api/input-audit/cases/8') {
      return {
        data: {
          success: true,
          data: {
            case: {
              id: 8,
              version: 2,
              status: 'confirmed',
              reason: 'Retained case',
              created_by: 1,
              expires_at: 2000000000,
            },
            complete: false,
            snapshot: {
              document: {
                source: 'legacy_preview',
                scope: 'retained_user_text',
                messages: [
                  { index: 0, role: 'user', text: 'retained evidence' },
                ],
                truncated: false,
                context_missing: true,
                omitted: [],
              },
              allowlist: { version: 0, entries: [] },
            },
            decisions: [],
          },
        },
      }
    }
    if (originalMock) return originalMock(url, config)
    throw new Error('Unexpected API request')
  })
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Review cases' })
  )
  const dialog = await screen.findByRole('region', { name: 'Review cases' })
  await within(dialog).findByRole('button', { name: 'Review' })
  await userEvent.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Decision' }),
    'confirmed'
  )
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/input-audit/cases', {
      params: { p: 1, page_size: 20, status: 'confirmed' },
    })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Go to next page' })
    ).toBeEnabled()
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Go to next page' })
  )
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/input-audit/cases', {
      params: { p: 2, page_size: 20, status: 'confirmed' },
    })
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
  await screen.findByText('retained evidence')
  expect(get).toHaveBeenCalledWith('/api/input-audit/cases/8')
})

it('audit management entries are grouped separately from search actions', async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const management = await screen.findByRole('navigation', {
    name: 'Audit management',
  })
  expect(
    within(management).getByRole('button', { name: 'Review task queue' })
  ).toBeInTheDocument()
  expect(
    within(management).queryByRole('button', { name: 'Search' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
})

it.each(['Delete', 'Delete selected', 'Clear filtered messages'])(
  'submitted message %s confirms and deletes the selected scope',
  async (action) => {
    const remove = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { success: true } })
    render(
      <QueryClientProvider client={client}>
        <InputAuditViewer />
      </QueryClientProvider>
    )
    await screen.findByText('alice (#4)')
    if (action === 'Delete selected') {
      await userEvent.click(
        screen.getByRole('checkbox', { name: 'Select row' })
      )
    }
    await userEvent.click(screen.getByRole('button', { name: action }))
    expect(remove).not.toHaveBeenCalled()
    const confirm = screen.getByRole('alertdialog')
    expect(
      within(confirm).getByText(/Retained human review cases are preserved/)
    ).toBeVisible()
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/api/input-audit', {
        data:
          action === 'Clear filtered messages'
            ? expect.objectContaining({ all: true })
            : { turns: [{ user_id: 4, turn_key: 'turn-a' }] },
      })
    )
  }
)

it('switching management pages preserves drafts and does not fetch unopened management screens', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await screen.findByText('alice (#4)')
  expect(api.get).not.toHaveBeenCalledWith('/api/input-audit/model/jobs')
  expect(api.get).not.toHaveBeenCalledWith('/api/input-audit/allowlist')
  const keyword = screen.getByRole('textbox', { name: 'Message keyword' })
  await userEvent.type(keyword, 'draft query')
  const navigation = screen.getByRole('navigation', {
    name: 'Audit management',
  })
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'Input audit settings' })
  )
  const settingsPage = await screen.findByRole('region', {
    name: 'Input audit settings',
  })
  fireEvent.change(
    within(settingsPage).getByRole('spinbutton', { name: 'Stored characters' }),
    { target: { value: '4096' } }
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'User message' })
  )
  expect(screen.getByRole('textbox', { name: 'Message keyword' })).toHaveValue(
    'draft query'
  )
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'Input audit settings' })
  )
  expect(
    within(settingsPage).getByRole('spinbutton', { name: 'Stored characters' })
  ).toHaveValue(4096)
})

it('mobile message details use viewport height and close with Escape returning focus to the trigger', async () => {
  const original = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const trigger = await screen.findByRole('button', { name: 'Details' })
  await userEvent.click(trigger)
  const detail = screen.getByRole('dialog', { name: 'Input Audits' })
  expect(detail).toHaveClass(
    'max-sm:h-dvh',
    'max-sm:max-h-[var(--dialog-available-height,100dvh)]',
    'max-sm:rounded-none',
    'sm:max-w-6xl'
  )
  await userEvent.click(
    await within(detail).findByRole('tab', { name: 'Request' })
  )
  expect(within(detail).getByText(entry.content)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
})

it('mobile audit navigation uses one grouped selector without a tab bar or sidebar', async () => {
  const original = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 767px)' || query === '(max-width: 640px)',
  }))
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const selector = screen.getByRole('combobox', { name: 'Audit management' })
  expect(selector).toHaveValue('messages')
  expect(
    screen.queryByRole('navigation', { name: 'Audit management' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  await userEvent.selectOptions(selector, 'settings')
  expect(
    await screen.findByRole('region', { name: 'Input audit settings' })
  ).toBeVisible()
  expect(
    screen.queryByRole('textbox', { name: 'Message keyword' })
  ).not.toBeInTheDocument()
  await userEvent.selectOptions(selector, 'messages')
  expect(screen.getByRole('textbox', { name: 'Message keyword' })).toBeVisible()
})

it('switching away from messages removes its pagination from the shared page footer', async () => {
  const footer = document.createElement('div')
  document.body.appendChild(footer)
  const view = render(
    <QueryClientProvider client={client}>
      <PageFooterProvider container={footer}>
        <InputAuditViewer />
      </PageFooterProvider>
    </QueryClientProvider>
  )
  await within(footer).findByRole('button', { name: 'Go to next page' })
  await userEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Audit management' })
    ).getByRole('button', { name: 'Input audit settings' })
  )
  await screen.findByRole('region', { name: 'Input audit settings' })
  expect(footer).toBeEmptyDOMElement()
  view.unmount()
  footer.remove()
})

it('allowlist capability discovery failure prevents adding exemptions', async () => {
  settings.enabled = true
  const get = vi.mocked(api.get).getMockImplementation()
  if (!get) {
    throw new Error('API fixture is not initialized')
  }
  vi.mocked(api.get).mockImplementation((url, config) => {
    if (url === '/api/task_plugin_options') {
      return Promise.reject(new Error('offline'))
    }
    return get(url, config)
  })
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'User allowlist' })
  )
  const dialog = await screen.findByRole('region', { name: 'User allowlist' })
  await within(dialog).findByText('Failed to load audit records')
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Add to allowlist' })
  )
  const addForm = await screen.findByRole('dialog', {
    name: 'Add to allowlist',
  })
  expect(
    within(addForm).getByRole('combobox', {
      name: 'Content filtering instances',
    })
  ).toBeDisabled()
  expect(
    within(addForm).getByRole('button', { name: 'Add to allowlist' })
  ).toBeDisabled()
})
