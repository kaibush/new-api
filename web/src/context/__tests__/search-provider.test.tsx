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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Search } from '@/components/search'

import { SearchProvider } from '../search-provider'

const originalAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterEach(() => {
  if (originalAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalAnimations
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

function SearchLayout() {
  return (
    <SearchProvider>
      <Search />
      <Outlet />
    </SearchProvider>
  )
}

it('opens search with a button or shortcut, navigates, and closes the command menu', async () => {
  const root = createRootRoute({ component: SearchLayout })
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <div>Start</div>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/keys',
      component: () => <h1>Keys destination</h1>,
    }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const user = userEvent.setup()
  render(<RouterProvider router={router} />)
  await user.click(await screen.findByRole('button', { name: 'Search' }))
  const search = screen.getByPlaceholderText('Type a command or search...')
  await user.type(search, 'API Keys')
  await user.click(await screen.findByRole('option', { name: 'API Keys' }))
  expect(
    await screen.findByRole('heading', { name: 'Keys destination' })
  ).toBeVisible()
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await user.keyboard('{Control>}k{/Control}')
  expect(await screen.findByRole('dialog')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
