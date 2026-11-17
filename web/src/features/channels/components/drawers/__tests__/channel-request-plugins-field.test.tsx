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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import {
  REQUEST_PLUGIN_INSTANCES_QUERY_KEY,
  REQUEST_PLUGIN_OPTIONS_QUERY_KEY,
} from '@/features/task-plugins/lib/request-plugins'

import { ChannelRequestPluginsField } from '../channel-request-plugins-field'

vi.mock('@/lib/lobe-icon', () => ({ getLobeIcon: () => null }))
afterEach(cleanup)

async function setup(disabled = false) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(REQUEST_PLUGIN_INSTANCES_QUERY_KEY, [
    { id: 'first', name: 'Filter', plugin: 'filter', enabled: true },
    { id: 'second', name: 'Redact', plugin: 'redact', enabled: false },
  ])
  client.setQueryData(REQUEST_PLUGIN_OPTIONS_QUERY_KEY, [])
  const onChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ChannelRequestPluginsField
          value={['first', 'second']}
          onChange={onChange}
          disabled={disabled}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return onChange
}

test('reordering and removing named instances preserve their IDs', async () => {
  const onChange = await setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Move Filter down' }))
  expect(onChange).toHaveBeenLastCalledWith(['second', 'first'])
  await user.click(screen.getByRole('button', { name: 'Remove Redact' }))
  expect(onChange).toHaveBeenLastCalledWith(['first'])
})

test('a disabled channel binding prevents additions, reordering and removal', async () => {
  const onChange = await setup(true)
  const user = userEvent.setup()
  for (const name of [
    'Move Filter down',
    'Remove Redact',
    'Drag Filter to reorder',
  ]) {
    const button = screen.getByRole('button', { name })
    expect(button).toBeDisabled()
    await user.click(button)
  }
  expect(
    screen.getByRole('combobox', { name: 'Add an instance' })
  ).toBeDisabled()
  expect(onChange).not.toHaveBeenCalled()
})
