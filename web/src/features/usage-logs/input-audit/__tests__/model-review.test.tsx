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

import { InputAuditViewer } from '..'
import type {
  ModelReviewSettings,
  ModelReviewJob,
  ModelReviewResult,
} from '../model-review-api'
import { ModelReviewDialog } from '../model-review-dialog'
import { ModelReviewResults } from '../model-review-results'

let client: QueryClient
let jobs: ModelReviewJob[] = []
const reviewResult: ModelReviewResult = {
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
}
const settings: ModelReviewSettings = {
  enabled: true,
  automatic: false,
  interval_minutes: 60,
  endpoint: 'https://review.example/v1/chat/completions',
  key_env: 'INPUT_AUDIT_LLM_API_KEY',
  model: 'review-model',
  instructions: '',
  system_prompt: 'Default review criteria',
  default_system_prompt: 'Default review criteria',
  key_configured: true,
  batch_size: 100,
  concurrency: 3,
  chunk_chars: 6000,
  timeout_seconds: 60,
  request_interval_seconds: 2,
  retries: 1,
  confidence_threshold: 80,
  retention_days: 30,
}
beforeEach(() => {
  jobs = []
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/input-audit/model/settings') {
      return { data: { success: true, data: settings } }
    }
    if (url === '/api/input-audit/model/jobs') {
      return { data: { success: true, data: jobs } }
    }
    if (url === '/api/input-audit/model/users') {
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                user_id: 4,
                reviewed: 5,
                suspected: 3,
                insufficient: 1,
                failed: 1,
                categories: { fraud: 2, cyber_abuse: 1 },
              },
            ],
            total: 1,
            reviewed: 5,
            suspected: 3,
            affected_users: 1,
          },
        },
      }
    }
    if (String(url).startsWith('/api/user/search')) {
      return {
        data: {
          success: true,
          data: { items: [{ id: 4, username: 'alice' }] },
        },
      }
    }
    if (url === '/api/input-audit/model/results') {
      return {
        data: {
          success: true,
          data: {
            items: [reviewResult],
            total: 1,
          },
        },
      }
    }
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

it('opening review loads on demand and selecting a username submits a continuous incremental job with its ID', async () => {
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
  expect(
    screen.queryByRole('spinbutton', { name: 'Messages per review job' })
  ).not.toBeInTheDocument()
  const concurrency = screen.getByRole('spinbutton', {
    name: 'Concurrent message reviews',
  })
  expect(concurrency).toHaveValue(3)
  expect(concurrency).toHaveAttribute('max', '5')
  fireEvent.change(concurrency, { target: { value: '5' } })
  const interval = screen.getByRole('spinbutton', {
    name: 'Request interval (seconds)',
  })
  expect(interval).toHaveAttribute('min', '0')
  fireEvent.change(interval, { target: { value: '0' } })
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
      expect.objectContaining({
        batch_size: 100,
        concurrency: 5,
        request_interval_seconds: 0,
        automatic: true,
        system_prompt: settings.system_prompt,
        api_key: '',
      })
    )
  )
})

it('user dashboard displays anomaly categories and clicking a user filters results requiring review', async () => {
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(
    screen.getByRole('tab', { name: 'User review dashboard' })
  )
  const dashboard = await screen.findByRole('region', {
    name: 'User review dashboard',
  })
  await waitFor(() =>
    expect(within(dashboard).getAllByText(/Fraud/).length).toBeGreaterThan(0)
  )
  expect(
    screen.queryByRole('button', { name: 'Details' })
  ).not.toBeInTheDocument()
  expect(within(dashboard).getByText('Fraud · 2')).toBeVisible()
  expect(within(dashboard).getByText('Cyber abuse · 1')).toBeVisible()
  await userEvent.click(
    within(dashboard).getByRole('button', { name: 'Results' })
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({ user_id: 4, status: 'review', p: 1 }),
    })
  )
  expect(
    screen.queryByRole('region', { name: 'User review dashboard' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'All results' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({ user_id: undefined, status: '' }),
    })
  )
})

it('changing category queries all result pages, preserves task and user filters and resets pagination and selection', async () => {
  const previous = vi.mocked(api.get).getMockImplementation()
  if (!previous) {
    throw new Error('Missing API fixture')
  }
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (url === '/api/input-audit/model/results') {
      return {
        data: { success: true, data: { items: [reviewResult], total: 41 } },
      }
    }
    return previous(url, config)
  })
  render(
    <QueryClientProvider client={client}>
      <ModelReviewResults userID={4} jobID={3} status='review' />
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Details' })
  const category = screen.getByRole('combobox', { name: 'Category' })
  expect(category).toHaveValue('')
  expect(
    within(category).getByRole('option', { name: 'All categories' })
  ).toBeVisible()
  expect(category.closest('[data-slot="native-select-wrapper"]')).toHaveClass(
    'w-full'
  )
  expect(category.closest('.grid')).toHaveClass(
    'sm:grid-cols-2',
    'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({
        p: 2,
        user_id: 4,
        job_id: 3,
        status: 'review',
      }),
    })
  )
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Select row' })
  )
  await userEvent.selectOptions(category, 'prompt_injection')
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({
        category: 'prompt_injection',
        p: 1,
        user_id: 4,
        job_id: 3,
        status: 'review',
      }),
    })
  )
  expect(
    await screen.findByRole('checkbox', { name: 'Select row' })
  ).not.toBeChecked()
  await userEvent.selectOptions(category, '')
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({
        category: '',
        p: 1,
        user_id: 4,
        job_id: 3,
        status: 'review',
      }),
    })
  )
})

it('clearing category-filtered results confirms and deletes only that category with the existing task and user filters', async () => {
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <ModelReviewResults userID={4} jobID={3} status='review' />
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Details' })
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Category' }),
    'cyber_abuse'
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({ category: 'cyber_abuse' }),
    })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Clear filtered results' })
  )
  expect(remove).not.toHaveBeenCalled()
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith('/api/input-audit/model/results', {
      data: {
        all: true,
        job_id: 3,
        user_id: 4,
        status: 'review',
        category: 'cyber_abuse',
      },
    })
  )
})

it.each([false, true])(
  'user dashboard shows empty or failed statistics without implying anomalies (failed=%s)',
  async (failed) => {
    const previous = vi.mocked(api.get).getMockImplementation()
    if (!previous) {
      throw new Error('Missing API fixture')
    }
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === '/api/input-audit/model/users') {
        if (failed) throw new Error('statistics unavailable')
        return {
          data: {
            success: true,
            data: {
              items: [],
              total: 0,
              reviewed: 0,
              suspected: 0,
              affected_users: 0,
            },
          },
        }
      }
      return previous(url, config)
    })
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
    await userEvent.click(
      screen.getByRole('tab', { name: 'User review dashboard' })
    )
    const dashboard = await screen.findByRole('region', {
      name: 'User review dashboard',
    })
    expect(
      await within(dashboard).findByText(
        failed ? 'Failed to load audit records' : 'No records'
      )
    ).toBeVisible()
    if (failed) {
      expect(
        within(dashboard).getByRole('button', { name: 'Retry' })
      ).toBeEnabled()
    }
    for (const name of [
      'Reviewed messages',
      'Suspected anomalies',
      'Users with suspected anomalies',
    ]) {
      const statistic = within(dashboard).getByRole('group', { name })
      expect(within(statistic).getByText(failed ? '—' : '0')).toBeVisible()
    }
  }
)

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

it('settings accept a provider key without exposing the saved key and allow restoring the default prompt', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  const key = await screen.findByLabelText('API Key')
  expect(key).toHaveValue('')
  expect(key).toHaveAttribute('type', 'password')
  expect(
    screen.queryByLabelText('Credential environment variable')
  ).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Provider'), 'deepseek')
  expect(screen.getByLabelText('Chat completions endpoint')).toHaveValue(
    'https://api.deepseek.com/v1/chat/completions'
  )
  await userEvent.type(key, 'test-provider-key')
  await userEvent.click(
    screen.getByRole('button', { name: 'Review system prompt' })
  )
  const prompt = screen.getByRole('textbox', { name: 'Review system prompt' })
  expect(prompt).toHaveValue('Default review criteria')
  fireEvent.change(prompt, { target: { value: 'Custom criteria' } })
  await userEvent.click(
    screen.getByRole('button', { name: 'Restore default prompt' })
  )
  expect(prompt).toHaveValue('Default review criteria')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/input-audit/model/settings',
      expect.objectContaining({
        api_key: 'test-provider-key',
        system_prompt: 'Default review criteria',
      })
    )
  )
  expect(key).toHaveValue('')
})

it('saved review keys are revealed after verification and can be shown in full', async () => {
  const get = vi.mocked(api.get).getMockImplementation()
  if (!get) {
    throw new Error('Missing API fixture')
  }
  vi.mocked(api.get).mockImplementation(async (url, options) => {
    if (url === '/api/verify/methods') {
      return {
        data: {
          success: true,
          data: {
            scope: 'input_audit.credentials.read',
            methods: [{ method: '2fa', available: true }],
            oauth_providers: [],
            password_encryption_enabled: false,
          },
        },
      }
    }
    return get(url, options)
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/verify'
          ? {
              proof_token: 'single-use-proof',
              scope: 'input_audit.credentials.read',
              method: '2fa',
              expires_at: Math.floor(Date.now() / 1000) + 60,
            }
          : { api_key: 'saved-full-key' },
    },
  }))
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load saved credentials' })
  )
  expect(post).not.toHaveBeenCalled()
  await userEvent.type(
    await screen.findByLabelText('Authenticator code or backup code'),
    '123456'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  const key = screen.getByLabelText('API Key')
  await waitFor(() => expect(key).toHaveValue('saved-full-key'))
  expect(post).toHaveBeenCalledWith(
    '/api/input-audit/model/credential',
    undefined,
    expect.objectContaining({
      headers: { 'X-Security-Proof': 'single-use-proof' },
      singleUseAuthorization: true,
    })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle password visibility' })
  )
  expect(key).toHaveAttribute('type', 'text')
  expect(
    screen.getByRole('button', { name: 'Copy to clipboard' })
  ).toBeEnabled()
})

function queueFixture(status: string): ModelReviewJob {
  return {
    id: 12,
    status,
    mode: 'incremental',
    user_id: 0,
    created_at: 1700000000,
    updated_at: 1700000000,
    created_by: 1,
    cursor: 0,
    upper_id: 12000,
    processed: 1,
    flagged: 0,
    failed: 0,
    concurrency: 3,
    request_interval_seconds: 2,
  }
}
it('queued task edits persist scope and worker settings while running tasks cannot be edited', async () => {
  jobs = [queueFixture('pending')]
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit queued review task' })
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Review scope'),
    'failed'
  )
  fireEvent.change(
    within(dialog).getByLabelText('Concurrent message reviews'),
    { target: { value: '5' } }
  )
  fireEvent.change(
    within(dialog).getByLabelText('Request interval (seconds)'),
    { target: { value: '0' } }
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/input-audit/model/jobs/12',
      expect.objectContaining({
        mode: 'failed',
        concurrency: 5,
        request_interval_seconds: 0,
      })
    )
  )
  jobs = [queueFixture('running')]
  await client.invalidateQueries({ queryKey: ['model-review-jobs'] })
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
  )
})
it.each(['Stop task', 'Clear queue', 'Delete', 'Clear task history'])(
  'queue %s requires confirmation and sends the intended operation',
  async (action) => {
    jobs = [
      queueFixture(action === 'Clear task history' ? 'completed' : 'running'),
    ]
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const remove = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { success: true } })
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
    await userEvent.click(await screen.findByRole('button', { name: action }))
    expect(post).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
      })
    )
    await waitFor(() => {
      if (action === 'Stop task') {
        expect(post).toHaveBeenCalledWith(
          '/api/input-audit/model/jobs/12/cancel'
        )
      } else if (action === 'Clear queue') {
        expect(post).toHaveBeenCalledWith('/api/input-audit/model/queue/clear')
      } else {
        expect(remove).toHaveBeenCalledWith('/api/input-audit/model/jobs', {
          data: {
            ids: action === 'Delete' ? [12] : [],
            stop: true,
            history: action === 'Clear task history',
          },
        })
      }
    })
  }
)
it.each([false, true])(
  'queue pause toggles the persisted pause setting (paused=%s)',
  async (paused) => {
    const previous = vi.mocked(api.get).getMockImplementation()
    if (!previous) throw new Error('Missing API fixture')
    vi.mocked(api.get).mockImplementation(async (url, config) =>
      url === '/api/input-audit/model/settings'
        ? { data: { success: true, data: { ...settings, paused } } }
        : previous(url, config)
    )
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
    await userEvent.click(
      await screen.findByRole('button', {
        name: paused ? 'Resume queue' : 'Pause queue',
      })
    )
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/input-audit/model/queue', {
        paused: !paused,
      })
    )
  }
)
it.each(['Delete', 'Delete selected', 'Clear filtered results'])(
  'result %s confirms before deleting only the selected scope',
  async (action) => {
    const remove = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { success: true } })
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Results' }))
    await screen.findByRole('button', { name: 'Details' })
    if (action === 'Delete selected') {
      await userEvent.click(
        screen.getByRole('checkbox', { name: 'Select row' })
      )
    }
    await userEvent.click(screen.getByRole('button', { name: action }))
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      })
    )
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/api/input-audit/model/results', {
        data:
          action === 'Clear filtered results'
            ? {
                all: true,
                job_id: undefined,
                user_id: undefined,
                status: '',
                category: '',
              }
            : { ids: [7] },
      })
    )
  }
)
it('dashboard cleanup deletes only the selected user after confirmation', async () => {
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Model review' }))
  await userEvent.click(
    screen.getByRole('tab', { name: 'User review dashboard' })
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Clear user results' })
  )
  expect(remove).not.toHaveBeenCalled()
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith('/api/input-audit/model/results', {
      data: { all: true, user_id: 4 },
    })
  )
})

it('audit sidebar opens the dashboard directly and selecting a user navigates to results without nested tabs', async () => {
  render(
    <QueryClientProvider client={client}>
      <InputAuditViewer />
    </QueryClientProvider>
  )
  const navigation = screen.getByRole('navigation', {
    name: 'Audit management',
  })
  await userEvent.click(
    within(navigation).getByRole('button', { name: 'User review dashboard' })
  )
  const dashboard = await screen.findByRole('region', {
    name: 'User review dashboard',
  })
  await within(dashboard).findByText('Fraud · 2')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(
    within(navigation).getByRole('button', { name: 'User review dashboard' })
  ).toHaveAttribute('aria-current', 'page')
  await userEvent.click(
    within(dashboard).getByRole('button', { name: 'Results' })
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/model/results', {
      params: expect.objectContaining({ user_id: 4, status: 'review' }),
    })
  )
  expect(
    within(navigation).getByRole('button', { name: 'Results' })
  ).toHaveAttribute('aria-current', 'page')
  expect(
    screen.queryByRole('region', { name: 'User review dashboard' })
  ).not.toBeInTheDocument()
})
