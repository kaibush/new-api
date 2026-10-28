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
  act,
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
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
  VChart: (props: { spec: { data: { values: { User: string }[] }[] } }) => (
    <div role='img' aria-label='User trend'>
      {[...new Set(props.spec.data[0].values.map((row) => row.User))].join(
        ', '
      )}
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

it('switches metrics and responds to locale changes without fetching the same period again', async () => {
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
    await screen.findByRole('table', { name: 'User Consumption Ranking' })
  ).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Usage Metric' }),
    'tokens'
  )
  const table = screen.getByRole('table', { name: 'User Token Ranking' })
  expect(within(table).getByText('1,500')).toBeVisible()
  expect(api.get).toHaveBeenCalledTimes(1)
  await act(async () => {
    await i18next.changeLanguage('vi')
  })
  expect(within(table).getByText('1.500')).toBeVisible()
  screen.getByRole('combobox', { name: 'Usage Metric' }).focus()
  await user.keyboard('{Tab}')
  expect(screen.getByRole('combobox', { name: 'Date Range' })).toHaveFocus()
})

it('shows the empty state when the selected period has no users', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  render(<Fixture />)
  expect(await screen.findByText('No data available')).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('changes the trend granularity without changing the selected date range', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  const user = userEvent.setup()
  render(<Fixture />)
  await screen.findByText('No data available')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Time Granularity' }),
    'week'
  )
  expect(screen.getByRole('combobox', { name: 'Date Range' })).toHaveValue('7')
  expect(
    screen.getByRole('combobox', { name: 'Time Granularity' })
  ).toHaveValue('week')
  expect(api.get).toHaveBeenCalledTimes(1)
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Date Range' }),
    '14'
  )
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  const request = vi.mocked(api.get).mock.calls[1][1]?.params
  expect(request.end_timestamp - request.start_timestamp).toBe(14 * 86400)
  expect(
    screen.getByRole('combobox', { name: 'Time Granularity' })
  ).toHaveValue('week')
})

it('shows exactly the selected top users in both ranking and trend and reports fewer available users', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          username: 'alice',
          created_at: 1767225600,
          token_used: 600,
          quota: 0,
        },
        { username: 'bob', created_at: 1767225600, token_used: 500, quota: 0 },
        {
          username: 'carol',
          created_at: 1767225600,
          token_used: 400,
          quota: 0,
        },
        { username: 'dave', created_at: 1767225600, token_used: 300, quota: 0 },
        { username: 'eve', created_at: 1767225600, token_used: 200, quota: 0 },
        {
          username: 'frank',
          created_at: 1767225600,
          token_used: 100,
          quota: 500000,
        },
        {
          username: 'alice',
          created_at: 1767312000,
          token_used: 100,
          quota: 0,
        },
      ],
    },
  })
  const user = userEvent.setup()
  render(<Fixture />)
  await screen.findByRole('table')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Usage Metric' }),
    'tokens'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Users to display' }),
    '5'
  )
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(6)
  expect(within(table).queryByText('frank')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'User trend' })).toHaveTextContent(
    /^alice, bob, carol, dave, eve$/
  )
  expect(screen.getByRole('status')).toHaveTextContent('Showing 5 of 6 users')
  expect(screen.getByText('2,200')).toBeVisible()
  expect(screen.getByText('2,100')).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Users to display' }),
    '20'
  )
  expect(within(table).getAllByRole('row')).toHaveLength(7)
  expect(screen.getByRole('status')).toHaveTextContent('Showing 6 of 6 users')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Users to display' }),
    '5'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Usage Metric' }),
    'quota'
  )
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('frank')
  expect(screen.getByRole('img', { name: 'User trend' })).toHaveTextContent(
    /^frank, alice, bob, carol, dave$/
  )
  expect(api.get).toHaveBeenCalledTimes(1)
})

it('preserves long usernames and places filters in a responsive grid without horizontal scrolling', async () => {
  const username = 'a-very-long-user-name-that-must-remain-readable-on-mobile'
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [{ username, created_at: 1767225600, token_used: 807902277 }],
    },
  })
  const user = userEvent.setup()
  render(<Fixture />)
  const table = await screen.findByRole('table')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Usage Metric' }),
    'tokens'
  )
  expect(within(table).getByText(username)).toHaveClass(
    'break-all',
    'whitespace-normal'
  )
  const value = within(table).getByText('807,902,277')
  expect(value.closest('.truncate')).toBeNull()
  expect(value.closest('td')).toHaveClass('whitespace-normal', 'break-all')
  expect(screen.getByText('All users total').closest('dl')).toHaveClass(
    'grid-cols-1',
    'sm:grid-cols-2'
  )
  const ranking = screen.getByRole('region', { name: 'User Token Ranking' })
  expect(ranking).toHaveClass('overflow-y-auto', 'max-h-[32rem]')
  ranking.focus()
  expect(ranking).toHaveFocus()
  expect(screen.getByRole('list', { name: 'Displayed users' })).toHaveAttribute(
    'tabindex',
    '0'
  )
  const filters = screen
    .getByRole('combobox', { name: 'Usage Metric' })
    .closest('[data-slot="field-group"]')
  expect(filters).toHaveClass(
    'grid',
    'grid-cols-1',
    'min-[360px]:grid-cols-2',
    'lg:grid-cols-4'
  )
  expect(filters).not.toHaveClass('overflow-x-auto')
})

it.each(['network', 'business'])(
  'shows a retry action after a %s failure and displays recovered data',
  async (failure) => {
    const request = vi.spyOn(api, 'get')
    if (failure === 'network') {
      request.mockRejectedValueOnce(new Error('offline'))
    } else {
      request.mockResolvedValueOnce({
        data: { success: false, message: 'Data unavailable', data: [] },
      })
    }
    request.mockResolvedValueOnce({
      data: {
        success: true,
        data: [{ username: 'alice', created_at: 1767225600, quota: 500000 }],
      },
    })
    const user = userEvent.setup()
    render(<Fixture />)
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  }
)
