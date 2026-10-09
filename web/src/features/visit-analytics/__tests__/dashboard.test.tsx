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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { VisitReport } from '../api'
import { VisitAnalytics } from '../index'

let client: QueryClient
const report: VisitReport = {
  pv: 0,
  uv: 0,
  sessions: 0,
  users: 0,
  trend: [],
  pages: [],
  referrers: [],
  browsers: [],
  devices: [],
  systems: [],
  user_ranking: [],
}
function renderDashboard() {
  return render(
    <QueryClientProvider client={client}>
      <VisitAnalytics />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})

it('shows an empty dashboard and switches to disabled pagination when no visit details exist', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data:
        config?.params?.view === 'details' ? { items: [], total: 0 } : report,
    },
  }))
  const user = userEvent.setup()
  renderDashboard()
  await screen.findByText(
    'Visits will appear here after users browse the site.'
  )
  await user.click(screen.getByRole('tab', { name: 'Visit details' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeDisabled()
  )
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
})

it('applies the user filter to the report and detail requests', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data:
        config?.params?.view === 'details' ? { items: [], total: 0 } : report,
    },
  }))
  const user = userEvent.setup()
  renderDashboard()
  await screen.findByText(
    'Visits will appear here after users browse the site.'
  )
  await user.type(screen.getByLabelText('User ID'), '42')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/site-visits',
      expect.objectContaining({
        params: expect.objectContaining({ user_id: 42 }),
      })
    )
  )
  await user.click(screen.getByRole('tab', { name: 'Visit details' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/site-visits',
      expect.objectContaining({
        params: expect.objectContaining({
          user_id: 42,
          view: 'details',
          page: 1,
        }),
      })
    )
  )
})

it('shows a retry action after a failed analytics request', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
  const user = userEvent.setup()
  renderDashboard()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  get.mockResolvedValue({ data: { success: true, data: report } })
  await user.click(retry)
  await screen.findByText(
    'Visits will appear here after users browse the site.'
  )
})

it('paginates visit details and returns to the first page when the user filter changes', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data:
        config?.params?.view === 'details'
          ? {
              total: 51,
              items: [
                {
                  id: config.params.page,
                  created_at: 1791504000,
                  user_id: 42,
                  username: 'alice',
                  page: '/keys',
                  ip: '192.0.2.8',
                  referrer: '',
                  browser: 'Chrome',
                  os: 'Windows',
                  device: 'Desktop',
                  language: 'en-US',
                },
              ],
            }
          : report,
    },
  }))
  const user = userEvent.setup()
  renderDashboard()
  await screen.findByText(
    'Visits will appear here after users browse the site.'
  )
  await user.click(screen.getByRole('tab', { name: 'Visit details' }))
  await screen.findByText('alice (#42)')
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/site-visits',
      expect.objectContaining({
        params: expect.objectContaining({ view: 'details', page: 2 }),
      })
    )
  )
  await user.type(screen.getByLabelText('User ID'), '42')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/site-visits',
      expect.objectContaining({
        params: expect.objectContaining({
          user_id: 42,
          view: 'details',
          page: 1,
        }),
      })
    )
  )
})
