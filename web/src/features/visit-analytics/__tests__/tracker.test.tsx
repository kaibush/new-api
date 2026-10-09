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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { visitMetadata } from '../metadata'
import { VisitTracker } from '../tracker'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('visit metadata', () => {
  it('retains visitor identity and renews the analytics session after inactivity', () => {
    const first = visitMetadata('/dashboard/', 1000)
    const second = visitMetadata('/keys', 2000)
    const later = visitMetadata('/keys', 2000 + 31 * 60 * 1000)
    expect(first?.page).toBe('/dashboard')
    expect(second?.visitor).toBe(first?.visitor)
    expect(second?.session).toBe(first?.session)
    expect(later?.session).not.toBe(first?.session)
  })
  it('keeps only the referrer origin and respects Do Not Track', () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'https://search.example/private?token=secret#secret'
    )
    expect(visitMetadata('/')?.referrer).toBe('https://search.example')
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      value: '1',
    })
    expect(visitMetadata('/')).toBeNull()
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      value: undefined,
    })
  })
  it('counts SPA transitions once under StrictMode and sends route templates without private parameters', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 })
    const root = createRootRoute({
      component: () => (
        <>
          <VisitTracker />
          <Outlet />
        </>
      ),
    })
    const home = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <div>home</div>,
    })
    const chat = createRoute({
      getParentRoute: () => root,
      path: '/chat/$chatId',
      component: () => <div>chat</div>,
    })
    const router = createRouter({
      routeTree: root.addChildren([home, chat]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    await act(() =>
      router.navigate({ to: '/chat/$chatId', params: { chatId: 'private-id' } })
    )
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[1]?.[1]).toMatchObject({ page: '/chat/$chatId' })
    expect(JSON.stringify(post.mock.calls)).not.toContain('private-id')
    await act(() => router.navigate({ to: '/' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
  })
})
