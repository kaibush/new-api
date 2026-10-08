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
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DASHBOARD_CHART_PREFERENCES } from '@/features/dashboard/constants'
import type { DashboardFilters } from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelsFilter } from '../models-filter-dialog'

const currentFilters: DashboardFilters = {
  start_timestamp: new Date('2026-10-07T09:57:00Z'),
  end_timestamp: new Date('2026-10-08T09:57:00Z'),
  time_granularity: 'hour',
}
const onApply = vi.fn()
const onReset = vi.fn()
let client: QueryClient
let users: { id: number; username: string; display_name: string }[]
let serverPageSize: number
let failure: 'network' | 'business' | undefined
let pendingRequest: Promise<void> | undefined
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

function Fixture(props: { username?: string }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    ...currentFilters,
    username: props.username,
  })
  return (
    <QueryClientProvider client={client}>
      <ModelsFilter
        preferences={DEFAULT_DASHBOARD_CHART_PREFERENCES}
        currentFilters={filters}
        onFilterChange={(next) => {
          setFilters(next)
          onApply(next)
        }}
        onReset={() => {
          setFilters({ ...currentFilters, username: undefined })
          onReset()
        }}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  // jsdom does not implement the Web Animations API used by ScrollArea.
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  localStorage.clear()
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin',
    role: 10,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  users = [
    { id: 1, username: 'alice-dev', display_name: 'Alice' },
    { id: 2, username: 'bob', display_name: 'Bob' },
  ]
  serverPageSize = 100
  failure = undefined
  pendingRequest = undefined
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url !== '/api/user/') throw new Error(`Unexpected request: ${url}`)
    await pendingRequest
    if (failure === 'network') throw new Error('Network unavailable')
    if (failure === 'business') {
      return { data: { success: false, message: 'Users unavailable' } }
    }
    const page = Number(config?.params.p ?? 1)
    return {
      data: {
        success: true,
        data: {
          items: users.slice(
            (page - 1) * serverPageSize,
            page * serverPageSize
          ),
          total: users.length,
          page,
          page_size: serverPageSize,
        },
      },
    }
  })
})

afterEach(() => {
  cleanup()
  if (originalGetAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalGetAnimations
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  localStorage.clear()
})

describe('model analytics user filter', () => {
  it('loads on opening, matches username keywords locally and applies the selected username', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    expect(api.get).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const input = screen.getByRole('combobox', { name: 'Username' })
    await user.click(input)
    expect(await screen.findByRole('option', { name: 'bob' })).toBeVisible()
    await user.type(input, 'ICE')
    expect(screen.getByRole('option', { name: 'alice-dev' })).toBeVisible()
    expect(
      screen.queryByRole('option', { name: 'bob' })
    ).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('option', { name: 'alice-dev' }))
    expect(input).toHaveValue('alice-dev')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(onApply).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
    expect(onApply).toHaveBeenCalledWith({
      ...currentFilters,
      username: 'alice-dev',
    })
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('combobox', { name: 'Username' })).toHaveValue(
      'alice-dev'
    )
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('finds users beyond the first page and supports keyboard selection', async () => {
    serverPageSize = 1
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const input = screen.getByRole('combobox', { name: 'Username' })
    await user.click(input)
    expect(await screen.findByRole('option', { name: 'bob' })).toBeVisible()
    await user.type(input, 'ob')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('bob')
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'bob' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
    expect(onApply).toHaveBeenCalledWith({ ...currentFilters, username: 'bob' })
  })

  it('clears an applied username without changing the time filters', async () => {
    const user = userEvent.setup()
    render(<Fixture username='alice-dev' />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.clear(screen.getByRole('combobox', { name: 'Username' }))
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
    expect(onApply).toHaveBeenCalledWith(currentFilters)
  })

  it('resets an applied username with the other dashboard filters', async () => {
    const user = userEvent.setup()
    render(<Fixture username='alice-dev' />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('combobox', { name: 'Username' })).toHaveValue('')
  })

  it('shows no matches and still allows entering a historical username', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.type(
      screen.getByRole('combobox', { name: 'Username' }),
      'former-user'
    )
    expect(await screen.findByText('No results found')).toBeVisible()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
    expect(onApply).toHaveBeenCalledWith({
      ...currentFilters,
      username: 'former-user',
    })
  })

  it('shows loading and then an empty user list without disabling manual entry', async () => {
    users = []
    let resolveRequest = () => {}
    pendingRequest = new Promise<void>((resolve) => {
      resolveRequest = resolve
    })
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Loading...')
    expect(screen.getByRole('combobox', { name: 'Username' })).toBeEnabled()
    resolveRequest()
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('No Users Found')
    )
  })

  it.each(['network', 'business'] as const)(
    'keeps manual filtering available after a %s failure loading users',
    async (kind) => {
      failure = kind
      const user = userEvent.setup()
      render(<Fixture />)
      await user.click(screen.getByRole('button', { name: 'Filter' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to load users'
      )
      await user.type(screen.getByRole('combobox', { name: 'Username' }), 'bob')
      await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
      expect(onApply).toHaveBeenCalledWith({
        ...currentFilters,
        username: 'bob',
      })
    }
  )

  it('hides the user selector and does not request users for a regular account', async () => {
    useAuthStore.getState().auth.setUser({ id: 2, username: 'bob', role: 1 })
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(
      screen.queryByRole('combobox', { name: 'Username' })
    ).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })
})
