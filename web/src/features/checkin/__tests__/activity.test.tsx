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
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CheckinActivityPanel } from '../components/activity-panel'
import type { CheckinEligibility, CheckinUserQuery } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

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
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/user/2/checkin'
          ? {
              user: activeUser,
              days: [],
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
  }))
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinActivityPanel />
    </QueryClientProvider>
  )
}

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
