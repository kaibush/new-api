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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { UserIdentity } from '@/components/user-identity'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

let client: QueryClient

function login(id = 1, role = 10, sid = 'admin-session') {
  useAuthStore.getState().auth.setBundle({
    access_token: 'test-session-token',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user: { id, role, username: 'operator' },
    session: {
      sid,
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
}

function show(children: ReactNode) {
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  login()
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.restoreAllMocks()
})

it('batches visible users and reuses cached names across components and remounts', async () => {
  const request = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        { id: 2, username: 'alice' },
        { id: 3, username: 'bob' },
      ],
    },
  })
  const view = show(
    <>
      <UserIdentity userId={2} />
      <UserIdentity userId={3} />
      <UserIdentity userId={2} />
    </>
  )
  expect(await screen.findAllByText('alice (#2)')).toHaveLength(2)
  expect(screen.getByText('bob (#3)')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('/api/user/names', {
    params: { ids: '2,3' },
  })
  view.unmount()
  show(<UserIdentity userId={2} />)
  expect(screen.getByText('alice (#2)')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
})

it('uses supplied usernames and leaves invalid IDs unresolved without requests', () => {
  const request = vi.spyOn(api, 'get')
  show(
    <>
      <UserIdentity userId={2} username='known-user' />
      <span>
        <UserIdentity userId={0} />
      </span>
      <span>
        <UserIdentity userId={Number.NaN} />
      </span>
    </>
  )
  expect(screen.getByText('known-user (#2)')).toBeInTheDocument()
  expect(screen.getAllByText('-')).toHaveLength(2)
  expect(request).not.toHaveBeenCalled()
})

it('reuses names for an hour and refreshes them on the next visit after expiry', async () => {
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const request = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: [{ id: 42, username: 'previous-name' }] },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: [{ id: 42, username: 'updated-name' }] },
    })
  const firstVisit = show(<UserIdentity userId={42} />)
  await screen.findByText('previous-name (#42)')
  firstVisit.unmount()

  clock.mockReturnValue(now + 30 * 60_000)
  const nextVisit = show(<UserIdentity userId={42} />)
  expect(screen.getByText('previous-name (#42)')).toBeInTheDocument()
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(request).toHaveBeenCalledTimes(1)
  nextVisit.unmount()

  clock.mockReturnValue(now + 61 * 60_000)
  show(<UserIdentity userId={42} />)
  expect(await screen.findByText('updated-name (#42)')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})

it('keeps missing usernames as IDs and caches the missing result', async () => {
  const request = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [] },
  })
  const view = show(<UserIdentity userId={42} />)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(screen.getByText('#42')).toBeInTheDocument()
  view.unmount()
  show(<UserIdentity userId={42} />)
  expect(request).toHaveBeenCalledTimes(1)
  expect(screen.getByText('#42')).toBeInTheDocument()
})

it.each(['network', 'business'])(
  'keeps the ID when the %s lookup fails',
  async (failure) => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const request = vi.spyOn(api, 'get')
    if (failure === 'network') {
      request.mockRejectedValue(new Error('Offline'))
    } else {
      request.mockResolvedValue({
        data: { success: false, message: 'Unavailable' },
      })
    }
    const view = show(<UserIdentity userId={42} />)
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    view.unmount()

    clock.mockReturnValue(now + 6 * 60_000)
    request.mockResolvedValue({
      data: { success: true, data: [{ id: 42, username: 'recovered-user' }] },
    })
    show(<UserIdentity userId={42} />)
    expect(await screen.findByText('recovered-user (#42)')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
  }
)

it('truncates a long username while keeping the full escaped label available', () => {
  const username = '<b>long-unbroken-username</b>'
  show(<UserIdentity userId={42} username={username} />)
  const label = screen.getByText(`${username} (#42)`)
  expect(label).toHaveAttribute('title', `${username} (#42)`)
  expect(label).toHaveClass('inline-block', 'max-w-full', 'truncate')
  expect(label.querySelector('b')).toBeNull()
})

it.each(['guest', 'member', 'no session'])(
  'does not query user information for %s',
  async (kind) => {
    if (kind === 'guest') useAuthStore.getState().auth.reset()
    else if (kind === 'member') login(1, 1)
    else {
      useAuthStore.getState().auth.reset()
      useAuthStore
        .getState()
        .auth.setUser({ id: 1, role: 10, username: 'operator' })
    }
    const request = vi.spyOn(api, 'get')
    show(<UserIdentity userId={42} />)
    await act(async () => {})
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  }
)

it('hides cached names immediately after administrator privileges are removed', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [{ id: 42, username: 'private-user' }] },
  })
  show(<UserIdentity userId={42} />)
  expect(await screen.findByText('private-user (#42)')).toBeInTheDocument()
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, role: 1, username: 'operator' })
  )
  expect(screen.getByText('#42')).toBeInTheDocument()
  expect(screen.queryByText('private-user (#42)')).not.toBeInTheDocument()
})

it('does not reuse names when the administrator switches login sessions', async () => {
  const request = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: [{ id: 42, username: 'previous-name' }] },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: [{ id: 42, username: 'updated-name' }] },
    })
  show(<UserIdentity userId={42} />)
  await screen.findByText('previous-name (#42)')
  act(() => login(1, 10, 'new-session'))
  expect(screen.queryByText('previous-name (#42)')).not.toBeInTheDocument()
  expect(await screen.findByText('updated-name (#42)')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})

it('discards an in-flight username response after logout', async () => {
  let completeRequest = () => {}
  const response = new Promise<Awaited<ReturnType<typeof api.get>>>(
    (resolve) => {
      completeRequest = () =>
        resolve({
          data: { success: true, data: [{ id: 42, username: 'private-user' }] },
        })
    }
  )
  const request = vi.spyOn(api, 'get').mockReturnValue(response)
  show(<UserIdentity userId={42} />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  act(() => useAuthStore.getState().auth.reset())
  await act(async () => {
    completeRequest()
    await response
  })
  expect(screen.getByText('#42')).toBeInTheDocument()
  expect(screen.queryByText('private-user (#42)')).not.toBeInTheDocument()
})

it('splits a large visible list at the server batch limit', async () => {
  const request = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [] },
  })
  show(
    Array.from({ length: 101 }, (_, i) => (
      <UserIdentity key={i} userId={i + 1} />
    ))
  )
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(request).toHaveBeenCalledTimes(2)
  const sizes = request.mock.calls.map(
    (call) => call[1]?.params.ids.split(',').length
  )
  expect(sizes).toEqual([100, 1])
})
