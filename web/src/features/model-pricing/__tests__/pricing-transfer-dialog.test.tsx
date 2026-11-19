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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'

import type { ModelPricingEntry } from '../api'
import type { PricingValues } from '../pricing'
import { exportModelPricing } from '../pricing-transfer'
import { PricingTransferDialog } from '../pricing-transfer-dialog'

let client: QueryClient | undefined
const entry: ModelPricingEntry = {
  model_name: 'target',
  version: 'target-version',
  configured: { ModelPrice: 1 },
  effective: { ModelPrice: 1 },
}
const expression =
  '(len <= 200000 ? tier("short", p * 0 + c * 2) : tier("long", p * 4 + c * 8)) * (hour("Asia/Shanghai") >= 22 ? 0.5 : 1)'

afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function renderTransfer(
  mode: 'import' | 'export' = 'import',
  pricing: ModelPricingEntry = entry
) {
  usePricingPreferencesStore.setState({ currency: 'USD' })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [], vendors: [] },
  })
  const preview = vi
    .spyOn(api, 'post')
    .mockImplementation(async (_url, body) => ({
      data: {
        success: true,
        data: { effective: (body as { pricing: PricingValues }).pricing },
      },
    }))
  const patch = vi
    .spyOn(api, 'patch')
    .mockResolvedValue({ data: { success: true } })
  client = createAppQueryClient()
  const onClose = vi.fn()
  const onSaved = vi.fn(async () => {})
  const view = render(
    <QueryClientProvider client={client}>
      <PricingTransferDialog
        entry={pricing}
        mode={mode}
        onClose={onClose}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  )
  return { user: userEvent.setup(), preview, patch, onClose, onSaved, view }
}

it('previews the target and saves the exact imported expression and zero values after visiting visual mode', async () => {
  const { user, preview, patch, onSaved } = renderTransfer()
  const pricing = {
    'billing_setting.billing_mode': 'tiered_expr',
    'billing_setting.billing_expr': expression,
    ModelPrice: 0,
    CacheRatio: 0,
  }
  const json = exportModelPricing({
    model_name: 'source',
    configured: pricing,
    effective: pricing,
  })
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: json },
  })
  expect(screen.getByRole('button', { name: 'Preview and edit' })).toBeEnabled()
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  await screen.findByRole('region', { name: 'Edit model pricing' })
  expect(preview).toHaveBeenCalledWith('/api/option/model_pricing/preview', {
    model_name: 'target',
    pricing,
  })
  expect(patch).not.toHaveBeenCalled()
  await user.click(screen.getByRole('tab', { name: 'JSON' }))
  expect(
    JSON.parse(
      (
        screen.getByRole('textbox', {
          name: 'Pricing JSON',
        }) as HTMLTextAreaElement
      ).value
    )
  ).toEqual(pricing)
  await user.click(screen.getByRole('button', { name: 'Save model prices' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(patch).toHaveBeenCalledWith('/api/option/model_pricing', {
    changes: [
      { model_name: 'target', expected_version: 'target-version', pricing },
    ],
  })
})

it('lets the visual editor change a fixed zero price before returning to JSON', async () => {
  const { user } = renderTransfer()
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: '{"ModelPrice":0}' },
  })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  const input = await screen.findByRole('textbox', { name: 'Fixed price' })
  await user.clear(input)
  await user.type(input, '0.25')
  await user.click(screen.getByRole('tab', { name: 'JSON' }))
  expect(
    JSON.parse(
      (
        screen.getByRole('textbox', {
          name: 'Pricing JSON',
        }) as HTMLTextAreaElement
      ).value
    )
  ).toEqual({ ModelPrice: 0.25 })
})

it('rejects invalid JSON and incompatible target schemas without enabling save', async () => {
  const { user, preview, patch } = renderTransfer()
  const input = screen.getByRole('textbox', { name: 'Pricing JSON' })
  fireEvent.input(input, { target: { value: '{"ModelPrice":-1}' } })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid pricing JSON'
  )
  expect(preview).not.toHaveBeenCalled()
  preview.mockResolvedValueOnce({
    data: { success: false, message: 'Target plugin does not support seconds' },
  })
  fireEvent.input(input, {
    target: {
      value: JSON.stringify({
        'billing_setting.billing_mode': 'tiered_expr',
        'billing_setting.billing_expr': 'u("seconds") * 1',
      }),
    },
  })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Target plugin does not support seconds'
  )
  expect(screen.getByRole('button', { name: 'Preview and edit' })).toBeEnabled()
  expect(patch).not.toHaveBeenCalled()
})

it('preserves edited JSON after a save conflict and does not silently retry with a new version', async () => {
  const { user, patch, onSaved, onClose } = renderTransfer()
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: '{"ModelPrice":0}' },
  })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  await screen.findByRole('textbox', { name: 'Fixed price' })
  await user.click(screen.getByRole('tab', { name: 'JSON' }))
  const json = '{"ModelPrice":0.123456789}'
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: json },
  })
  patch.mockResolvedValueOnce({
    data: { success: false, message: 'model pricing version conflict' },
  })
  await user.click(screen.getByRole('button', { name: 'Save model prices' }))
  expect(
    await screen.findByText('model pricing version conflict')
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Pricing JSON' })).toHaveValue(
    json
  )
  expect(patch).toHaveBeenCalledTimes(1)
  expect(onSaved).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('exports saved pricing for copying and never writes during export or cancel', async () => {
  const pricing = {
    'billing_setting.billing_mode': 'tiered_expr',
    'billing_setting.billing_expr': expression,
  }
  const { user, patch, onClose } = renderTransfer('export', {
    ...entry,
    configured: pricing,
    effective: pricing,
  })
  expect(screen.getByRole('textbox', { name: 'Pricing JSON' })).toHaveValue(
    exportModelPricing({ ...entry, configured: pricing, effective: pricing })
  )
  await user.click(screen.getByRole('button', { name: 'Copy pricing JSON' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
  )
  expect(JSON.parse(await navigator.clipboard.readText()).pricing).toEqual(
    pricing
  )
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(patch).not.toHaveBeenCalled()
})

it('loads a JSON file into a reviewable draft without changing the target', async () => {
  const { user, patch } = renderTransfer()
  const json = '{"ModelPrice":0,"CacheRatio":0}'
  const file = new File([json], 'pricing.json', { type: 'application/json' })
  // jsdom does not implement File.text; this is the browser file-read boundary.
  Object.defineProperty(file, 'text', { value: async () => json })
  await user.upload(screen.getByLabelText('Import JSON file'), file)
  expect(screen.getByRole('textbox', { name: 'Pricing JSON' })).toHaveValue(
    json
  )
  expect(screen.getByRole('button', { name: 'Preview and edit' })).toBeEnabled()
  expect(patch).not.toHaveBeenCalled()
})

it('rejects oversized files and keeps the current JSON draft', async () => {
  const { user, patch } = renderTransfer()
  const input = screen.getByRole('textbox', { name: 'Pricing JSON' })
  fireEvent.input(input, { target: { value: '{"ModelPrice":1}' } })
  const file = new File([], 'large.json', { type: 'application/json' })
  Object.defineProperty(file, 'size', { value: 1024 * 1024 })
  await user.upload(screen.getByLabelText('Import JSON file'), file)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Pricing JSON must be smaller than 1 MB'
  )
  expect(input).toHaveValue('{"ModelPrice":1}')
  expect(patch).not.toHaveBeenCalled()
})

it('does not activate a stored inactive expression just by viewing the form', async () => {
  const { user, patch } = renderTransfer()
  const pricing = {
    'billing_setting.billing_mode': 'ratio',
    'billing_setting.billing_expr': 'tier("base", p * 5)',
  }
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: JSON.stringify(pricing) },
  })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  await screen.findByRole('region', { name: 'Edit model pricing' })
  await user.click(screen.getByRole('button', { name: 'Save model prices' }))
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/api/option/model_pricing', {
      changes: [
        { model_name: 'target', expected_version: 'target-version', pricing },
      ],
    })
  )
})

it('reloads the target version after a conflict without discarding the import draft', async () => {
  const { user, patch, onSaved } = renderTransfer()
  fireEvent.input(screen.getByRole('textbox', { name: 'Pricing JSON' }), {
    target: { value: '{"ModelPrice":0.25}' },
  })
  await user.click(screen.getByRole('tab', { name: 'Preview and edit' }))
  await screen.findByRole('textbox', { name: 'Fixed price' })
  patch.mockResolvedValueOnce({
    data: { success: false, message: 'model pricing version conflict' },
  })
  await user.click(screen.getByRole('button', { name: 'Save model prices' }))
  expect(
    await screen.findByText('model pricing version conflict')
  ).toBeVisible()
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        entries: [
          {
            ...entry,
            version: 'updated-version',
            configured: { ModelPrice: 9 },
          },
        ],
        empty_version: 'empty',
        options: {},
      },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Reload pricing' }))
  expect(
    await screen.findByRole('textbox', { name: 'Fixed price' })
  ).toHaveValue('0.25')
  await user.click(screen.getByRole('button', { name: 'Save model prices' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(patch).toHaveBeenLastCalledWith('/api/option/model_pricing', {
    changes: [
      {
        model_name: 'target',
        expected_version: 'updated-version',
        pricing: { ModelPrice: 0.25 },
      },
    ],
  })
})

it('keeps the download available until the export dialog closes', async () => {
  const createObjectURL = vi.fn(() => 'blob:pricing-export')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    }
  )
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  const { user, view } = renderTransfer('export')
  await user.click(screen.getByRole('button', { name: 'Download JSON' }))
  expect(click).toHaveBeenCalledOnce()
  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  view.unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:pricing-export')
})
