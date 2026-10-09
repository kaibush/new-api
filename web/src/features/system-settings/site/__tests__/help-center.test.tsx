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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { HelpCenterSection } from '../help-center-section'

afterEach(() =>
  document
    .querySelectorAll('[data-help-actions]')
    .forEach((element) => element.remove())
)

it('saves reordered and hidden help content through the existing settings API', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const actions = document.createElement('div')
  actions.dataset.helpActions = 'true'
  document.body.append(actions)
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <HelpCenterSection
          defaultValue={JSON.stringify({
            version: 1,
            items: [
              {
                id: 'guide',
                title: 'Guide',
                kind: 'markdown',
                content: '# Client setup',
                enabled: true,
              },
              {
                id: 'bird',
                title: 'Bird',
                kind: 'html',
                content: '<svg></svg>',
                enabled: true,
              },
            ],
          })}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await user.click(
    within(screen.getByRole('group', { name: 'Bird' })).getByRole('button', {
      name: 'Move up',
    })
  )
  await user.click(
    within(screen.getByRole('group', { name: 'Guide' })).getByRole('switch', {
      name: 'Visible',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  const request = put.mock.calls[0][1] as { key: string; value: string }
  expect(request.key).toBe('HelpCenter')
  expect(JSON.parse(request.value).items).toEqual([
    {
      id: 'bird',
      title: 'Bird',
      kind: 'html',
      content: '<svg></svg>',
      enabled: true,
    },
    {
      id: 'guide',
      title: 'Guide',
      kind: 'markdown',
      content: '# Client setup',
      enabled: false,
    },
  ])
  client.clear()
})

it('blocks invalid titles without submitting and supports adding a new item', async () => {
  const put = vi.spyOn(api, 'put')
  const actions = document.createElement('div')
  actions.dataset.helpActions = 'true'
  document.body.append(actions)
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <HelpCenterSection defaultValue='{"version":1,"items":[]}' />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Add help item' }))
  await user.clear(screen.getByRole('textbox', { name: 'Title' }))
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  client.clear()
})
