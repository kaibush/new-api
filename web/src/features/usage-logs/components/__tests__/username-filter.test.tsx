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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider, useLogsViewScope } from '../usage-logs-provider'

let client: QueryClient
let usersFailure: boolean
const captureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)

function Filters() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  const scope = useLogsViewScope()
  return (
    <>
      <button type='button' onClick={() => scope.setViewScope('self')}>
        Only Mine
      </button>
      <CommonLogsFilterBar table={table} />
    </>
  )
}

function Fixture() {
  return (
    <UsageLogsProvider>
      <Filters />
    </UsageLogsProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  usersFailure = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/') {
      if (usersFailure) {
        return { data: { success: false, message: 'Users unavailable' } }
      }
      return {
        data: {
          success: true,
          data: {
            items: [
              { id: 2, username: 'alice-dev' },
              { id: 3, username: 'bob' },
            ],
            total: 2,
            page: 1,
            page_size: 100,
          },
        },
      }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default'] } }
    }
    if (url === '/api/user/self/groups') {
      return { data: { success: true, data: {} } }
    }
    return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  localStorage.clear()
  if (captureDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      captureDescriptor
    )
  } else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
})

async function renderFilter(initialEntry = '/usage-logs/common?page=3') {
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: Fixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Search' })
  return router
}

it('loads users only when advanced filters open and searches locally before applying the selected username', async () => {
  const user = userEvent.setup()
  const router = await renderFilter()
  expect(
    vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/user/')
  ).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Expand' }))
  const input = screen.getByRole('combobox', { name: 'Username' })
  await user.click(input)
  expect(await screen.findByRole('option', { name: 'bob' })).toBeVisible()
  await user.type(input, 'ICE')
  expect(screen.queryByRole('option', { name: 'bob' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'alice-dev' }))
  expect(router.state.location.search).not.toHaveProperty('username')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      username: 'alice-dev',
      page: 1,
    })
  )
  expect(
    vi.mocked(api.get).mock.calls.filter(([url]) => url === '/api/user/')
  ).toHaveLength(1)
})

it('selects with the first Enter and submits the selected username with the second Enter', async () => {
  const user = userEvent.setup()
  const router = await renderFilter()
  await user.click(screen.getByRole('button', { name: 'Expand' }))
  const input = screen.getByRole('combobox', { name: 'Username' })
  await user.click(input)
  await screen.findByRole('option', { name: 'bob' })
  await user.type(input, 'bo')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(input).toHaveValue('bob')
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(router.state.location.search).not.toHaveProperty('username')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      username: 'bob',
      page: 1,
    })
  )
})

it('preserves manual usernames when loading fails and clears the filter on Search', async () => {
  usersFailure = true
  const user = userEvent.setup()
  const router = await renderFilter('/usage-logs/common?username=historical')
  await user.click(screen.getByRole('button', { name: /^Expand/ }))
  const input = screen.getByRole('combobox', { name: 'Username' })
  expect(input).toHaveValue('historical')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Failed to load users'
  )
  await user.clear(input)
  await user.type(input, 'archived')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ username: 'archived' })
  )
  await user.clear(input)
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('username')
  )
})

it('masks usernames in both the input and dropdown when sensitive data is hidden', async () => {
  const user = userEvent.setup()
  await renderFilter()
  await user.click(screen.getByRole('button', { name: /^Hide$/ }))
  await user.click(screen.getByRole('button', { name: 'Expand' }))
  const input = screen.getByRole('combobox', { name: 'Username' })
  await user.click(input)
  const option = await screen.findByRole('option', { name: 'bob' })
  expect(input.closest('.\\[-webkit-text-security\\:disc\\]')).not.toBeNull()
  expect(option.closest('.\\[-webkit-text-security\\:disc\\]')).not.toBeNull()
})

it('selects a user inside the mobile filter drawer and applies it on Search', async () => {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
  const user = userEvent.setup()
  const router = await renderFilter()
  await user.click(screen.getByRole('button', { name: /^Filter/ }))
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByRole('combobox', { name: 'Username' }))
  await user.click(await within(dialog).findByRole('option', { name: 'bob' }))
  expect(dialog).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      username: 'bob',
      page: 1,
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it.each(['regular account', 'administrator self view'] as const)(
  'does not fetch or show user choices for %s',
  async (scope) => {
    if (scope === 'regular account') {
      useAuthStore.getState().auth.setUser({ id: 3, username: 'bob', role: 1 })
    }
    const user = userEvent.setup()
    await renderFilter()
    if (scope === 'administrator self view') {
      await user.click(screen.getByRole('button', { name: 'Only Mine' }))
    }
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(
      screen.queryByRole('combobox', { name: 'Username' })
    ).not.toBeInTheDocument()
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/user/')
    ).toBe(false)
  }
)
