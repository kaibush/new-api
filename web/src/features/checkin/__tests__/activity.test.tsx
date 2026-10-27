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

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { Route as CheckinRoute } from '@/routes/_authenticated/checkin'
import { Route as BillingRoute } from '@/routes/_authenticated/system-settings/billing/$section'
import { useAuthStore } from '@/stores/auth-store'

import { CheckinAdmin } from '..'
import { CheckinActivityPanel } from '../components/activity-panel'
import { CheckinSettingsPage } from '../components/settings-page'
import type { CheckinEligibility, CheckinUserQuery } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

let client: QueryClient

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
})

const eligibility: CheckinEligibility = {
  limited: true,
  allowed: true,
  reasons: ['low_activity'],
  min_quota: 60,
  max_quota: 60,
  base_min_quota: 100,
  base_max_quota: 100,
  activity_percent: 60,
  reward_percent: 60,
  reward_numerator: 60,
  reward_denominator: 100,
  gift_remaining: 0,
  gift_cap: 0,
  monthly_awarded: 0,
  monthly_cap: 1000,
  monthly_remaining: 1000,
  recent_spend: 60,
  minimum_spend: 100,
  spending_gap: 40,
  activity_days: 30,
  observation_until: 1700000000,
  next_month_at: 1793491200,
  today: '2026-10-24',
  coverage_since: 1700000000,
  history_complete: true,
  window_start: 1790246400,
  as_of: 1792838400,
  config_version: 2,
  new_user_days: 7,
  grace_day: 7,
  grace_remaining_days: 0,
  pending_count: 0,
}
const activeUser = {
  id: 2,
  username: 'active-user',
  display_name: 'Active user',
  created_at: 1700000000,
  eligibility,
}
const inactiveUser = {
  id: 1,
  username: 'inactive-user',
  display_name: 'Inactive user',
  created_at: 1700000000,
  eligibility: {
    ...eligibility,
    activity_percent: 0,
    reward_percent: 20,
    recent_spend: 0,
    min_quota: 20,
    max_quota: 20,
    reasons: ['low_activity', 'reward_floor'],
  },
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/checkin') {
      return {
        data: {
          success: true,
          data: {
            version: 2,
            observed_since: 1700000000,
            settings: {
              enabled: true,
              min_quota: 100,
              max_quota: 100,
              limits: {
                enabled: true,
                monthly_cap: 1000,
                activity_days: 30,
                minimum_spend: 100,
                reduced_percent: 20,
                new_user_days: 7,
              },
            },
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data:
          url === '/api/user/2/checkin'
            ? {
                user: activeUser,
                days: [],
                grants: {
                  available: 0,
                  reserved: 0,
                  used: 0,
                  expired: 0,
                  as_of: 1792838400,
                  records: null,
                },
                records: [
                  {
                    checkin_date: '2026-10-23',
                    quota_awarded: 20,
                    snapshot: {
                      configuration: { version: 1 },
                      base_quota: 100,
                      eligibility: inactiveUser.eligibility,
                    },
                  },
                ],
              }
            : {
                as_of: 1792838400,
                config_version: 2,
                updating: false,
                total: 2,
                grace: 0,
                active: 0,
                low_activity: 1,
                zero_activity: 1,
                incomplete: 0,
                pending: 0,
                distribution: [],
                days: [],
              },
      },
    }
  })
  vi.spyOn(api, 'post').mockImplementation(async (_url, query) => ({
    data: {
      success: true,
      data: {
        items:
          (query as CheckinUserQuery).filter === 'zero_activity'
            ? [inactiveUser]
            : [activeUser],
        total: 1,
        as_of: 1792838400,
        config_version: 2,
        updating: false,
        preview: false,
      },
    },
  }))
})

function renderActivity() {
  render(
    <QueryClientProvider client={client}>
      <CheckinActivityPanel />
    </QueryClientProvider>
  )
}

test('an empty method 2 search keeps the expiry view without activity filters', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: true,
      data: {
        mode: 2,
        items: [],
        total: 0,
        as_of: 1792838400,
        config_version: 2,
        updating: false,
      },
    },
  })
  renderActivity()
  expect(
    await screen.findByRole('heading', { name: 'Expiring check-in quota' })
  ).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Activity filter' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('columnheader', { name: 'Monthly rewards / cap' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
})

async function renderAdmin(path: string, role: number) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'operator', role })
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/checkin',
        beforeLoad: CheckinRoute.options.beforeLoad as () => void,
        component: CheckinAdmin,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/system-settings/billing/$section',
        component: CheckinSettingsPage,
        beforeLoad: BillingRoute.options.beforeLoad as (context: {
          params: { section: string }
        }) => void,
      }),
      createRoute({ getParentRoute: () => root, path: '/403' }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
  return router
}

test('administrators can open the standalone activity page without requesting root settings', async () => {
  await renderAdmin('/checkin', ROLE.ADMIN)
  expect(
    await screen.findByRole('heading', { name: 'Check-in usage' })
  ).toBeVisible()
  await screen.findByRole('button', { name: 'Active user' })
  expect(
    screen.queryByRole('button', { name: 'Save check-in settings' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/api/option/checkin')
})

test('regular users visiting the activity URL are redirected before any admin data is fetched', async () => {
  const router = await renderAdmin('/checkin', ROLE.USER)
  await waitFor(() => expect(router.state.location.pathname).toBe('/403'))
  expect(api.get).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

test('check-in settings stay on a separate page without fetching usage data', async () => {
  const router = await renderAdmin(
    '/system-settings/billing/checkin',
    ROLE.SUPER_ADMIN
  )
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/system-settings/billing/checkin'
    )
  )
  expect(
    await screen.findByRole('button', { name: 'Save check-in settings' })
  ).toBeDisabled()
  const minimum = await screen.findByRole('spinbutton', {
    name: 'Minimum check-in quota',
  })
  fireEvent.change(minimum, { target: { value: '50' } })
  expect(
    screen.getByRole('button', { name: 'Save check-in settings' })
  ).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Active user' })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('selecting an activity filter requests a new server page and displays its results', async () => {
  const user = userEvent.setup()
  renderActivity()
  await screen.findByRole('button', { name: 'Active user' })
  await user.click(screen.getByRole('combobox', { name: 'Activity filter' }))
  await user.click(screen.getByRole('option', { name: 'Zero activity' }))
  await screen.findByRole('button', { name: 'Inactive user' })
  expect(
    screen.queryByRole('button', { name: 'Active user' })
  ).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith(
    '/api/user/checkin/users',
    expect.objectContaining({ filter: 'zero_activity', page: 1 }),
    expect.anything()
  )
})

test('user details retain the historical reward percentage after the current policy changes', async () => {
  renderActivity()
  fireEvent.click(await screen.findByRole('button', { name: 'Active user' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Check-in reward details',
  })
  fireEvent.click(
    await within(dialog).findByRole('button', {
      name: '2026-10-23 · Check-in reward details',
    })
  )
  expect(
    within(dialog).getByText(/The minimum reward percentage applies/)
  ).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/api/user/2/checkin')
})

test('a failed user query offers a retry and recovers without showing stale records', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Unavailable'))
  renderActivity()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(
    screen.queryByRole('button', { name: 'Active user' })
  ).not.toBeInTheDocument()
  fireEvent.click(retry)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Active user' })
    ).toBeInTheDocument()
  )
})

test('the first statistics snapshot shows loading instead of zero totals or an epoch timestamp', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        as_of: 0,
        config_version: 2,
        updating: true,
        total: 0,
        grace: 0,
        active: 0,
        low_activity: 0,
        zero_activity: 0,
        incomplete: 0,
        pending: 0,
        distribution: [],
        days: [],
      },
    },
  })
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: true,
      data: {
        as_of: 0,
        config_version: 2,
        updating: true,
        items: [],
        total: 0,
      },
    },
  })
  renderActivity()
  await screen.findAllByText('Updating activity statistics...')
  expect(screen.queryByText('Full activity')).not.toBeInTheDocument()
  expect(screen.queryByText(/1970-01-01/)).not.toBeInTheDocument()
  expect(screen.queryByText('No records')).not.toBeInTheDocument()
})

test('switching to expiring rewards saves validity independently and preserves activity settings', async () => {
  const user = userEvent.setup()
  const save = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: { ...(body as object), version: 3, observed_since: 1700000000 },
    },
  }))
  await renderAdmin('/system-settings/billing/checkin', ROLE.SUPER_ADMIN)
  fireEvent.change(
    await screen.findByRole('spinbutton', { name: 'Activity window (days)' }),
    { target: { value: '0' } }
  )
  const method = await screen.findByRole('combobox', {
    name: 'Check-in method',
  })
  await user.click(method)
  await user.click(
    await screen.findByRole('option', { name: 'Method 2: Expiring rewards' })
  )
  expect(
    screen.queryByLabelText('Monthly check-in reward cap')
  ).not.toBeInTheDocument()
  const minutes = screen.getByRole('spinbutton', {
    name: 'Reward validity (minutes)',
  })
  fireEvent.change(minutes, { target: { value: '35' } })
  await user.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      '/api/option/checkin',
      expect.objectContaining({
        version: 2,
        settings: expect.objectContaining({
          mode: 2,
          expiry_seconds: 2100,
          limits: expect.objectContaining({
            monthly_cap: 1000,
            activity_days: 0,
          }),
        }),
      })
    )
  )
  await user.click(method)
  await user.click(
    await screen.findByRole('option', { name: 'Method 1: Activity rewards' })
  )
  expect(screen.getByLabelText('Monthly check-in reward cap')).toHaveValue(1000)
  expect(
    screen.queryByLabelText('Reward validity (minutes)')
  ).not.toBeInTheDocument()
})

test('expiring reward validity rejects zero before saving', async () => {
  const user = userEvent.setup()
  const save = vi.spyOn(api, 'put')
  await renderAdmin('/system-settings/billing/checkin', ROLE.SUPER_ADMIN)
  await user.click(
    await screen.findByRole('combobox', { name: 'Check-in method' })
  )
  await user.click(
    await screen.findByRole('option', { name: 'Method 2: Expiring rewards' })
  )
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Reward validity (minutes)' }),
    { target: { value: '0' } }
  )
  await user.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('spinbutton', { name: 'Reward validity (minutes)' })
    ).toHaveAttribute('aria-invalid', 'true')
  )
  expect(save).not.toHaveBeenCalled()
})

test('root users see usage and a settings link without a settings form on the usage page', async () => {
  await renderAdmin('/checkin', ROLE.SUPER_ADMIN)
  expect(
    await screen.findByRole('button', { name: 'Active user' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Check-in Settings' })
  ).toHaveAttribute('href', '/system-settings/billing/checkin')
  expect(
    screen.queryByRole('button', { name: 'Save check-in settings' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/api/option/checkin')
})
