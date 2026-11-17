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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { UserSelector } from '@/components/user-selector'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})
function Picker(props: {
  disabled?: boolean
  onChange: (id: number | undefined) => void
}) {
  const [value, setValue] = useState<number>()
  return (
    <UserSelector
      value={value}
      disabled={props.disabled}
      onChange={(id) => {
        setValue(id)
        props.onChange(id)
      }}
    />
  )
}

it('search keeps display names and IDs distinct and supports keyboard selection and clearing', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          { id: 4, username: 'alice' },
          { id: 8, username: 'alice-test' },
        ],
      },
    },
  })
  const change = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <Picker onChange={change} />
    </QueryClientProvider>
  )
  expect(get).not.toHaveBeenCalled()
  const input = screen.getByRole('combobox', {
    name: 'Search users by name or ID',
  })
  await userEvent.click(input)
  await userEvent.type(input, 'alice')
  expect(change).not.toHaveBeenCalled()
  await screen.findByRole('option', { name: 'alice (#4)' })
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(change).toHaveBeenCalledWith(4)
  expect(input).toHaveValue('alice (#4)')
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(change).toHaveBeenLastCalledWith(undefined)
  expect(input).toHaveValue('')
})

it('disabled selectors do not fetch and failed searches never accept typed names as IDs', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
  const change = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <Picker disabled onChange={change} />
    </QueryClientProvider>
  )
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(get).not.toHaveBeenCalled()
  view.rerender(
    <QueryClientProvider client={client}>
      <Picker onChange={change} />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.type(screen.getByRole('combobox'), 'missing-user')
  await waitFor(() =>
    expect(screen.getByText('Failed to load users')).toBeVisible()
  )
  await userEvent.keyboard('{Enter}')
  expect(change).not.toHaveBeenCalled()
})
