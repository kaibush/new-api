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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ErrorFilterSection } from '..'
import { SettingsPageProvider } from '../../../components/settings-page-context'
import { errorFilterQueryKey } from '../api'
import { newRule, type ErrorFilterConfig } from '../lib/schema'

let client: QueryClient
let config: ErrorFilterConfig
let actions: HTMLDivElement
function renderSettings() {
  return render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <ErrorFilterSection />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  config = {
    enabled: false,
    fallback: 'preserve',
    fallback_message: '服务暂不可用',
    strip_details: true,
    remove_headers: ['X-Magpie-*'],
    rules: [],
  }
  actions = document.createElement('div')
  document.body.append(actions)
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: structuredClone(config) },
  }))
  vi.spyOn(api, 'put').mockImplementation(async (_url, data) => ({
    data: { success: true, data },
  }))
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        body: '{"error":{"message":"请求过大"}}',
        result: { action: 'replace', rule: 'Custom rule' },
      },
    },
  })
})
afterEach(() => {
  cleanup()
  actions.remove()
  client.clear()
  vi.restoreAllMocks()
})

describe('error masking settings', () => {
  it('adding a custom rule preserves arbitrary multiline text through save and reload', async () => {
    const view = renderSettings()
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable error masking' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Add error rule' })
    )
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'Rule name' }), {
      target: { value: 'Custom rule' },
    })
    fireEvent.change(dialog.getByRole('textbox', { name: 'Match pattern' }), {
      target: { value: 'tokenharbor:' },
    })
    fireEvent.change(
      dialog.getByRole('textbox', { name: 'Replacement message' }),
      { target: { value: '请求过大\n请精简对话，编号 {request_id}' } }
    )
    fireEvent.change(dialog.getByRole('textbox', { name: 'HTTP statuses' }), {
      target: { value: '413, 500-599' },
    })
    await userEvent.click(dialog.getByRole('button', { name: 'Apply rule' }))
    expect(
      await screen.findByRole('switch', { name: 'Custom rule' })
    ).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/api/option/error_filter',
        expect.objectContaining({
          enabled: true,
          rules: [
            expect.objectContaining({
              replacement: '请求过大\n请精简对话，编号 {request_id}',
              statuses: '413, 500-599',
            }),
          ],
        })
      )
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save Changes' })
      ).toBeDisabled()
    )
    const saved = client.getQueryData<ErrorFilterConfig>(errorFilterQueryKey)
    expect(saved).toBeDefined()
    if (!saved) throw new Error('Saved configuration is missing')
    config = saved
    view.unmount()
    client.removeQueries({ queryKey: errorFilterQueryKey })
    renderSettings()
    expect(
      await screen.findByRole('switch', { name: 'Custom rule' })
    ).toBeChecked()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit: Custom rule' })
    )
    expect(
      within(screen.getByRole('dialog')).getByRole('textbox', {
        name: 'Replacement message',
      })
    ).toHaveValue('请求过大\n请精简对话，编号 {request_id}')
  })

  it('reordering and disabling rules sends the visible priority order to preview without saving', async () => {
    config.rules = [
      {
        ...newRule(),
        name: 'First',
        pattern: 'provider',
        replacement: 'hidden',
      },
      {
        ...newRule(),
        name: 'Second',
        pattern: 'limit',
        replacement: '请求过大',
      },
    ]
    renderSettings()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move up: Second' })
    )
    const rows = within(
      screen.getByRole('list', { name: 'Error rules' })
    ).getAllByRole('listitem')
    expect(
      within(rows[0]).getByRole('switch', { name: 'Second' })
    ).toBeChecked()
    expect(
      within(rows[0]).getByRole('button', { name: 'Move up: Second' })
    ).toBeDisabled()
    await userEvent.click(screen.getByRole('switch', { name: 'First' }))
    await userEvent.click(
      screen.getByRole('switch', { name: 'Enable error masking' })
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Sample upstream message' }),
      { target: { value: 'future provider limit reached' } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Preview error' }))
    await screen.findByLabelText('Client response preview')
    expect(api.put).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith(
      '/api/option/error_filter/preview',
      expect.objectContaining({
        config: expect.objectContaining({
          enabled: true,
          rules: [
            expect.objectContaining({ name: 'Second' }),
            expect.objectContaining({ name: 'First', enabled: false }),
          ],
        }),
        sample: expect.objectContaining({
          message: 'future provider limit reached',
        }),
      })
    )
  })

  it('invalid replacement and status ranges prevent applying a rule', async () => {
    renderSettings()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add error rule' })
    )
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: 'Rule name' }), {
      target: { value: 'Invalid' },
    })
    fireEvent.change(dialog.getByRole('textbox', { name: 'HTTP statuses' }), {
      target: { value: '599-500' },
    })
    await userEvent.click(dialog.getByRole('button', { name: 'Apply rule' }))
    expect(await dialog.findByText('Invalid HTTP status range')).toBeVisible()
    expect(dialog.getByText('Replacement message is required')).toBeVisible()
    expect(
      dialog.getByRole('textbox', { name: 'HTTP statuses' })
    ).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('rejected saves preserve the draft and enable retry', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      data: { success: false, message: 'Invalid RE2 pattern' },
    })
    renderSettings()
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable error masking' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid RE2 pattern'
    )
    expect(
      screen.getByRole('switch', { name: 'Enable error masking' })
    ).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
  })

  it('background refreshes keep unsaved fallback messages', async () => {
    renderSettings()
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Fallback action' }),
      { target: { value: 'replace' } }
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Fallback message' }),
      { target: { value: 'draft fallback' } }
    )
    await act(async () => {
      await client.invalidateQueries({ queryKey: errorFilterQueryKey })
    })
    expect(
      screen.getByRole('textbox', { name: 'Fallback message' })
    ).toHaveValue('draft fallback')
  })

  it('a failed load shows retry without an editable fallback policy', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Unavailable'))
    renderSettings()
    expect(await screen.findByText('Failed to load settings')).toBeVisible()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('switch', { name: 'Enable error masking' })
    ).not.toBeChecked()
  })
  it('applying configuration JSON validates the draft without saving', async () => {
    renderSettings()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit configuration JSON' })
    )
    const dialog = within(screen.getByRole('dialog'))
    const editor = dialog.getByRole('textbox', { name: 'Error filter JSON' })
    fireEvent.input(editor, { target: { value: '{"enabled":' } })
    await userEvent.click(
      dialog.getByRole('button', { name: 'Apply configuration' })
    )
    expect(dialog.getByRole('alert')).toHaveTextContent('Invalid JSON')
    fireEvent.input(editor, {
      target: {
        value: JSON.stringify({
          ...config,
          enabled: true,
          fallback: 'replace',
          fallback_message: 'Custom fallback',
        }),
      },
    })
    await userEvent.click(
      dialog.getByRole('button', { name: 'Apply configuration' })
    )
    expect(
      await screen.findByRole('switch', { name: 'Enable error masking' })
    ).toBeChecked()
    expect(
      screen.getByRole('textbox', { name: 'Fallback message' })
    ).toHaveValue('Custom fallback')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('changing a preview sample clears the previous result', async () => {
    renderSettings()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Preview error' })
    )
    expect(
      await screen.findByLabelText('Client response preview')
    ).toBeVisible()
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Sample upstream message' }),
      { target: { value: 'A different provider error' } }
    )
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Client response preview')
      ).not.toBeInTheDocument()
    )
  })

  it('duplicating then deleting a rule keeps an independently editable copy', async () => {
    config.rules = [
      {
        ...newRule(),
        name: 'Original',
        pattern: 'quota',
        replacement: 'Unavailable',
      },
    ]
    renderSettings()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Duplicate: Original' })
    )
    await userEvent.click(
      screen.getByRole('switch', { name: 'Original (Copy)' })
    )
    expect(screen.getByRole('switch', { name: 'Original' })).toBeChecked()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete: Original' })
    )
    expect(
      screen.queryByRole('switch', { name: 'Original' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Original (Copy)' })
    ).not.toBeChecked()
    expect(api.put).not.toHaveBeenCalled()
  })
})
