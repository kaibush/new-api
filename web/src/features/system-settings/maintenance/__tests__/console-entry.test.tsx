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
import {
  getAvailableConsolePages,
  getConsoleLandingForGuard,
  parseConsoleDefaultPage,
  resolveConsoleLanding,
} from '@/lib/console-landing'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { SettingsPageProvider } from '../../components/settings-page-context'
import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '../config'
import { SidebarModulesSection } from '../sidebar-modules-section'

let client: QueryClient
let actions: HTMLDivElement
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  actions = document.createElement('div')
  document.body.append(actions)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'root',
    role: ROLE.SUPER_ADMIN,
    permissions: { sidebar_settings: false },
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  actions.remove()
  useAuthStore.getState().auth.reset()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function renderSettings(enabled: boolean) {
  client.setQueryData(['status'], { SidebarModulesAdmin: '{}' })
  client.setQueryData(['community-status'], { enabled, name: '' })
  const config = parseSidebarModulesAdmin('')
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <SidebarModulesSection
          config={config}
          initialSerialized={serializeSidebarModulesAdmin(
            config,
            '/dashboard/overview'
          )}
          defaultPage='/dashboard/overview'
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

it('saves community as the default console destination together with sidebar visibility', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  renderSettings(true)
  const select = screen.getByRole('combobox', { name: 'Default console page' })
  await user.selectOptions(select, '/community')
  await user.click(screen.getByRole('button', { name: 'Save sidebar modules' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  const request = put.mock.calls[0][1] as { key: string; value: string }
  expect(request.key).toBe('SidebarModulesAdmin')
  expect(JSON.parse(request.value)).toMatchObject({
    default_page: '/community',
    chat: { community: true },
  })
  expect(resolveConsoleLanding(request.value, { role: ROLE.USER }, true)).toBe(
    '/community'
  )
  expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
})

it('disables community as a destination when its feature or sidebar entry is off', async () => {
  const user = userEvent.setup()
  renderSettings(false)
  expect(screen.getByRole('option', { name: 'Community chat' })).toBeDisabled()
  client.setQueryData(['community-status'], { enabled: true })
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Community chat' })).toBeEnabled()
  )
  await user.click(screen.getByRole('switch', { name: 'Community chat' }))
  expect(screen.getByRole('option', { name: 'Community chat' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Reset to default' }))
  expect(screen.getByRole('switch', { name: 'Community chat' })).toBeChecked()
  expect(
    screen.getByRole('combobox', { name: 'Default console page' })
  ).toHaveValue('/dashboard/overview')
})

it('retains the selected destination when saving fails', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message: 'storage unavailable' },
  })
  const user = userEvent.setup()
  renderSettings(true)
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Default console page' }),
    '/community'
  )
  await user.click(screen.getByRole('button', { name: 'Save sidebar modules' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save sidebar modules' })
    ).toBeEnabled()
  )
  expect(
    screen.getByRole('combobox', { name: 'Default console page' })
  ).toHaveValue('/community')
})

it.each([
  '',
  'null',
  'invalid',
  '{"default_page":"https://example.com"}',
  '{"default_page":"//example.com"}',
  '{"default_page":"/dashboard"}',
  '{"default_page":"/sign-in"}',
])(
  'falls back to overview for a legacy or invalid default setting: %s',
  (raw) => {
    expect(parseConsoleDefaultPage(raw)).toBe('/dashboard/overview')
    expect(resolveConsoleLanding(raw, { role: ROLE.USER }, true)).toBe(
      '/dashboard/overview'
    )
  }
)

it('falls back when community is disabled or hidden and respects user-specific visibility', () => {
  const enabled = JSON.stringify({
    default_page: '/community',
    chat: { enabled: true, community: true },
  })
  expect(resolveConsoleLanding(enabled, { role: ROLE.USER }, false)).toBe(
    '/dashboard/overview'
  )
  expect(
    resolveConsoleLanding(
      enabled,
      { sidebar_modules: '{"chat":{"community":false}}' },
      true
    )
  ).toBe('/dashboard/overview')
  expect(
    resolveConsoleLanding(
      enabled,
      {
        permissions: { sidebar_settings: false },
        sidebar_modules: '{"chat":{"community":false}}',
      },
      true
    )
  ).toBe('/community')
  expect(
    resolveConsoleLanding(
      '{"default_page":"/community","chat":{"enabled":false}}',
      {},
      true
    )
  ).toBe('/dashboard/overview')
})

it('limits administrative destinations by role and uses a reachable fallback if overview is hidden', () => {
  const config = JSON.stringify({ default_page: '/system-info' })
  expect(resolveConsoleLanding(config, { role: ROLE.USER }, false)).toBe(
    '/dashboard/overview'
  )
  expect(resolveConsoleLanding(config, { role: ROLE.ADMIN }, false)).toBe(
    '/dashboard/overview'
  )
  expect(resolveConsoleLanding(config, { role: ROLE.SUPER_ADMIN }, false)).toBe(
    '/system-info'
  )
  expect(
    getAvailableConsolePages('{}', { role: ROLE.USER }, true).some(
      (page) => page.url === '/users'
    )
  ).toBe(false)
  expect(
    resolveConsoleLanding(
      '{"console":{"enabled":false},"chat":{"enabled":false}}',
      { role: ROLE.USER },
      false
    )
  ).toBe('/wallet')
  expect(
    resolveConsoleLanding(
      '{"console":{"enabled":false},"chat":{"enabled":false},"personal":{"enabled":false},"admin":{"enabled":false}}',
      { role: ROLE.SUPER_ADMIN },
      false
    )
  ).toBe('/profile')
})

it('allows the combined task logs destination while either of its sidebar modules is visible', () => {
  const config = JSON.stringify({
    default_page: '/usage-logs/task',
    console: { enabled: true, task: false, midjourney: true },
  })
  expect(resolveConsoleLanding(config, { role: ROLE.USER }, false)).toBe(
    '/usage-logs/task'
  )
  expect(
    resolveConsoleLanding(
      config,
      { role: ROLE.USER, sidebar_modules: '{"console":{"midjourney":false}}' },
      false
    )
  ).toBe('/dashboard/overview')
})

it('refreshes invalidated settings before resolving console entry and reuses fresh status queries', async () => {
  client.setQueryData(['status'], { SidebarModulesAdmin: '{}' })
  await client.invalidateQueries({ queryKey: ['status'] })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { SidebarModulesAdmin: '{"default_page":"/community"}' }
          : { enabled: true },
    },
  }))
  expect(await getConsoleLandingForGuard(client, { role: ROLE.USER })).toBe(
    '/community'
  )
  expect(await getConsoleLandingForGuard(client, { role: ROLE.USER })).toBe(
    '/community'
  )
  expect(get).toHaveBeenCalledTimes(2)
  await client.invalidateQueries({ queryKey: ['community-status'] })
  get.mockRejectedValueOnce(new Error('chat unavailable'))
  expect(await getConsoleLandingForGuard(client, { role: ROLE.USER })).toBe(
    '/dashboard/overview'
  )
})
