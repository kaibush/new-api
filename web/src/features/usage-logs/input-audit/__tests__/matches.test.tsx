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

import type { InputAuditEvidenceResponse } from '../api'
import { MatchDetail } from '../match-detail'
import { MatchesDialog } from '../matches-dialog'
import { InputAuditSettingsDialog } from '../settings-dialog'

let client: QueryClient
const record = {
  id: 7,
  user_id: 61,
  request_id: 'request-test',
  rule: '色情',
  status: 'pending',
  version: 1,
  created_at: 1700000000,
  name: 'Filter',
  plugin_version: '1.1.0',
  stage: 'ingress',
  model: 'test',
  reason: '',
  reviewed_by: 0,
}
let evidence: object | null
let requestContext: InputAuditEvidenceResponse | undefined
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  evidence = {
    path: '/messages/0/content',
    role: 'system',
    before: '禁止生成',
    match: '色情',
    after: '<script>alert(1)</script>',
    representation: 'original',
    truncated: true,
  }
  requestContext = undefined
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/input-audit/matches') {
      return { data: { success: true, data: { items: [record], total: 1 } } }
    }
    if (url === '/api/input-audit/matches/7') {
      return {
        data: {
          success: true,
          data: { record, evidence, request_context: requestContext },
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

it('loads only after opening and preserves the request filter when searching context', async () => {
  render(
    <QueryClientProvider client={client}>
      <MatchesDialog requestID='request-test' />
    </QueryClientProvider>
  )
  expect(api.get).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Interception evidence' })
  )
  await screen.findByText('色情')
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Match context keyword' }),
    '禁止'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/input-audit/matches', {
      params: expect.objectContaining({
        p: 1,
        request_id: 'request-test',
        keyword: '禁止',
      }),
    })
  )
})

it('separates evidence from review, safely renders the quote and submits a versioned human decision', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  const dialog = screen.getByRole('dialog', { name: 'Match evidence' })
  await within(dialog).findByText(/禁止生成/)
  expect(dialog.querySelector('mark')).toHaveTextContent('色情')
  expect(dialog.querySelector('script')).toBeNull()
  expect(
    within(dialog).queryByRole('textbox', { name: 'Review reason' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    within(dialog).getByRole('tab', { name: 'Human review' })
  )
  await userEvent.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Review result' }),
    'dismissed'
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'System prohibition, not user intent'
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save review' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/input-audit/matches/7/decision', {
      version: 1,
      status: 'dismissed',
      reason: 'System prohibition, not user intent',
    })
  )
})

it('explicitly displays unavailable evidence instead of substituting another message', async () => {
  evidence = null
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  await screen.findByText(
    'No match excerpt was captured. Older records cannot be reconstructed.'
  )
  expect(document.querySelector('mark')).toBeNull()
  await userEvent.click(screen.getByRole('tab', { name: 'Request content' }))
  expect(
    await screen.findByText(
      'Request content was not retained. Historical interception records cannot be reconstructed.'
    )
  ).toBeVisible()
})

it('reviews retained request fields in the current dialog and keeps the view mode and review drafts when switching tabs', async () => {
  requestContext = {
    available: true,
    complete: false,
    document: {
      version: 2,
      source: 'rejection_stage_request',
      scope: 'submitted_text_excerpts',
      truncated: true,
      context_missing: false,
      omitted: ['request_character_limit'],
      messages: Array.from({ length: 12 }, (_, index) => ({
        index,
        role: index === 0 ? 'system' : 'user',
        kind: 'message',
        path: `/messages/${index}/content`,
        text: `request field ${index} <script>content</script>`,
        original_chars: 10000,
        truncated: true,
      })),
    },
  }
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  await screen.findByText(/禁止生成/)
  await userEvent.click(screen.getByRole('tab', { name: 'Request content' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByText('Incomplete evidence')).toBeVisible()
  expect(
    screen.getByText('request field 11 <script>content</script>')
  ).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  const userOnly = screen.getByRole('button', { name: 'User messages only' })
  await userEvent.click(userOnly)
  expect(
    screen.queryByText('request field 0 <script>content</script>')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Human review' }))
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Review reason' }),
    'Check full user context'
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Request content' }))
  expect(userOnly).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Human review' }))
  expect(screen.getByRole('textbox', { name: 'Review reason' })).toHaveValue(
    'Check full user context'
  )
})

it('shows a specific queue gap while preserving the decisive match', async () => {
  requestContext = {
    available: false,
    complete: false,
    reason: 'queue_dropped',
  }
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  await screen.findByText(/禁止生成/)
  await userEvent.click(screen.getByRole('tab', { name: 'Request content' }))
  expect(
    screen.getByText(
      'Request content was dropped because the capture queue was full. The match record is retained.'
    )
  ).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Match evidence' }))
  expect(screen.getByText(/禁止生成/)).toBeVisible()
})

it('shows a loading state and retries a failed interception detail request', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  expect(screen.getByRole('status')).toHaveTextContent('Loading...')
  expect(
    await screen.findByText('Audit evidence is unavailable or expired')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText(/禁止生成/)).toBeVisible()
})

it('validates independent interception settings and saves them without changing ordinary evidence limits', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <InputAuditSettingsDialog
        embedded
        settings={{
          enabled: true,
          retention_days: 7,
          max_records: 20000,
          max_chars: 2048,
        }}
      />
    </QueryClientProvider>
  )
  await userEvent.click(
    screen.getByRole('tab', { name: 'Interception evidence' })
  )
  const characters = screen.getByRole('spinbutton', {
    name: 'Interception characters per request',
  })
  expect(characters).toHaveValue(131072)
  fireEvent.change(characters, { target: { value: '1' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Input audit settings' }))
  expect(
    await screen.findByText('Please enter an integer between 1024 and 1048576')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  fireEvent.change(characters, { target: { value: '262144' } })
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Maximum interception records' }),
    { target: { value: '1000' } }
  )
  fireEvent.change(
    screen.getByRole('spinbutton', {
      name: 'Interception storage limit (bytes)',
    }),
    { target: { value: '33554432' } }
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/input-audit/settings',
      expect.objectContaining({
        match_max_chars: 262144,
        match_max_records: 1000,
        match_max_bytes: 33554432,
        evidence_max_chars: 32768,
        evidence_max_bytes: 67108864,
      })
    )
  )
})

it('labels transformed matching text and preserves unsaved review input after a conflict', async () => {
  evidence = {
    path: '/input',
    role: 'user',
    before: '',
    match: 'secret',
    after: '',
    representation: 'transformed',
  }
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Record changed' },
  })
  render(
    <QueryClientProvider client={client}>
      <MatchDetail id={7} onClose={() => {}} />
    </QueryClientProvider>
  )
  await screen.findByText('Transformed matching text')
  await userEvent.click(screen.getByRole('tab', { name: 'Human review' }))
  const reason = screen.getByRole('textbox', { name: 'Review reason' })
  await userEvent.type(reason, 'Keep this note')
  await userEvent.click(screen.getByRole('button', { name: 'Save review' }))
  await screen.findByText(
    'Could not save the review. Refresh if another reviewer changed this record.'
  )
  expect(reason).toHaveValue('Keep this note')
})
