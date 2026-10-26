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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Load the lazy panel before test timing starts; its real interactions remain tested.
import '@/features/checkin/components/activity-panel'
import { CheckinSettingsPage } from '@/features/checkin/components/settings-page'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { CheckinCalendarCard } from '../components/checkin-calendar-card'
import type { CheckinEligibility } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

afterEach(() => useAuthStore.getState().auth.reset())

const eligibility: CheckinEligibility = {
  activity_percent: 100,
  reward_numerator: 1,
  reward_denominator: 1,
  base_min_quota: 10,
  base_max_quota: 20,
  monthly_remaining: 200,
  spending_gap: 0,
  history_complete: true,
  coverage_since: 1700000000,
  window_start: 1790000000,
  as_of: 1792592000,
  config_version: 1,
  new_user_days: 7,
  grace_day: 0,
  grace_remaining_days: 0,
  pending_count: 0,
  limited: true,
  allowed: true,
  reasons: [],
  min_quota: 10,
  max_quota: 20,
  reward_percent: 100,
  gift_remaining: 0,
  gift_cap: 100,
  monthly_awarded: 0,
  monthly_cap: 200,
  recent_spend: 100,
  minimum_spend: 100,
  activity_days: 30,
  observation_until: 0,
  next_month_at: 1800000000,
  today: '2026-10-21',
}
const limits = {
  enabled: false,
  monthly_cap: 200,
  activity_days: 30,
  minimum_spend: 100,
  reduced_percent: 20,
  new_user_days: 7,
}

function renderCheckin(decision: CheckinEligibility) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        eligibility: decision,
        stats: {
          checked_in_today: false,
          records: [],
          total_checkins: 0,
          checkin_count: 0,
          total_quota: 0,
        },
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinCalendarCard
        checkinEnabled
        turnstileEnabled={false}
        turnstileSiteKey=''
      />
    </QueryClientProvider>
  )
  return screen.findByText('Daily Check-in')
}

const configuration = {
  version: 1,
  observed_since: 1700000000,
  settings: { enabled: true, min_quota: 10, max_quota: 100, limits },
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/option/checkin'
          ? configuration
          : {
              as_of: 1792592000,
              config_version: 1,
              updating: false,
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
  }))
  vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/user/checkin/users'
          ? {
              items: [],
              total: 0,
              updating: false,
              config_version: 1,
              as_of: 1792592000,
            }
          : { quota_awarded: 10 },
    },
  }))
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...configuration, version: 2 } },
  })
})

test.each(['monthly_cap', 'accounting_pending'])(
  'a %s restriction explains why and prevents a claim',
  async (reason) => {
    await renderCheckin({ ...eligibility, allowed: false, reasons: [reason] })
    const button = screen.getByRole('button', {
      name: 'Check-in reward details',
    })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Claim this reward' })
    ).toBeDisabled()
    expect(api.post).not.toHaveBeenCalled()
  }
)

test('reduced rewards explain the percentage and remain claimable', async () => {
  await renderCheckin({
    ...eligibility,
    reward_percent: 20,
    reasons: ['low_activity'],
  })
  const button = screen.getByRole('button', { name: 'Check in now' })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(button)
  fireEvent.click(screen.getByRole('button', { name: 'Claim this reward' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
  )
})

async function renderSettings() {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'root',
    role: ROLE.SUPER_ADMIN,
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: CheckinSettingsPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('switch', { name: 'Limit check-in rewards' })
}

test('the limits toggle reveals controls and saves one complete policy', async () => {
  const toggle = await renderSettings()
  expect(
    screen.queryByRole('spinbutton', { name: 'Monthly check-in reward cap' })
  ).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(
    screen.queryByRole('spinbutton', { name: 'Unspent check-in reward cap' })
  ).not.toBeInTheDocument()
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Monthly check-in reward cap' }),
    { target: { value: '300' } }
  )
  for (const [name, value] of [
    ['Activity window (days)', '15'],
    ['Minimum spending in the activity window', '1000'],
    ['Minimum reward percentage', '10'],
    ['New user grace period (days)', '5'],
  ]) {
    fireEvent.change(screen.getByRole('spinbutton', { name }), {
      target: { value },
    })
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/checkin', {
      version: 1,
      settings: {
        mode: 1,
        expiry_seconds: 86400,
        enabled: true,
        min_quota: 10,
        max_quota: 100,
        limits: {
          ...limits,
          enabled: true,
          monthly_cap: 300,
          activity_days: 15,
          minimum_spend: 1000,
          reduced_percent: 10,
          new_user_days: 5,
        },
      },
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('out-of-range percentages cannot be saved', async () => {
  fireEvent.click(await renderSettings())
  const input = screen.getByRole('spinbutton', {
    name: 'Minimum reward percentage',
  })
  fireEvent.change(input, { target: { value: '101' } })
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(api.put).not.toHaveBeenCalled()
})

test('registration grace allows accumulated rewards without a gift cap', async () => {
  await renderCheckin({
    ...eligibility,
    gift_remaining: 500,
    reasons: ['new_user_grace'],
  })
  expect(
    screen.getByText(
      'During your registration grace period, daily rewards are paid normally, subject to the monthly cap.'
    )
  ).toBeInTheDocument()
  expect(screen.queryByText(/Unspent rewards:/)).not.toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Check in now' })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  fireEvent.click(screen.getByRole('button', { name: 'Claim this reward' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
  )
})

test('a failed settings save keeps edits available for retry', async () => {
  vi.mocked(api.put).mockResolvedValueOnce({
    data: { success: false, message: 'Database unavailable' },
  })
  await renderSettings()
  const input = screen.getByRole('spinbutton', {
    name: 'Minimum check-in quota',
  })
  fireEvent.change(input, { target: { value: '25' } })
  const save = screen.getByRole('button', { name: 'Save check-in settings' })
  fireEvent.click(save)
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(save).toBeEnabled())
  expect(input).toHaveValue(25)
})

test('editing settings does not request or embed the usage page', async () => {
  await renderSettings()
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Minimum check-in quota' }),
    { target: { value: '25' } }
  )
  expect(
    screen.getByRole('button', { name: 'Save check-in settings' })
  ).toBeEnabled()
  expect(screen.queryByText('User activity')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('incomplete history explains the transition and allows full rewards', async () => {
  await renderCheckin({
    ...eligibility,
    history_complete: false,
    reasons: ['history_incomplete'],
    recent_spend: 0,
    activity_percent: 0,
  })
  expect(
    screen.getByText(/Spending history is incomplete since/)
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check in now' }))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Claim this reward' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
  )
})

test('disabled limits with a zero cap can be saved without exposing hidden validation errors', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        ...configuration,
        settings: {
          ...configuration.settings,
          limits: { ...limits, monthly_cap: 0 },
        },
      },
    },
  })
  await renderSettings()
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Minimum check-in quota' }),
    { target: { value: '25' } }
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/api/option/checkin',
      expect.objectContaining({
        settings: expect.objectContaining({
          min_quota: 25,
          limits: expect.objectContaining({ enabled: false, monthly_cap: 0 }),
        }),
      })
    )
  )
})

test('a configuration conflict preserves edits until the administrator reloads the saved version', async () => {
  await renderSettings()
  const input = screen.getByRole('spinbutton', {
    name: 'Minimum check-in quota',
  })
  fireEvent.change(input, { target: { value: '25' } })
  vi.mocked(api.put).mockImplementationOnce(async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...configuration,
          version: 2,
          settings: { ...configuration.settings, min_quota: 50 },
        },
      },
    })
    return {
      data: {
        success: false,
        message: 'Check-in settings changed. Refresh before saving again.',
      },
    }
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  const reload = await screen.findByRole('button', { name: 'Reload settings' })
  expect(input).toHaveValue(25)
  expect(api.put).toHaveBeenLastCalledWith(
    '/api/option/checkin',
    expect.objectContaining({ version: 1 })
  )
  fireEvent.click(reload)
  expect(input).toHaveValue(50)
  fireEvent.change(input, { target: { value: '75' } })
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(api.put).toHaveBeenLastCalledWith(
      '/api/option/checkin',
      expect.objectContaining({ version: 2 })
    )
  )
})

test('expiring rewards show balances and expiry without activity restrictions, including after check-in is disabled', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const grants = {
    available: 40,
    reserved: 10,
    used: 30,
    expired: 20,
    as_of: 1792838400,
    records: [
      {
        checkin_id: 1,
        quota: 100,
        available: 40,
        reserved: 10,
        used: 30,
        expired: 20,
        created_at: 1792838400,
        expires_at: 1792842000,
      },
    ],
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: false,
        eligibility: {
          ...eligibility,
          mode: 2,
          expiry_seconds: 3600,
          allowed: false,
          limited: false,
          reasons: ['checkin_disabled'],
        },
        grants,
        stats: {
          checked_in_today: false,
          records: [],
          total_checkins: 1,
          checkin_count: 1,
          total_quota: 100,
        },
      },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinCalendarCard
        checkinEnabled={false}
        turnstileEnabled={false}
        turnstileSiteKey=''
      />
    </QueryClientProvider>
  )
  expect(await screen.findByText('Expiring check-in quota')).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Expires at' })).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Reserved quota' })
  ).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Used' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Expired' })).toBeVisible()
  expect(screen.queryByText(/Spending in the last/)).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Unused rewards expire automatically. Recharged quota is kept separately and is unaffected.'
    )
  ).toBeVisible()
  client.clear()
})

test.each([1, 2])(
  'method %s always shows its own reminder before claiming',
  async (mode) => {
    await renderCheckin({
      ...eligibility,
      mode,
      expiry_seconds: 3600,
      limited: mode === 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check in now' }))
    expect(api.post).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText(
        mode === 2 ? 'Method 2: Expiring rewards' : 'Method 1: Activity rewards'
      )
    ).toBeVisible()
    if (mode === 2) {
      expect(
        within(dialog).getByText('Reward validity: 60 minutes from claim time')
      ).toBeVisible()
    }
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Claim this reward' })
    )
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
    )
  }
)
