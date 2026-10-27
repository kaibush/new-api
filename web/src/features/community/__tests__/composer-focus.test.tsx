import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

import { ChatComposer } from '../chat-composer'

function renderComposer() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const response = {
    data: {
      success: true,
      data: {
        id: 1,
        user_id: 1,
        name: 'Alice',
        avatar: '',
        text: 'First message',
        kind: 'text',
        url: '',
        filename: '',
        size: 0,
        created_at: 1700000000,
        deleted: false,
      },
    },
  }
  let resolve: (value: typeof response) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<typeof response>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  const post = vi.spyOn(api, 'post').mockReturnValueOnce(promise)
  post.mockResolvedValue(response)
  render(
    <QueryClientProvider client={client}>
      <ChatComposer
        connected
        status={{
          name: 'Community chat',
          enabled: true,
          bot_enabled: false,
          bot_name: '',
          history_days: 1,
        }}
        users={[]}
        reply={null}
        currentUser={{ user_id: 1, name: 'Alice', avatar: '' }}
        onCancelReply={vi.fn()}
        onSending={vi.fn()}
        onDelivered={vi.fn()}
        onFailed={() => true}
        onSent={vi.fn()}
      />
      <Input aria-label='Another input' />
    </QueryClientProvider>
  )
  return {
    user: userEvent.setup(),
    editor: screen.getByRole('textbox', { name: 'Message' }),
    post,
    delivery: { resolve, reject },
    response,
  }
}

afterEach(() => vi.restoreAllMocks())

test.each(['Enter', 'Send button'])(
  '%s keeps focus through sending and allows another message without clicking',
  async (method) => {
    const { user, editor, post, delivery, response } = renderComposer()
    await user.type(editor, 'First message')
    if (method === 'Enter') {
      await user.keyboard('{Enter}')
    } else {
      await user.click(screen.getByRole('button', { name: 'Send' }))
    }
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
    expect(editor).toHaveFocus()
    expect(editor).toHaveAttribute('readonly')
    await user.keyboard('Ignore while sending{Enter}')
    expect(editor).toHaveValue('')
    expect(post).toHaveBeenCalledTimes(1)

    await act(async () => delivery.resolve(response))
    await waitFor(() => expect(editor).not.toHaveAttribute('readonly'))
    expect(editor).toHaveFocus()
    await user.keyboard('Second message{Enter}')
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/api/community/messages', {
        text: 'Second message',
        client_id: expect.any(String),
      })
    )
    expect(post).toHaveBeenCalledTimes(2)
  }
)

test('a failed send restores the draft and keeps focus for editing', async () => {
  const { user, editor, delivery } = renderComposer()
  await user.type(editor, 'First message')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await act(async () => delivery.reject(new Error('Network failed')))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  )
  expect(editor).toHaveFocus()
  await user.keyboard(' for retry')
  expect(editor).toHaveValue('First message for retry')
})

test('finishing a send preserves focus moved to another input', async () => {
  const { user, editor, delivery, response } = renderComposer()
  await user.type(editor, 'First message')
  await user.keyboard('{Enter}')
  const other = screen.getByRole('textbox', { name: 'Another input' })
  await user.click(other)
  await act(async () => delivery.resolve(response))
  await screen.findByRole('button', { name: 'Send' })
  expect(other).toHaveFocus()
  await user.keyboard('Continue here')
  expect(other).toHaveValue('Continue here')
})
