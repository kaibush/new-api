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
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
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
  balance: {
    wallet_quota: 5000000,
    checkin_quota: 1500000,
    expired_quota: 500000,
    next_expiry_at: 1792924800,
    as_of: 1792838400,
  },
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

const activityUser = {
  id: 2,
  username: 'active-user',
  display_name: 'Active user',
  consumed_quota: 5000000,
  wallet_quota: 3000000,
  checkin_quota: 1000000,
  subscription_quota: 1000000,
  charged_records: 12,
  active_days: 3,
  last_used_at: 1792838340,
  pending_records: 1,
  coverage_since: 1700000000,
  history_complete: true,
}
const activityOverview = {
  consumed_quota: 5000000,
  wallet_quota: 3000000,
  checkin_quota: 1000000,
  subscription_quota: 1000000,
  total_users: 2,
  consuming_users: 1,
  incomplete_users: 1,
  pending_records: 1,
  window_start: 1790246400,
  as_of: 1792838400,
  days: [],
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/activity/overview') {
      return { data: { success: true, data: activityOverview } }
    }
    if (url === '/api/user/2/activity') {
      return {
        data: {
          success: true,
          data: {
            user: activityUser,
            window_start: 1790246400,
            as_of: 1792838400,
            days: [],
          },
        },
      }
    }
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
  vi.spyOn(api, 'post').mockImplementation(async (url, query) => ({
    data: {
      success: true,
      data:
        url === '/api/user/activity/users'
          ? {
              items: [activityUser],
              total: 1,
              window_start: 1790246400,
              as_of: 1792838400,
            }
          : {
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
    await screen.findByRole('heading', { name: 'Check-in and balances' })
  ).toBeVisible()
  await waitFor(() =>
    expect(
      screen.queryByRole('combobox', { name: 'Activity filter' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('columnheader', { name: 'Monthly rewards / cap' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
})

test.each([1, 2])(
  'method %i lists separate balances and opens the selected user’s balance details',
  async (mode) => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        success: true,
        data: {
          mode,
          items: [{ ...activeUser, eligibility: { ...eligibility, mode } }],
          total: 1,
          as_of: 1792838400,
          config_version: 2,
          updating: false,
        },
      },
    })
    const get = vi.mocked(api.get).getMockImplementation()
    if (!get) throw new Error('Expected the default API fixture')
    vi.mocked(api.get).mockImplementation(async (url, options) => {
      if (url === '/api/user/2/checkin') {
        return {
          data: {
            success: true,
            data: {
              user: { ...activeUser, eligibility: { ...eligibility, mode } },
              days: [],
              records: [],
              grants: {
                available: 1500000,
                reserved: 100000,
                used: 200000,
                expired: 500000,
                as_of: 1792838400,
                records: null,
              },
            },
          },
        }
      }
      return get(url, options)
    })
    renderActivity()
    const button = await screen.findByRole('button', { name: 'Active user' })
    const row = within(screen.getByRole('row', { name: /Active user/ }))
    for (const label of [
      'Recharged quota',
      'Check-in quota',
      'Expired check-in quota',
      'Next reward expiry',
    ]) {
      expect(screen.getByRole('columnheader', { name: label })).toBeVisible()
    }
    for (const quota of [5000000, 1500000, 500000]) {
      expect(row.getByText(formatQuotaWithCurrency(quota))).toBeVisible()
    }
    const expiry = dayjs.unix(1792924800).format('YYYY-MM-DD HH:mm:ss')
    expect(row.getByText(expiry)).toBeVisible()
    fireEvent.click(button)
    const dialog = within(
      await screen.findByRole('dialog', { name: 'User details' })
    )
    expect(
      await dialog.findByRole('group', { name: 'Recharged quota' })
    ).toHaveTextContent(formatQuotaWithCurrency(5000000))
    expect(
      dialog.getByRole('group', { name: 'Check-in quota' })
    ).toHaveTextContent(formatQuotaWithCurrency(1500000))
    expect(dialog.getByText(`Next reward expiry: ${expiry}`)).toBeVisible()
    for (const [label, quota] of [
      ['Reserved quota', 100000],
      ['Used', 200000],
      ['Expired', 500000],
    ] as const) {
      expect(
        dialog.getByText(label, { selector: 'dt' }).parentElement
      ).toHaveTextContent(formatQuotaWithCurrency(quota))
    }
    expect(dialog.getByText('No records')).toBeVisible()
  }
)

test('missing balances stay unknown while an empty wallet shows zero and no upcoming expiry', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: true,
      data: {
        mode: 2,
        items: [
          inactiveUser,
          {
            ...activeUser,
            balance: {
              wallet_quota: 0,
              checkin_quota: 0,
              expired_quota: 0,
              next_expiry_at: 0,
              as_of: 1792838400,
            },
          },
        ],
        total: 2,
        as_of: 1792838400,
        updating: false,
      },
    },
  })
  renderActivity()
  await screen.findByRole('button', { name: 'Inactive user' })
  const missing = within(screen.getByRole('row', { name: /Inactive user/ }))
  expect(missing.getAllByText('—')).toHaveLength(4)
  const empty = within(screen.getByRole('row', { name: /Active user/ }))
  expect(empty.getAllByText(formatQuotaWithCurrency(0))).toHaveLength(3)
  expect(empty.getByText('None')).toBeVisible()
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
    await screen.findByRole('heading', { name: 'User activity' })
  ).toBeVisible()
  await screen.findByRole('region', { name: 'Global usage overview' })
  expect(api.post).not.toHaveBeenCalled()
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
    name: 'User details',
  })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Reward history' }))
  fireEvent.click(
    await within(dialog).findByRole('button', {
      name: /2026-10-23 · Check-in reward details/,
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

test('global statistics show loading until a response arrives and recover from failures', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Unavailable'))
  await renderAdmin('/checkin', ROLE.ADMIN)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('region', { name: 'Global usage overview' })
  ).toBeVisible()
  expect(screen.queryByText(/1970-01-01/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
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
    await screen.findByRole('region', { name: 'Global usage overview' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Check-in Settings' })
  ).toHaveAttribute('href', '/system-settings/billing/checkin')
  expect(
    screen.queryByRole('button', { name: 'Save check-in settings' })
  ).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/api/option/checkin')
})

test('overview, user usage and rewards fetch independently while the usage period is preserved', async () => {
  const user = userEvent.setup()
  await renderAdmin('/checkin', ROLE.ADMIN)
  const overview = await screen.findByRole('region', {
    name: 'Global usage overview',
  })
  expect(
    within(overview).getByRole('group', { name: 'Recharged quota' })
  ).toHaveTextContent(formatQuotaWithCurrency(3000000))
  expect(api.post).not.toHaveBeenCalled()
  expect(
    screen.getByRole('combobox', { name: 'Usage period' })
  ).toHaveTextContent('Last 30 days')
  await user.click(screen.getByRole('combobox', { name: 'Usage period' }))
  await user.click(screen.getByRole('option', { name: 'Last 7 days' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/user/activity/overview',
      expect.objectContaining({ params: { days: 7 } })
    )
  )
  await user.click(screen.getByRole('tab', { name: 'User usage' }))
  const selected = await screen.findByRole('button', { name: 'Active user' })
  expect(
    screen.getByRole('combobox', { name: 'Usage period' })
  ).toHaveTextContent('Last 7 days')
  expect(
    screen.getByRole('combobox', { name: 'Usage status' })
  ).toHaveTextContent('All users')
  expect(
    screen.getByRole('combobox', { name: 'Usage sorting' })
  ).toHaveTextContent('Spending: high to low')
  expect(
    screen.queryByRole('region', { name: 'Global usage overview' })
  ).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith(
    '/api/user/activity/users',
    expect.objectContaining({ days: 7 }),
    expect.anything()
  )
  await user.click(selected)
  const dialog = within(
    await screen.findByRole('dialog', { name: 'User details' })
  )
  expect(
    await dialog.findByRole('group', { name: 'Days with spending' })
  ).toHaveTextContent('3')
  expect(
    dialog.getByRole('group', { name: 'Charged records' })
  ).toHaveTextContent('12')
  expect(api.get).not.toHaveBeenCalledWith('/api/user/2/checkin')
  expect(
    dialog.queryByText('Recent expiring rewards (up to 100)')
  ).not.toBeInTheDocument()
  await user.click(dialog.getByRole('tab', { name: 'Balance' }))
  await dialog.findByText('Recent expiring rewards (up to 100)')
  expect(
    dialog.queryByRole('group', { name: 'Charged records' })
  ).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/api/user/2/checkin')
  await user.click(dialog.getByRole('tab', { name: 'Reward history' }))
  expect(await dialog.findByText('Recent check-in rewards')).toBeVisible()
  expect(
    dialog.queryByText('Recent expiring rewards (up to 100)')
  ).not.toBeInTheDocument()
})

test('mode 2 keeps the global and per-user statistics available after viewing balances', async () => {
  const user = userEvent.setup()
  const post = vi.mocked(api.post).getMockImplementation()
  if (!post) throw new Error('Expected API fixture')
  vi.mocked(api.post).mockImplementation(async (url, body, options) => {
    if (url === '/api/user/checkin/users') {
      return {
        data: {
          success: true,
          data: {
            mode: 2,
            items: [],
            total: 0,
            as_of: 1792838400,
            config_version: 2,
          },
        },
      }
    }
    return post(url, body, options)
  })
  await renderAdmin('/checkin', ROLE.ADMIN)
  await screen.findByRole('region', { name: 'Global usage overview' })
  await user.click(screen.getByRole('tab', { name: 'Check-in and balances' }))
  await screen.findByText('No records')
  expect(
    screen.queryByRole('combobox', { name: 'Usage period' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Global usage overview' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Global overview' }))
  expect(
    await screen.findByRole('region', { name: 'Global usage overview' })
  ).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'User usage' }))
  expect(
    await screen.findByRole('button', { name: 'Active user' })
  ).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Settled spending' })
  ).toBeVisible()
  expect(
    screen.queryByRole('columnheader', { name: 'Monthly rewards / cap' })
  ).not.toBeInTheDocument()
})
