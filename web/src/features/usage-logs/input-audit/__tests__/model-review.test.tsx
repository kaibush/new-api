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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { ModelReviewSettings } from '../model-review-api'
import { ModelReviewDialog } from '../model-review-dialog'

let client: QueryClient
const settings: ModelReviewSettings = {
  enabled: true,
  automatic: false,
  interval_minutes: 60,
  endpoint: 'https://review.example/v1/chat/completions',
  key_env: 'INPUT_AUDIT_LLM_API_KEY',
  model: 'review-model',
  instructions: '',
  batch_size: 100,
  chunk_chars: 6000,
  timeout_seconds: 60,
  request_interval_seconds: 2,
  retries: 1,
  confidence_threshold: 80,
  retention_days: 30,
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/input-audit/model/settings')
      {return { data: { success: true, data: settings } }}
    if (url === '/api/input-audit/model/jobs')
      {return { data: { success: true, data: [] } }}
    if (String(url).startsWith('/api/user/search'))
      {return {
        data: {
          success: true,
          data: { items: [{ id: 4, username: 'alice' }] },
        },
      }}
    if (url === '/api/input-audit/model/results')
      {return {
        data: {
          success: true,
          data: {
            items: [
              {
                id: 7,
                job_id: 3,
                audit_id: 1,
                user_id: 4,
                created_at: 1700000000,
                status: 'review',
                category: 'cyber_abuse',
                confidence: 92,
                reason: '<script>model suggestion</script>',
                quote: 'original evidence',
                model: 'review-model',
                complete: false,
                chunks: 2,
              },
            ],
            total: 1,
          },
        },
      }}
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.restoreAllMocks()
})
function show() {
  render(
    <QueryClientProvider client={client}>
      <ModelReviewDialog />
    </QueryClientProvider>
  )
}

it('opening review loads on demand and selecting a username submits a bounded incremental job with its ID', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { id: 3 } } })
  show()
  expect(api.get).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  const dialog = screen.getByRole('dialog', { name: 'Model review' })
  await userEvent.click(
    within(dialog).getByRole('combobox', { name: 'Search users by name or ID' })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'alice (#4)' })
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Start review' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/input-audit/model/jobs', {
      mode: 'incremental',
      user_id: 4,
    })
  )
})

it('settings groups hide secondary controls and preserve edits while switching groups before save', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  const endpoint = await screen.findByRole('textbox', {
    name: 'Chat completions endpoint',
  })
  expect(endpoint).toHaveValue(settings.endpoint)
  expect(
    screen.queryByRole('spinbutton', { name: 'Messages per review job' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Processing and limits' })
  )
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Messages per review job' }),
    { target: { value: '25' } }
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Automatic review schedule' })
  )
  await userEvent.click(
    screen.getByRole('switch', { name: 'Run incremental review automatically' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/input-audit/model/settings',
      expect.objectContaining({ ...settings, batch_size: 25, automatic: true })
    )
  )
})

it('mobile results use cards and show long model explanations only in a separate detail dialog', async () => {
  const original = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Results' }))
  await screen.findByRole('button', { name: 'Details' })
  expect(
    screen.queryByText('<script>model suggestion</script>')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  const detail = screen.getByRole('dialog', { name: 'Review result' })
  expect(
    within(detail).getByText('<script>model suggestion</script>')
  ).toBeVisible()
  expect(within(detail).getByText('Incomplete evidence')).toBeVisible()
  expect(detail.querySelector('script')).toBeNull()
  expect(
    within(detail).queryByRole('form', { name: 'Create review case' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    within(detail).getByRole('tab', { name: 'Evidence and review' })
  )
  expect(
    await within(detail).findByRole('form', { name: 'Create review case' })
  ).toBeVisible()
})

it('a failed jobs query shows a retry state and never permits starting another job', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Start review' })
    ).not.toBeInTheDocument()
  )
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible()
})
