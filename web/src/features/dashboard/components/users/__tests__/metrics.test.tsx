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
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { api } from '@/lib/api'

import { UserCharts } from '../user-charts'

// VChart's canvas renderer is a browser boundary; preserve the generated labels.
vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { spec: { title: { text: string; subtext: string } } }) => (
    <div>
      {props.spec.title.text}: {props.spec.title.subtext}
    </div>
  ),
}))

vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})
function Fixture() {
  const [filters, setFilters] = useState<UserChartsFilters>({
    timeGranularity: 'day',
    selectedRange: 7,
    topUserLimit: 10,
  })
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <UserCharts filters={filters} onFiltersChange={setFilters} />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  i18next.options.nsSeparator = false
})

afterEach(async () => {
  i18next.options.nsSeparator = ':'
  cleanup()
  client.clear()
  localStorage.clear()
  await i18next.changeLanguage('en')
})

it('switches from spending to token totals without fetching the same period again', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          username: 'bob',
          created_at: 1767225600,
          quota: 500000,
          token_used: 1500,
        },
      ],
    },
  })
  const user = userEvent.setup()
  render(<Fixture />)
  expect(
    await screen.findByText(/User Consumption Ranking: Total:/)
  ).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Token Usage' }))
  expect(
    await screen.findByText('User Token Ranking: Total: 1,500')
  ).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Token Usage' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(api.get).toHaveBeenCalledTimes(1)
  await act(async () => {
    await i18next.changeLanguage('vi')
  })
  expect(
    await screen.findByText('User Token Ranking: Total: 1.500')
  ).toBeVisible()
  await user.keyboard('{ArrowLeft}{Enter}')
  expect(
    screen.getByRole('tab', { name: 'Consumption Amount' })
  ).toHaveAttribute('aria-selected', 'true')
})

it('shows the token empty state when the selected period has no usage', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  const user = userEvent.setup()
  render(<Fixture />)
  await user.click(screen.getByRole('tab', { name: 'Token Usage' }))
  expect(
    await screen.findByText('User Token Ranking: No data available')
  ).toBeVisible()
})
