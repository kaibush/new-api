import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { useSidebarData } from '@/hooks/use-sidebar-data'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommunityChat } from '..'
import { CommunitySettings } from '../settings'

class FakeSocket {
  static instances: FakeSocket[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  send = vi.fn()
  close = vi.fn()
  constructor(public url: URL) {
    FakeSocket.instances.push(this)
  }
}
function SettingsHarness() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <CommunitySettings />
      </SettingsPageProvider>
    </>
  )
}
function show(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>
  )
}
beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview')
      static revokeObjectURL = vi.fn()
    }
  )
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: HTMLElement) {
        if (Number(target.dataset.index) > 16) return
        queueMicrotask(() =>
          this.callback(
            [
              {
                target,
                isIntersecting: true,
                intersectionRatio: 1,
                time: 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
              } satisfies IntersectionObserverEntry,
            ],
            this as unknown as IntersectionObserver
          )
        )
      }
      unobserve() {}
      disconnect() {}
    }
  )
  useAuthStore.setState((state) => ({
    auth: {
      ...state.auth,
      user: { id: 1, username: 'Alice', role: 1 },
      accessToken: 'test-session-token',
    },
  }))
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        name: 'Developer lounge',
        bot_enabled: true,
        bot_name: 'helper',
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('loads recent history over an authenticated socket and sends a bot mention', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  const socket = FakeSocket.instances[0]
  expect(socket.url.search).toBe('')
  act(() => {
    socket.onopen?.()
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 1,
            user_id: 2,
            name: 'Bob',
            avatar: '',
            text: 'Earlier message',
            kind: 'text',
            created_at: 1700000000,
            deleted: false,
          },
        ],
      }),
    })
  })
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ token: 'test-session-token' })
  )
  expect(await screen.findByText('Earlier message')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Mention bot/ }))
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/community/messages', {
      text: '@helper hello',
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  )
})

test('disabled chat hides the composer and does not open a socket', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { enabled: false } },
  })
  show(<CommunityChat />)
  expect(
    await screen.findByText('Community chat is disabled')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Message' })
  ).not.toBeInTheDocument()
  expect(FakeSocket.instances).toHaveLength(0)
})

test('images are staged and can be removed before uploading', async () => {
  const user = userEvent.setup()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  show(<CommunityChat />)
  await user.click(await screen.findByRole('button', { name: 'Image' }))
  expect(
    screen.queryByRole('button', { name: 'Sticker' })
  ).not.toBeInTheDocument()
  await user.upload(
    screen.getByLabelText('Upload attachment'),
    new File(['image'], 'hello.png', { type: 'image/png' })
  )
  expect(await screen.findByAltText('Pending image')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Remove attachment' }))
  expect(screen.queryByAltText('Pending image')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})

test('administrator can enable chat while preserving a stored secret', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      has_secret: true,
      data: {
        enabled: false,
        bot_enabled: false,
        bot_name: 'helper',
        app_id: 'app',
        template_id: 'template',
        receiver: 'openid',
      },
    },
  })
  show(<SettingsHarness />)
  const toggle = await screen.findByRole('switch', {
    name: 'Enable community chat',
  })
  await user.click(toggle)
  await user.type(
    screen.getByRole('textbox', { name: 'Chat display name' }),
    'My lounge'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/api/option/community',
      expect.objectContaining({
        enabled: true,
        name: 'My lounge',
        app_secret: '',
      })
    )
  )
})

test('empty history disables blank messages and a failed send preserves the draft', async () => {
  const user = userEvent.setup()
  vi.mocked(api.post).mockRejectedValue(new Error('network failed'))
  show(<CommunityChat />)
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  expect(screen.getByText('No messages yet')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'Message' }),
    'Keep this draft'
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  )
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Keep this draft'
  )
})

test('custom chat title and live online list reflect presence and disconnects', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  expect(
    await screen.findByRole('heading', { name: 'Developer lounge' })
  ).toBeInTheDocument()
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  const socket = FakeSocket.instances[0]
  act(() => {
    socket.onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [
          { user_id: 1, name: 'Alice', avatar: '' },
          { user_id: 2, name: 'Bob', avatar: '' },
        ],
      }),
    })
  })
  await user.click(screen.getByRole('button', { name: 'Online users: 2' }))
  expect(
    await screen.findByRole('list', { name: 'Online users' })
  ).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [{ user_id: 1, name: 'Alice', avatar: '' }],
      }),
    })
  )
  expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Online users: 1' })
  ).toBeInTheDocument()
  act(() => socket.onclose?.())
  expect(screen.getByRole('button', { name: 'Online users: —' })).toBeDisabled()
})

test('open-source emoji popup inserts an emoji and closes with Escape', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const trigger = await screen.findByRole('button', { name: 'Insert emoji' })
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello ')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() =>
    expect(document.querySelector('em-emoji-picker')).toBeInTheDocument()
  )
  let button: HTMLButtonElement | undefined
  await waitFor(() => {
    button = [
      ...(document
        .querySelector('em-emoji-picker')
        ?.shadowRoot?.querySelectorAll('button') ?? []),
    ].find((item) => item.getAttribute('aria-label') === '😀')
    expect(button).toBeDefined()
  })
  if (!button) throw new Error('Emoji button is unavailable')
  fireEvent.click(button)
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Hello 😀'
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
})

test('sidebar uses the configured name and falls back when it is cleared', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const { result } = renderHook(useSidebarData, {
    wrapper: (props) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  })
  await waitFor(() =>
    expect(
      result.current.navGroups
        .flatMap((group) => group.items)
        .find((item) => item.url === '/community')?.title
    ).toBe('Developer lounge')
  )
  act(() =>
    client.setQueryData(['community-status'], { enabled: true, name: '' })
  )
  await waitFor(() =>
    expect(
      result.current.navGroups
        .flatMap((group) => group.items)
        .find((item) => item.url === '/community')?.title
    ).toBe('Community chat')
  )
})

test('long chat names wrap within the header and presence changes preserve the scroll position', async () => {
  const name = 'A'.repeat(80)
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { enabled: true, name } },
  })
  show(<CommunityChat />)
  const title = await screen.findByRole('heading', { name })
  expect(title).toHaveClass('break-words')
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  const messages = screen.getByRole('log', { name: 'Chat messages' })
  messages.scrollTop = 100
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [{ user_id: 1, name: 'Alice', avatar: '' }],
      }),
    })
  )
  expect(messages.scrollTop).toBe(100)
})

test('saved credentials load only after verification and support visibility toggles', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data:
      url === '/api/verify/methods'
        ? {
            success: true,
            data: {
              scope: 'community.credentials.read',
              methods: [{ method: '2fa', available: true }],
              oauth_providers: [],
              password_encryption_enabled: false,
            },
          }
        : {
            success: true,
            has_secret: true,
            has_callback_token: true,
            data: {
              enabled: true,
              name: '',
              bot_enabled: false,
              bot_name: 'helper',
              app_id: '',
              template_id: '',
              receiver: '',
            },
          },
  }))
  vi.mocked(api.post).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/verify'
          ? {
              proof_token: 'single-use-proof',
              scope: 'community.credentials.read',
              method: '2fa',
              expires_at: Math.floor(Date.now() / 1000) + 60,
            }
          : {
              app_secret: 'stored-app-secret',
              callback_token: 'stored-callback-token',
            },
    },
  }))
  show(<SettingsHarness />)
  const load = await screen.findByRole('button', {
    name: 'Load saved credentials',
  })
  const appSecret = screen.getByLabelText('WeChat AppSecret')
  const callbackToken = screen.getByLabelText('WeChat callback token')
  expect(appSecret).toHaveValue('')
  expect(callbackToken).toHaveValue('')
  await user.click(load)
  expect(api.post).not.toHaveBeenCalled()
  await user.type(
    await screen.findByLabelText('Authenticator code or backup code'),
    '123456'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(appSecret).toHaveValue('stored-app-secret'))
  expect(callbackToken).toHaveValue('stored-callback-token')
  expect(api.post).toHaveBeenCalledWith(
    '/api/option/community/credentials',
    undefined,
    expect.objectContaining({
      headers: { 'X-Security-Proof': 'single-use-proof' },
      singleUseAuthorization: true,
      signal: expect.any(AbortSignal),
    })
  )
  expect(appSecret).toHaveAttribute('type', 'password')
  const toggles = screen.getAllByRole('button', {
    name: 'Toggle password visibility',
  })
  await user.click(toggles[0])
  await user.click(toggles[1])
  expect(appSecret).toHaveAttribute('type', 'text')
  expect(callbackToken).toHaveAttribute('type', 'text')
  await user.click(toggles[0])
  expect(appSecret).toHaveAttribute('type', 'password')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('cancelling credential verification preserves edited keys and never requests saved keys', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data:
      url === '/api/verify/methods'
        ? {
            success: true,
            data: {
              scope: 'community.credentials.read',
              methods: [{ method: '2fa', available: true }],
              oauth_providers: [],
              password_encryption_enabled: false,
            },
          }
        : {
            success: true,
            has_secret: true,
            data: { enabled: true, bot_name: 'helper' },
          },
  }))
  show(<SettingsHarness />)
  await screen.findByRole('button', { name: 'Load saved credentials' })
  await user.type(screen.getByLabelText('WeChat AppSecret'), 'new-secret')
  await user.click(
    screen.getByRole('button', { name: 'Load saved credentials' })
  )
  await screen.findByLabelText('Authenticator code or backup code')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Load saved credentials' })
    ).toBeEnabled()
  )
  expect(screen.getByLabelText('WeChat AppSecret')).toHaveValue('new-secret')
  expect(api.post).not.toHaveBeenCalled()
})

test('aligns own messages on the right and other users on the left by user ID', async () => {
  show(<CommunityChat />)
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  act(() => {
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          ...(['image', 'sticker', 'file'] as const).map((kind, index) => ({
            id: index + 4,
            user_id: 1,
            name: 'Alice',
            kind,
            filename: `My ${kind}`,
            url: 'https://example.com/attachment',
            size: 12,
            created_at: 1700000000,
          })),
          {
            id: 1,
            user_id: 1,
            name: 'Alice',
            text: 'My message',
            kind: 'text',
            created_at: 1700000000,
          },
          {
            id: 2,
            user_id: 2,
            name: 'Alice',
            text: 'Other message',
            kind: 'text',
            created_at: 1700000000,
          },
          {
            id: 3,
            user_id: 1,
            name: 'Alice',
            deleted: true,
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
  })
  expect(screen.getByText('My message').closest('article')).toHaveClass(
    'flex-row-reverse'
  )
  expect(screen.getByText('Other message').closest('article')).not.toHaveClass(
    'flex-row-reverse'
  )
  for (const kind of ['image', 'sticker']) {
    expect(screen.getByAltText(`My ${kind}`).closest('article')).toHaveClass(
      'flex-row-reverse'
    )
  }
  expect(
    screen.getByRole('link', { name: /My file/ }).closest('article')
  ).toHaveClass('flex-row-reverse')
  expect(screen.getByText('My message').parentElement).toHaveClass(
    'items-end',
    'min-w-0'
  )
  expect(screen.getByText('Other message').parentElement).toHaveClass(
    'items-start'
  )
  expect(screen.getByText('Message deleted').closest('article')).toHaveClass(
    'flex-row-reverse'
  )
})

test('pasted images stay pending until Send and preserve the draft on failure', async () => {
  const user = userEvent.setup()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:paste')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(api.post).mockRejectedValueOnce(new Error('upload failed'))
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
  fireEvent.paste(editor, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    },
  })
  expect(await screen.findByAltText('Pending image')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  await user.type(editor, 'Screenshot details')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  await screen.findByRole('button', { name: 'Send' })
  expect(editor).toHaveValue('Screenshot details')
  expect(screen.getByAltText('Pending image')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(screen.queryByAltText('Pending image')).not.toBeInTheDocument()
  )
  const data = vi.mocked(api.post).mock.calls[1][1] as FormData
  expect(data.get('text')).toBe('Screenshot details')
  expect((data.get('file') as File).name).toBe('clipboard.png')
})

test.each(['accepted', 'failed', 'busy'])(
  'shows private bot feedback for %s without resending the chat message',
  async (status) => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, bot_status: status },
    })
    show(<CommunityChat />)
    await screen.findByRole('textbox', { name: 'Message' })
    act(() =>
      FakeSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'history', messages: [] }),
      })
    )
    await user.click(screen.getByRole('button', { name: /Mention bot/ }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const copy = {
      accepted:
        'The assistant notification was accepted by WeChat. Delivery is not confirmed.',
      failed:
        'Message sent, but the assistant notification failed. Please contact an administrator.',
      busy: 'Message sent, but the assistant is busy and was not notified.',
    }
    expect(
      await screen.findByText(copy[status as keyof typeof copy])
    ).toHaveAttribute('role', 'status')
    expect(api.post).toHaveBeenCalledTimes(1)
  }
)

test('selects users by ID and sends a reply reference', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 23,
            user_id: 2,
            name: 'Bob',
            text: 'Original question',
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Reply' }))
  expect(screen.getByText('Replying to Bob')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mention user' }))
  await user.click(await screen.findByRole('option', { name: /Bob/ }))
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/community/messages', {
      text: ' @[Bob](user:2) ',
      reply_to_id: 23,
    })
  )
  expect(
    screen.queryByRole('button', { name: 'Cancel reply' })
  ).not.toBeInTheDocument()
})

test('history renders quoted messages and user mentions without exposing mention encoding', async () => {
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 24,
            user_id: 2,
            name: 'Bob',
            text: '@[Alice](user:1) Here is the answer',
            kind: 'text',
            created_at: 1700000000,
            reply_to_id: 23,
            reply: {
              id: 23,
              name: 'Alice',
              text: 'Quoted question',
              deleted: false,
            },
          },
        ],
      }),
    })
  )
  expect(
    screen.getByText('Quoted question').closest('blockquote')
  ).toBeInTheDocument()
  expect(screen.getByText('@Alice')).toHaveClass('font-bold')
  expect(screen.queryByText('@[Alice](user:1)')).not.toBeInTheDocument()
})

test('oversized pasted images are rejected without posting a message', async () => {
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  const file = new File(['png'], 'large.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 })
  fireEvent.paste(editor, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    },
  })
  expect(screen.queryByAltText('Pending image')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('a new reply selected during sending is preserved when the earlier send finishes', async () => {
  const user = userEvent.setup()
  let finish: (() => void) | undefined
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ data: { success: true } })
      })
  )
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 23,
            user_id: 2,
            name: 'Bob',
            text: 'Question',
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
  )
  await user.type(editor, 'A separate message')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Reply' }))
  await act(async () => {
    finish?.()
  })
  expect(screen.getByText('Replying to Bob')).toBeInTheDocument()
})

test.each([1, 100])(
  'message actions are in a menu and deletion is restricted for role %i',
  async (role) => {
    const user = userEvent.setup()
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: { id: 1, username: 'Alice', role } },
    }))
    show(<CommunityChat />)
    await screen.findByRole('textbox', { name: 'Message' })
    act(() =>
      FakeSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: 'history',
          messages: [
            {
              id: 1,
              user_id: 1,
              name: 'Alice',
              text: 'My message',
              kind: 'text',
              created_at: 1700000000,
            },
            {
              id: 2,
              user_id: 2,
              name: 'Bob',
              deleted: true,
              kind: 'text',
              created_at: 1700000000,
            },
          ],
        }),
      })
    )
    expect(
      screen.queryByRole('button', { name: 'Reply' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete' })
    ).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(
      screen.getAllByRole('button', { name: 'More actions' })
    ).toHaveLength(1)
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('menuitem', { name: 'Reply' })
    ).toBeInTheDocument()
    if (role === 100) {
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      expect(
        screen.getByText('This message will be removed from the chat.')
      ).toBeInTheDocument()
    } else {
      expect(
        screen.queryByRole('menuitem', { name: 'Delete' })
      ).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(trigger).toHaveFocus())
    }
  }
)

test('keeps long sender names and full timestamps outside the clipped message bubble', async () => {
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 1,
            user_id: 2,
            name: 'A long display name that must remain readable',
            text: 'Short body',
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
  )
  const name = screen.getByText('A long display name that must remain readable')
  const bubble = screen.getByText('Short body').parentElement
  expect(bubble?.contains(name)).toBe(false)
  expect(name.parentElement).toHaveClass('flex-wrap')
  const time = name.parentElement?.querySelector('time')
  expect(time).toHaveClass('shrink-0', 'max-w-full')
})

test('Enter sends while Shift+Enter inserts a newline', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.type(editor, 'First line')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(editor).toHaveValue('First line\n')
  expect(api.post).not.toHaveBeenCalled()
  await user.type(editor, 'Second line')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/community/messages', {
      text: 'First line\nSecond line',
    })
  )
})

test('IME confirmation, blank drafts and disconnected Enter never send', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  fireEvent.keyDown(editor, { key: 'Enter' })
  await user.type(editor, '中文输入')
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(api.post).not.toHaveBeenCalled()
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  fireEvent.compositionStart(editor)
  fireEvent.keyDown(editor, { key: 'Enter' })
  fireEvent.compositionEnd(editor)
  fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 })
  expect(api.post).not.toHaveBeenCalled()
  expect(editor).toHaveValue('中文输入')
})
