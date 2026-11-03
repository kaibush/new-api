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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommonLogsStats } from '../common-logs-stats'
import { UsageLogsProvider } from '../usage-logs-provider'

function StatsFixture() {
  return (
    <UsageLogsProvider>
      <CommonLogsStats />
    </UsageLogsProvider>
  )
}

async function renderStats(role = 1) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: StatsFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({
      initialEntries: ['/usage-logs/common?model=gpt-test'],
    }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

afterEach(async () => {
  useAuthStore.getState().auth.reset()
  await i18next.changeLanguage('en')
})

it.each([1, 10])(
  'shows full filtered token totals for role %i and updates when filters change',
  async (role) => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          quota: 100,
          rpm: 2,
          tpm: 30,
          prompt_tokens: 1234567,
          completion_tokens: 8901,
          total_tokens: 1243468,
        },
      },
    })
    const router = await renderStats(role)
    expect(await screen.findByText('1,243,468')).toBeVisible()
    expect(screen.getByText('1,234,567')).toBeVisible()
    expect(screen.getByText('8,901')).toBeVisible()
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining(
        role === 10 ? '/api/log/stat?' : '/api/log/self/stat?'
      )
    )
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('model_name=gpt-test')
    )
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          quota: 0,
          rpm: 0,
          tpm: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      },
    })
    await act(async () => {
      await router.navigate({
        to: '/usage-logs/$section',
        params: { section: 'common' },
        search: { model: 'empty' },
      })
    })
    await waitFor(() =>
      expect(screen.queryByText('1,243,468')).not.toBeInTheDocument()
    )
    expect(
      within(screen.getByRole('group', { name: 'Token usage' })).getAllByText(
        '0'
      )
    ).toHaveLength(3)
  }
)

it.each([
  ['zhCN', '1,234'],
  ['zhTW', '1,234'],
  ['en', '1,234'],
  ['fr', '1\u202f234'],
  ['ja', '1,234'],
  ['ru', '1\u00a0234'],
  ['vi', '1.234'],
  ['invalid-locale', '1,234'],
])(
  'formats totals when the interface switches to %s',
  async (language, expected) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          quota: 0,
          rpm: 0,
          tpm: 0,
          prompt_tokens: 1000,
          completion_tokens: 234,
          total_tokens: 1234,
        },
      },
    })
    await renderStats()
    expect(await screen.findByText('1,234')).toBeVisible()
    await act(async () => {
      i18next.addResourceBundle(language, 'translation', {
        'Token usage': 'Token usage',
      })
      await i18next.changeLanguage(language)
    })
    expect(
      screen.getByText(expected, { normalizer: (text) => text })
    ).toBeVisible()
  }
)

it('shows a load error instead of reporting zero usage when the stats request fails', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Offline'))
  await renderStats()
  expect(await screen.findByText('Failed to load')).toBeVisible()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
})

it('keeps billion-token totals in a two-column mobile layout with an inline rate row', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        quota: 918293500,
        rpm: 3,
        tpm: 523859,
        prompt_tokens: 4803417113,
        completion_tokens: 52147694,
        total_tokens: 4855564807,
      },
    },
  })
  await renderStats()
  const total = await screen.findByText('4,855,564,807')
  expect(total).toBeVisible()
  expect(screen.getByText('4,803,417,113')).toBeVisible()
  expect(screen.getByText('52,147,694')).toBeVisible()
  expect(screen.getByRole('group', { name: 'Usage' })).toHaveClass(
    'grid',
    'grid-cols-2',
    'sm:flex'
  )
  expect(total).toHaveClass('break-all')
  expect(screen.getByText('523,859')).toBeVisible()
  expect(screen.getByText('RPM').parentElement).toHaveClass('flex-row')
})

it('keeps loading statistics in the same two-column mobile grid', async () => {
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}))
  await renderStats()
  const loading = await screen.findByRole('group', { name: 'Usage' })
  expect(loading).toHaveAttribute('aria-busy', 'true')
  expect(loading).toHaveClass('grid', 'grid-cols-2', 'sm:flex')
})
