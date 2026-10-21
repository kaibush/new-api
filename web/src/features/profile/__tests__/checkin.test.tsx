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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { CheckinSettingsSection } from '@/features/system-settings/general/checkin-settings-section'
import { api } from '@/lib/api'

import { CheckinCalendarCard } from '../components/checkin-calendar-card'
import type { CheckinEligibility } from '../types'

const eligibility: CheckinEligibility = {
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
  gift_cap: 100,
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
  return screen.findByText(
    'Purchased and legacy balances do not affect check-in limits.'
  )
}

beforeEach(() => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { quota_awarded: 10 } },
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

test.each(['gift_cap', 'monthly_cap', 'accounting_pending'])(
  'a %s restriction explains why and prevents a claim',
  async (reason) => {
    await renderCheckin({ ...eligibility, allowed: false, reasons: [reason] })
    const button = screen.getByRole('button', { name: 'Check in now' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(api.post).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Check-in rewards are currently paused. No check-in has been used today.'
      )
    ).toBeInTheDocument()
  }
)

test('reduced rewards explain the percentage and remain claimable', async () => {
  await renderCheckin({
    ...eligibility,
    reward_percent: 20,
    reasons: ['low_activity'],
  })
  expect(
    screen.getByText(
      'Recent spending is below the threshold. Rewards are reduced to 20%.'
    )
  ).toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Check in now' })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/checkin')
  )
})

function SettingsFixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <CheckinSettingsSection
          defaultValues={{
            enabled: true,
            minQuota: 10,
            maxQuota: 100,
            limits: JSON.stringify(limits),
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: SettingsFixture }),
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
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Monthly check-in reward cap' }),
    { target: { value: '300' } }
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'checkin_setting.limits',
      value: JSON.stringify({ ...limits, enabled: true, monthly_cap: 300 }),
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('out-of-range percentages cannot be saved', async () => {
  fireEvent.click(await renderSettings())
  const input = screen.getByRole('spinbutton', {
    name: 'Low-activity reward percentage',
  })
  fireEvent.change(input, { target: { value: '101' } })
  fireEvent.click(
    screen.getByRole('button', { name: 'Save check-in settings' })
  )
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(api.put).not.toHaveBeenCalled()
})
