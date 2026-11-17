import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { MatchDetail } from '../match-detail'
import { MatchesDialog } from '../matches-dialog'

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
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/input-audit/matches')
      {return { data: { success: true, data: { items: [record], total: 1 } } }}
    if (url === '/api/input-audit/matches/7')
      {return { data: { success: true, data: { record, evidence } } }}
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
  await userEvent.click(
    screen.getByRole('button', { name: 'Search' })
  )
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
