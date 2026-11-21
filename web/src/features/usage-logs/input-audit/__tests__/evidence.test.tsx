import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { InputAuditEvidenceDocument } from '../api'
import { InputAuditEvidenceView } from '../evidence-view'

it('long evidence is paginated and searching locates an off-page tool result without rendering media', async () => {
  const document: InputAuditEvidenceDocument = {
    version: 2,
    source: 'client_request',
    scope: 'submitted_text_excerpts',
    truncated: true,
    context_missing: false,
    omitted: ['media_not_retained'],
    messages: Array.from({ length: 12 }, (_, index) => ({
      index,
      role: 'tool',
      kind: 'tool_result',
      call_id: `call-${index}`,
      text:
        index === 11 ? '<script>retained result</script>' : `result-${index}`,
      original_chars: 100000,
      original_hash: `hash-${index}`,
      truncated: true,
    })),
  }
  render(<InputAuditEvidenceView document={document} complete={false} />)
  expect(
    screen.queryByRole('button', { name: /Message 12/ })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await userEvent.click(screen.getByRole('button', { name: /Message 12/ }))
  expect(screen.getByText('<script>retained result</script>')).toBeVisible()
  expect(window.document.querySelector('script')).toBeNull()
  expect(window.document.querySelector('img')).toBeNull()
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Search retained evidence' }),
    'call-11'
  )
  expect(screen.getByRole('button', { name: /Message 12/ })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /Message 11/ })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

it('a system prompt exposes its exact original version for related requests and explains empty excerpts', async () => {
  const onPromptHash = vi.fn()
  render(
    <InputAuditEvidenceView
      document={{
        version: 2,
        source: 'client_request',
        scope: 'submitted_text_excerpts',
        messages: [
          {
            index: 0,
            role: 'system',
            kind: 'message',
            text: '',
            original_hash: 'exact-prompt-hash',
            original_chars: 50000,
            truncated: true,
          },
        ],
        truncated: true,
        context_missing: true,
        omitted: ['external_context'],
      }}
      complete={false}
      onPromptHash={onPromptHash}
    />
  )
  expect(
    await screen.findByText('Text omitted by request budget')
  ).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Requests using this prompt' })
  )
  expect(onPromptHash).toHaveBeenCalledWith('exact-prompt-hash')
  expect(screen.getByText(/Only retained excerpts/)).toBeVisible()
})

it('tool definitions do not offer a prompt lookup and unmatched searches show an empty state', async () => {
  render(
    <InputAuditEvidenceView
      document={{
        version: 2,
        source: 'client_request',
        scope: 'submitted_text_excerpts',
        messages: [
          {
            index: 0,
            role: 'system',
            kind: 'tool_definition',
            text: 'Inspect local files',
            original_hash: 'definition-hash',
          },
        ],
        truncated: false,
        context_missing: false,
        omitted: [],
      }}
      complete
      onPromptHash={vi.fn()}
    />
  )
  expect(
    screen.queryByRole('button', { name: 'Requests using this prompt' })
  ).not.toBeInTheDocument()
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Search retained evidence' }),
    'absent'
  )
  expect(screen.getByText('No Data')).toBeVisible()
})

it('opens the latest user instruction even when tool activity puts it after the first page', () => {
  render(
    <InputAuditEvidenceView
      document={{
        source: 'client_request',
        scope: 'submitted_text_excerpts',
        truncated: false,
        context_missing: false,
        omitted: [],
        messages: [
          ...Array.from({ length: 11 }, (_, index) => ({
            index,
            role: 'tool',
            kind: 'tool_result',
            text: `result-${index}`,
          })),
          {
            index: 11,
            role: 'user',
            kind: 'message',
            text: 'Investigate search results',
          },
          {
            index: 12,
            role: 'assistant',
            kind: 'tool_call',
            text: 'Search files',
          },
        ],
      }}
      complete
    />
  )
  expect(screen.getByText('Investigate search results')).toBeVisible()
})
