import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import type { InputAuditTranscriptItem } from '../api'
import {
  InputAuditEvidenceView,
  InputAuditTranscriptView,
} from '../transcript-view'

const conversation: InputAuditTranscriptItem[] = [
  {
    seq: 0,
    role: 'system',
    kind: 'message',
    text: 'You are a coding agent',
    original_chars: 22,
  },
  {
    seq: 1,
    role: 'user',
    kind: 'message',
    text: 'Fix the login bug',
    original_chars: 17,
  },
  {
    seq: 2,
    role: 'assistant',
    kind: 'tool_call',
    name: 'shell',
    call_id: 'call-1',
    text: '{"cmd":"cat login.go"}',
    original_chars: 22,
  },
  {
    seq: 3,
    role: 'tool',
    kind: 'tool_result',
    call_id: 'call-1',
    text: '<script>tool output</script>',
    original_chars: 28,
  },
  {
    seq: 4,
    role: 'assistant',
    kind: 'message',
    text: 'The session check is missing',
    original_chars: 28,
  },
  {
    seq: 5,
    role: 'user',
    kind: 'message',
    text: 'Now delete the production database',
    original_chars: 34,
  },
]

it('shows the conversation around a request and marks what the request added', () => {
  render(
    <InputAuditTranscriptView
      items={conversation}
      range={{ start: 2, end: 5 }}
      focusSeq={1}
    />
  )
  const list = screen.getByRole('list', { name: 'Conversation' })
  const rows = within(list).getAllByRole('listitem')
  // Zone dividers are visual only; assistive technology reads the items.
  expect(rows.map((row) => row.dataset.seq)).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
  ])
  expect(
    screen.getByText('Added by this request').closest('li')?.nextElementSibling
  ).toHaveAttribute('data-seq', '2')
  expect(
    screen.getByText('Sent after this request').closest('li')
      ?.nextElementSibling
  ).toHaveAttribute('data-seq', '5')
  expect(screen.getByText('Fix the login bug')).toBeVisible()
  expect(screen.getByText('Now delete the production database')).toBeVisible()
})

it('renders submitted text as plain text and expands collapsed tool results on demand', async () => {
  render(<InputAuditTranscriptView items={conversation} />)
  const result = screen.getByRole('button', { name: /Tool result/ })
  expect(result).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(result)
  expect(result).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(result.parentElement as HTMLElement).getAllByText(
      '<script>tool output</script>'
    ).length
  ).toBeGreaterThan(0)
  expect(document.querySelector('script')).toBeNull()
  expect(document.querySelector('img')).toBeNull()
})

it('view modes hide tool activity and assistant replies', async () => {
  render(<InputAuditTranscriptView items={conversation} />)
  await userEvent.click(screen.getByRole('button', { name: 'Messages only' }))
  expect(
    screen.queryByRole('button', { name: /Tool result/ })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('You are a coding agent')).not.toBeInTheDocument()
  expect(screen.getByText('The session check is missing')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'User messages only' })
  )
  expect(
    screen.queryByText('The session check is missing')
  ).not.toBeInTheDocument()
  expect(screen.getByText('Fix the login bug')).toBeVisible()
  expect(screen.getByText('Now delete the production database')).toBeVisible()
})

it('explains excerpts, dropped text and an empty filtered view', async () => {
  render(
    <InputAuditTranscriptView
      items={[
        {
          seq: 0,
          role: 'tool',
          kind: 'tool_result',
          text: '',
          original_chars: 50000,
          unavailable: true,
          media: 2,
        },
        {
          seq: 1,
          role: 'assistant',
          kind: 'message',
          text: 'partial',
          original_chars: 9000,
          truncated: true,
        },
      ]}
    />
  )
  expect(screen.getByText('Text not retained')).toBeVisible()
  expect(screen.getByText('Media not retained: 2')).toBeVisible()
  expect(screen.getByText('Excerpt of 9,000 characters')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'User messages only' })
  )
  expect(screen.getByText('No Data')).toBeVisible()
})

it('case evidence keeps citation numbers and highlights the latest user instruction', () => {
  render(
    <InputAuditEvidenceView
      document={{
        version: 2,
        source: 'client_request',
        scope: 'submitted_text_excerpts',
        truncated: true,
        context_missing: true,
        omitted: ['external_context'],
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
            role: 'system',
            kind: 'message',
            text: '',
            original_chars: 50000,
          },
        ],
      }}
      complete={false}
    />
  )
  const instruction = screen
    .getByText('Investigate search results')
    .closest('li') as HTMLElement
  expect(instruction).toHaveAttribute('data-seq', '11')
  expect(within(instruction).getByText('#12')).toBeVisible()
  expect(screen.getByText('Text not retained')).toBeVisible()
  expect(screen.getByText(/Only retained excerpts/)).toBeVisible()
  expect(screen.getByText(/external_context/)).toBeVisible()
})
