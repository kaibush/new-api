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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { DatabaseMaintenancePanel } from '../components/database-maintenance-panel'
import type { DatabaseStorage } from '../types'

const tables: DatabaseStorage[] = [
  {
    scope: 'primary',
    engine: 'mysql',
    name: 'gateway',
    available: true,
    bytes: 104857600,
    tables: [
      {
        name: 'logs',
        bytes: 10485760,
        data_bytes: 8388608,
        index_bytes: 2097152,
        estimated_rows: 12345,
        cleanup_target: 'request_logs',
      },
      {
        name: 'users',
        bytes: 1048576,
        data_bytes: 1048576,
        index_bytes: 0,
        estimated_rows: 5,
      },
      {
        name: 'site_visits',
        bytes: null,
        data_bytes: null,
        index_bytes: null,
        estimated_rows: null,
        cleanup_target: 'site_visits',
      },
    ],
  },
]
const preview = {
  target: 'request_logs',
  before: 1700000000,
  max_id: 250,
  count: 201,
}
let client: QueryClient

async function renderPanel() {
  const root = createRootRoute({ component: DatabaseMaintenancePanel })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: tables },
  })
})
afterEach(async () => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
  i18next.removeResourceBundle('zhCN', 'translation')
  i18next.removeResourceBundle('vi', 'translation')
})

it('shows storage and estimates while restricting cleanup to supported history tables', async () => {
  await renderPanel()
  expect(await screen.findByText('100 MiB')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Database tables' })).toHaveClass(
    'max-h-96',
    'overflow-auto'
  )
  expect(
    screen.getByRole('region', { name: 'Database tables' })
  ).toHaveAttribute('tabindex', '0')
  expect(screen.getByText('12,345')).toBeVisible()
  expect(
    screen.getAllByRole('button', { name: /^Clean history in/ })
  ).toHaveLength(2)
  const users = screen.getByRole('row', { name: /^users / })
  expect(within(users).getByText('View only')).toBeVisible()
  expect(within(users).queryByRole('button')).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('row', { name: /^site_visits / })).getAllByText('—')
  ).toHaveLength(4)
  expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
    'href',
    '/users'
  )
  i18next.addResourceBundle('zhCN', 'translation', {
    'Database maintenance': '数据库维护',
  })
  await act(async () => {
    await i18next.changeLanguage('zhCN')
  })
  expect(screen.getByText('数据库维护')).toBeVisible()
  i18next.addResourceBundle('vi', 'translation', {
    'Database maintenance': 'Bảo trì cơ sở dữ liệu',
  })
  await act(async () => {
    await i18next.changeLanguage('vi')
  })
  expect(screen.getByText('12.345')).toBeVisible()
})

it('requires a fresh preview after retention changes and queues precisely the confirmed snapshot', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/preview') ? preview : { task_id: 'cleanup-1' },
    },
  }))
  const user = userEvent.setup()
  await renderPanel()
  await user.click(
    await screen.findByRole('button', { name: 'Clean history in logs' })
  )
  const dialog = screen.getByRole('alertdialog')
  const start = within(dialog).getByRole('button', { name: 'Start cleanup' })
  expect(start).toBeDisabled()
  const retention = within(dialog).getByRole('spinbutton', {
    name: 'Keep recent data (days)',
  })
  await user.click(retention)
  await user.keyboard('{Enter}')
  await within(dialog).findByText('Records to delete: 201')
  expect(post).toHaveBeenCalledWith(
    '/api/system-info/database/cleanup/preview',
    { target: 'request_logs', retention_days: 30 }
  )
  await user.clear(retention)
  await user.type(retention, '60')
  expect(start).toBeDisabled()
  expect(
    within(dialog).queryByText('Records to delete: 201')
  ).not.toBeInTheDocument()
  await user.click(
    within(dialog).getByRole('button', { name: 'Preview cleanup' })
  )
  await waitFor(() => expect(start).toBeEnabled())
  await user.click(start)
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/system-info/database/cleanup',
    preview
  )
  expect(
    await screen.findByText(
      'Cleanup queued. Follow its progress in System Tasks.'
    )
  ).toBeVisible()
})

it('blocks repeat submissions while cleanup is pending and keeps the preview after a server failure', async () => {
  let rejectCleanup!: (error: Error) => void
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: preview } })
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCleanup = reject
        })
    )
  const user = userEvent.setup()
  await renderPanel()
  await user.click(
    await screen.findByRole('button', { name: 'Clean history in logs' })
  )
  await user.click(screen.getByRole('button', { name: 'Preview cleanup' }))
  const start = screen.getByRole('button', { name: 'Start cleanup' })
  await waitFor(() => expect(start).toBeEnabled())
  await user.click(start)
  expect(start).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('spinbutton')).toBeDisabled()
  await user.click(start)
  expect(post).toHaveBeenCalledTimes(2)
  await act(async () => rejectCleanup(new Error('database busy')))
  expect(await screen.findByText('database busy')).toBeVisible()
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(screen.getByText('Records to delete: 201')).toBeVisible()
  await waitFor(() => expect(start).toBeEnabled())
})

it('rejects invalid retention and leaves cleanup disabled when preview finds no history', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { ...preview, target: 'site_visits', count: 0, max_id: 0 },
    },
  })
  const user = userEvent.setup()
  await renderPanel()
  await user.click(
    await screen.findByRole('button', { name: 'Clean history in site_visits' })
  )
  const days = screen.getByRole('spinbutton')
  await user.clear(days)
  await user.type(days, '0')
  await user.click(screen.getByRole('button', { name: 'Preview cleanup' }))
  expect(
    await screen.findByText('Retention must be between 1 and 3650 days.')
  ).toBeVisible()
  expect(days).toHaveAttribute('aria-invalid', 'true')
  expect(post).not.toHaveBeenCalled()
  await user.clear(days)
  await user.type(days, '30')
  await user.click(screen.getByRole('button', { name: 'Preview cleanup' }))
  expect(await screen.findByText('Records to delete: 0')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Start cleanup' })).toBeDisabled()
  expect(post).toHaveBeenCalledWith(
    '/api/system-info/database/cleanup/preview',
    { target: 'site_visits', retention_days: 30 }
  )
})

it('offers retry after a storage failure and shows empty or unsupported databases without cleanup controls', async () => {
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error('metadata unavailable'))
    .mockResolvedValue({
      data: {
        success: true,
        data: [
          { ...tables[0], tables: [] },
          {
            scope: 'logs',
            name: '',
            engine: 'clickhouse',
            available: false,
            bytes: 0,
            tables: [],
          },
        ],
      },
    })
  const user = userEvent.setup()
  await renderPanel()
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No tables found.')).toBeVisible()
  expect(
    screen.getByText(
      'Storage inspection and cleanup are unavailable for this database engine.'
    )
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /^Clean history in/ })
  ).not.toBeInTheDocument()
})
