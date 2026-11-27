import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../components/settings-page-context'
import { CatalogVisibilityPage } from './catalog-visibility'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('revokes an account without removing resource restrictions or changing pricing groups', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path) => ({
    data: {
      success: true,
      data: path === '/api/group/' ? ['default', 'private-route'] : ['preview'],
    },
  }))
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const saved = {
    audiences: { staff: [22] },
    models: { preview: ['staff'] },
    groups: { 'private-route': ['staff'] },
  }
  function Editor() {
    const [actions, setActions] = useState<HTMLDivElement | null>(null)
    return (
      <SettingsPageProvider actionsContainer={actions}>
        <div ref={setActions} />
        <CatalogVisibilityPage saved={JSON.stringify(saved)} />
      </SettingsPageProvider>
    )
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Editor }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const remove = await screen.findByRole('button', { name: 'Remove user #22' })
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  await user.click(remove)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const [path, request] = put.mock.calls[0]
  expect(path).toBe('/api/option/')
  expect(request).toMatchObject({ key: 'CatalogVisibility' })
  expect(JSON.parse((request as { value: string }).value)).toEqual({
    ...saved,
    audiences: { staff: [] },
  })
  view.unmount()
  client.clear()
})
