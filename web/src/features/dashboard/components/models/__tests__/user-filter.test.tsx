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
import { buildQueryParams } from '@/features/dashboard/lib/filters'
import type { DashboardFilters } from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelsFilter, ModelsQuickFilter } from '../models-filter-dialog'

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
  it('opens the user list from the dropdown button while preserving the applied username', async () => {
    const user = userEvent.setup()
    render(<Fixture username='alice-dev' />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Username' }))
    const input = screen.getByRole('combobox', { name: 'Username' })
    expect(input).toHaveValue('alice-dev')
    expect(await screen.findByRole('option', { name: 'bob' })).toBeVisible()
    await user.click(screen.getByRole('option', { name: 'bob' }))
    expect(input).toHaveValue('bob')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

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
      await user.tab()
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

function QuickFixture() {
  const [filters, setFilters] = useState<DashboardFilters>(currentFilters)
  return (
    <QueryClientProvider client={client}>
      <ModelsQuickFilter
        filters={filters}
        onFiltersChange={(next) => {
          setFilters(next)
          onApply(next)
        }}
      />
    </QueryClientProvider>
  )
}

describe('visible model analytics filters', () => {
  it('selects a user without opening a filter dialog or typing a username', async () => {
    const user = userEvent.setup()
    render(<QuickFixture />)
    await user.click(screen.getByRole('button', { name: 'Username' }))
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    expect(onApply).toHaveBeenLastCalledWith({
      ...currentFilters,
      username: 'bob',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('changes the quick range while preserving the selected username', async () => {
    const user = userEvent.setup()
    render(<QuickFixture />)
    await user.click(screen.getByRole('button', { name: 'Username' }))
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    await user.click(screen.getByRole('tab', { name: '7 Days' }))
    const filters = onApply.mock.lastCall?.[0] as DashboardFilters
    expect(filters.username).toBe('bob')
    expect(filters.time_granularity).toBe('day')
    expect(
      Number(filters.end_timestamp?.getTime()) -
        Number(filters.start_timestamp?.getTime())
    ).toBe(7 * 86400000)
    expect(screen.getByRole('tab', { name: '7 Days' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

describe('responsive quick user filtering', () => {
  it('searches locally without applying partial usernames, then applies a keyboard selection', async () => {
    const user = userEvent.setup()
    render(<QuickFixture />)
    const input = screen.getByRole('combobox', { name: 'Username' })
    await user.click(input)
    await screen.findByRole('option', { name: 'bob' })
    await user.type(input, 'ob')
    expect(onApply).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledTimes(1)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onApply).toHaveBeenLastCalledWith({
      ...currentFilters,
      username: 'bob',
    })
    expect(input).toHaveValue('bob')
  })

  it('restores the applied username when search is dismissed and clears it with one tap', async () => {
    const user = userEvent.setup()
    render(<QuickFixture />)
    const input = screen.getByRole('combobox', { name: 'Username' })
    await user.click(input)
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    onApply.mockClear()
    await user.click(input)
    await user.type(input, 'alice')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('bob')
    expect(onApply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onApply).toHaveBeenLastCalledWith({
      ...currentFilters,
      username: undefined,
    })
    expect(input).toHaveValue('')
  })

  it('keeps long usernames selectable with mobile touch targets and bounded scrolling', async () => {
    const longName =
      'user-with-a-very-long-username-that-must-stay-inside-the-phone-screen'
    users = [{ id: 2, username: longName, display_name: '' }]
    const user = userEvent.setup()
    render(<QuickFixture />)
    const input = screen.getByRole('combobox', { name: 'Username' })
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input.closest('[data-slot=input-group]')).toHaveClass(
      'h-12',
      'md:h-8'
    )
    await user.click(input)
    const option = await screen.findByRole('option', { name: longName })
    expect(option).toHaveClass('min-h-11')
    expect(screen.getByText(longName)).toHaveClass('break-all')
    expect(screen.getByRole('listbox')).toHaveClass(
      'overflow-y-auto',
      'overscroll-contain'
    )
    await user.click(option)
    expect(input).toHaveValue(longName)
  })

  it('keeps desktop day presets on one line and aligns them with the username field', () => {
    render(<QuickFixture />)
    const tablist = screen.getByRole('tablist', { name: 'Quick Range' })
    expect(tablist).not.toHaveClass('grid-cols-2')
    expect(tablist.parentElement).toHaveClass('shrink-0')
    expect(tablist.parentElement?.parentElement).toHaveClass(
      'md:flex-row',
      'md:items-center'
    )
    const presets = screen.getAllByRole('tab')
    expect(presets.map((tab) => tab.textContent)).toEqual([
      '1 Day',
      '7 Days',
      '14 Days',
      '29 Days',
    ])
    for (const preset of presets) {
      expect(preset).toHaveClass('px-2.5', 'text-xs', 'whitespace-nowrap')
      expect(preset).not.toHaveClass('whitespace-normal')
    }
    expect(
      screen
        .getByRole('combobox', { name: 'Username' })
        .closest('[data-slot=input-group]')
    ).toHaveClass('h-12', 'md:h-8')
  })

  it('shows lookup failures while leaving the time range usable', async () => {
    failure = 'network'
    const user = userEvent.setup()
    render(<QuickFixture />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load users'
    )
    await user.click(screen.getByRole('tab', { name: '7 Days' }))
    expect(onApply.mock.lastCall?.[0].time_granularity).toBe('day')
  })
})

it.each(['pointer', 'keyboard'] as const)(
  'returns to all users when the searched selected user is unchecked with %s',
  async (method) => {
    const user = userEvent.setup()
    render(<QuickFixture />)
    const input = screen.getByRole('combobox', { name: 'Username' })
    await user.click(input)
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    await user.click(input)
    await user.type(input, 'bo')
    const selected = screen.getByRole('option', { name: 'bob' })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    if (method === 'pointer') await user.click(selected)
    else await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('')
    const filters = onApply.mock.lastCall?.[0] as DashboardFilters
    expect(filters).toEqual({ ...currentFilters, username: undefined })
    expect(
      buildQueryParams({ start_timestamp: 100, end_timestamp: 200 }, filters)
    ).toEqual({
      start_timestamp: 100,
      end_timestamp: 200,
      default_time: 'hour',
    })
    await user.click(input)
    expect(screen.getByRole('option', { name: 'bob' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.getByRole('option', { name: 'alice-dev' })).toBeVisible()
  }
)
