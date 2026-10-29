import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from 'sonner'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { useSidebarData } from '@/hooks/use-sidebar-data'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommunityChat } from '..'
import { CommunityBotFeedback } from '../bot-feedback'
import { CommunityProvider } from '../provider'
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
    <QueryClientProvider client={client}>
      {component &&
      typeof component === 'object' &&
      'type' in component &&
      component.type === CommunityChat ? (
        <CommunityProvider onOpenChat={() => {}}>{component}</CommunityProvider>
      ) : (
        component
      )}
    </QueryClientProvider>
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
  vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const fields =
      body instanceof FormData
        ? {
            text: body.get('text') || '',
            client_id: body.get('client_id'),
            kind: body.get('kind'),
            filename: (body.get('file') as File)?.name,
          }
        : body
    return {
      data: {
        success: true,
        data: {
          id: 100,
          user_id: 1,
          name: 'Alice',
          avatar: '',
          kind: 'text',
          url: '',
          filename: '',
          size: 0,
          created_at: 1700000000,
          deleted: false,
          ...(fields as object),
        },
      },
    }
  })
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
      client_id: expect.any(String),
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
  await user.type(
    screen.getByRole('textbox', { name: 'Bot reply' }),
    'We received your message.'
  )
  const days = screen.getByRole('spinbutton', { name: 'Chat history (days)' })
  expect(days).toHaveValue(1)
  await user.clear(days)
  await user.type(days, '7')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/api/option/community',
      expect.objectContaining({
        enabled: true,
        history_days: 7,
        name: 'My lounge',
        bot_reply: 'We received your message.',
        app_secret: '',
      })
    )
  )
})

test('invalid history days show an error and cannot be saved', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  show(<SettingsHarness />)
  const days = await screen.findByRole('spinbutton', {
    name: 'Chat history (days)',
  })
  const form = days.closest('form')
  if (!form) throw new Error('History setting must be in a form')
  for (const value of ['', '0', '366', '1.5']) {
    fireEvent.change(days, { target: { value } })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a whole number from 1 to 365.'
    )
    expect(days).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  }
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
  expect(data.get('client_id')).toBe(
    (vi.mocked(api.post).mock.calls[0][1] as FormData).get('client_id')
  )
})

test('shows a sending bubble immediately and reconciles history before the HTTP response', async () => {
  const user = userEvent.setup()
  let finish: ((value: unknown) => void) | undefined
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.type(editor, '@helper hello')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  const bubble = screen.getByRole('log').querySelector('article')
  expect(bubble).toHaveTextContent('@helper hello')
  expect(bubble).toHaveAttribute('aria-busy', 'true')
  expect(editor).toHaveValue('')
  const request = vi.mocked(api.post).mock.calls[0][1] as { client_id: string }
  const sent = {
    id: 42,
    client_id: request.client_id,
    user_id: 1,
    name: 'Alice',
    text: '@helper hello',
    kind: 'text',
    created_at: 1700000000,
  }
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [sent] }),
    })
  )
  expect(screen.getByRole('log').querySelectorAll('article')).toHaveLength(1)
  await act(async () =>
    finish?.({ data: { success: true, data: sent, bot_status: 'accepted' } })
  )
  expect(screen.getByRole('log').querySelectorAll('article')).toHaveLength(1)
  expect(screen.getByRole('log').querySelector('article')).not.toHaveAttribute(
    'aria-busy',
    'true'
  )
  expect(
    screen.queryByText(/Delivery is not confirmed/)
  ).not.toBeInTheDocument()
})

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
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [{ user_id: 2, name: 'Bob', avatar: '' }],
      }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'Mention user' }))
  await user.click(await screen.findByRole('option', { name: /Bob/ }))
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/community/messages', {
      text: ' @[Bob](user:2) ',
      reply_to_id: 23,
      client_id: expect.any(String),
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
        finish = () =>
          resolve({
            data: {
              success: true,
              data: {
                id: 100,
                user_id: 1,
                name: 'Alice',
                text: 'A separate message',
                kind: 'text',
                created_at: 1700000000,
              },
            },
          })
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

test.each([1, 10, 100])(
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
    const bubble = screen.getByText('My message').parentElement
    expect(
      trigger.closest('[data-message-actions]')?.previousElementSibling
    ).toBe(bubble)
    expect(trigger).toHaveClass('size-6')
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('menuitem', { name: 'Reply' })
    ).toBeInTheDocument()
    if (role >= 10) {
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      expect(
        screen.getByText(
          'This message will be removed from the chat. Administrators can still view the original in chat records.'
        )
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
      client_id: expect.any(String),
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

test('a successful send stays visible until history includes it', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.type(editor, 'Just sent')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(
      screen.getByRole('log').querySelector('article')
    ).not.toHaveAttribute('aria-busy', 'true')
  )
  expect(screen.getByRole('log')).toHaveTextContent('Just sent')
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  expect(screen.getByRole('log')).toHaveTextContent('Just sent')
})

test('sending an attachment immediately shows its preview in the chat and restores it on failure', async () => {
  const user = userEvent.setup()
  let reject: ((reason: Error) => void) | undefined
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'Image' }))
  await user.upload(
    screen.getByLabelText('Upload attachment'),
    new File(['png'], 'pending.png', { type: 'image/png' })
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(screen.getByAltText('pending.png').closest('article')).toHaveAttribute(
    'aria-busy',
    'true'
  )
  expect(screen.queryByAltText('Pending image')).not.toBeInTheDocument()
  await act(async () => reject?.(new Error('Upload failed')))
  expect(await screen.findByAltText('Pending image')).toBeInTheDocument()
  expect(
    screen.getByRole('log').querySelector('article')
  ).not.toBeInTheDocument()
})

test('bot messages display their quoted question and highlight the mentioned sender', async () => {
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 42,
            user_id: 0,
            is_bot: true,
            name: 'helper',
            text: '@[Alice](user:1) We received your message.',
            kind: 'text',
            created_at: 1700000000,
            reply_to_id: 41,
            reply: {
              id: 41,
              name: 'Alice',
              text: 'My question',
              deleted: false,
            },
          },
        ],
      }),
    })
  )
  expect(screen.getByText('Bot')).toBeInTheDocument()
  expect(
    screen.getByText('My question').closest('blockquote')
  ).toBeInTheDocument()
  expect(screen.getByText('@Alice')).toHaveClass('font-bold')
  expect(screen.getByText('@Alice').closest('article')).not.toHaveClass(
    'flex-row-reverse'
  )
})

test('administrators browse mention totals and paginated feedback with readable mentions', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        total: 21,
        items: [
          {
            id: 42,
            message_id: 41,
            reply_id: 42,
            user_id: 1,
            name: 'Alice',
            text:
              config?.params?.page === 2
                ? 'Earlier question'
                : 'Latest question',
            filename: '',
            bot_name: 'helper',
            reply_text: '@[Alice](user:1) We received your message.',
            created_at: 1700000000,
          },
        ],
      },
    },
  }))
  show(<CommunityBotFeedback />)
  expect(await screen.findByText('Latest question')).toBeInTheDocument()
  expect(screen.getByText('Total mentions: 21')).toBeInTheDocument()
  expect(screen.getByText('@Alice')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('Earlier question')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/api/community/bot-feedback', {
    params: { page: 2, page_size: 20 },
  })
})

test('feedback records show an empty state when no bot has replied', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { total: 0, items: [] } },
  })
  show(<CommunityBotFeedback />)
  expect(await screen.findByText('No bot feedback yet')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

test('a message confirmed by history stays sent when the HTTP response is lost', async () => {
  const user = userEvent.setup()
  let fail: ((error: Error) => void) | undefined
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.type(editor, 'Already delivered')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  const request = vi.mocked(api.post).mock.calls[0][1] as { client_id: string }
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 42,
            client_id: request.client_id,
            user_id: 1,
            name: 'Alice',
            text: 'Already delivered',
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
  )
  await act(async () => fail?.(new Error('Response lost')))
  expect(editor).toHaveValue('')
  expect(screen.getByRole('log').querySelectorAll('article')).toHaveLength(1)
  expect(screen.getByRole('log')).toHaveTextContent('Already delivered')
})

test('failed feedback loading offers retry and recovers to the record list', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({
      data: { success: true, data: { total: 0, items: [] } },
    })
  show(<CommunityBotFeedback />)
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No bot feedback yet')).toBeInTheDocument()
})

test('settings tabs expose feedback records and preserve the reply draft when returning', async () => {
  const user = userEvent.setup()
  show(<SettingsHarness />)
  const reply = await screen.findByRole('textbox', { name: 'Bot reply' })
  expect(screen.getByRole('tablist', { name: 'Community chat' })).toHaveClass(
    'overflow-x-auto'
  )
  expect(screen.getByRole('tab', { name: 'Bot feedback records' })).toHaveClass(
    'whitespace-nowrap',
    'flex-none'
  )
  await user.type(reply, 'Draft reply')
  await user.click(screen.getByRole('tab', { name: 'Bot feedback records' }))
  expect(await screen.findByText('No bot feedback yet')).toBeInTheDocument()
  expect(
    screen.getByRole('tab', { name: 'Bot feedback records' })
  ).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('textbox', { name: 'Bot reply' })).toHaveValue(
    'Draft reply'
  )
})

function historyMessage(id: number, text: string) {
  return {
    id,
    user_id: 2,
    name: 'Bob',
    text,
    avatar: '',
    kind: 'text' as const,
    url: '',
    filename: '',
    size: 0,
    created_at: 1700000000,
    deleted: false,
  }
}

test('a history window moving forward preserves loaded messages that are still in range', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  const socket = FakeSocket.instances[0]
  const start = 1700000000
  const latest = {
    ...historyMessage(60, 'Recent question'),
    created_at: start + 86400,
  }
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest],
        has_more: true,
        day_start: start,
        day_end: 0,
        history_days: 7,
      }),
    })
  )
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        items: [
          { ...historyMessage(1, 'Expired question'), created_at: start },
          {
            ...historyMessage(2, 'Earlier conversation'),
            created_at: start + 86400,
          },
        ],
        has_more: false,
        day_start: start,
        day_end: 0,
        history_days: 7,
        deleted_ids: [],
      },
    },
  })
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  expect(await screen.findByText('Earlier conversation')).toBeInTheDocument()
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest],
        has_more: true,
        day_start: start + 86400,
        day_end: 0,
        history_days: 7,
      }),
    })
  )
  expect(screen.getByText('Earlier conversation')).toBeInTheDocument()
  expect(screen.queryByText('Expired question')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Load earlier messages' })
  ).not.toBeInTheDocument()
})

test('message expiry removes only expired history and quotes while keeping the current draft', async () => {
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  vi.useFakeTimers()
  try {
    const end = Math.floor(Date.now() / 1000) + 2
    act(() =>
      FakeSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: 'history',
          history_days: 7,
          day_start: end - 7 * 86400,
          day_end: end,
          messages: [
            {
              ...historyMessage(1, 'Expired original'),
              created_at: end - 7 * 86400,
              expires_at: end,
            },
            {
              ...historyMessage(2, 'Continued discussion'),
              created_at: end - 86400,
              expires_at: end + 86400,
              reply_to_id: 1,
              reply: {
                id: 1,
                name: 'Bob',
                text: 'Expired original',
                filename: '',
                deleted: false,
                expires_at: end,
              },
            },
          ],
        }),
      })
    )
    fireEvent.change(editor, { target: { value: 'My unfinished reply' } })
    act(() => FakeSocket.instances[0].onclose?.())
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.getByText('Continued discussion')).toBeInTheDocument()
    expect(screen.queryByText('Expired original')).not.toBeInTheDocument()
    expect(editor).toHaveValue('My unfinished reply')
  } finally {
    vi.useRealTimers()
  }
})

test('changing the configured range discards stale pagination and allows loading the expanded history', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  const socket = FakeSocket.instances[0]
  const latest = historyMessage(60, 'Latest message')
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest],
        has_more: true,
        day_start: 1700000000,
        history_days: 1,
      }),
    })
  )
  let resolve: ((value: unknown) => void) | undefined
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest],
        has_more: true,
        day_start: 1699400000,
        history_days: 7,
      }),
    })
  )
  await act(async () =>
    resolve?.({
      data: {
        success: true,
        data: {
          items: [historyMessage(1, 'Stale page')],
          has_more: false,
          day_start: 1700000000,
          day_end: 0,
          history_days: 1,
          deleted_ids: [],
        },
      },
    })
  )
  expect(screen.queryByText('Stale page')).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        items: [
          {
            ...historyMessage(2, 'Earlier in the week'),
            created_at: 1699500000,
          },
        ],
        has_more: false,
        day_start: 1699400000,
        day_end: 0,
        history_days: 7,
        deleted_ids: [],
      },
    },
  })
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  expect(await screen.findByText('Earlier in the week')).toBeInTheDocument()
  expect(screen.getByText('Latest message')).toBeInTheDocument()
})

test('loading today’s older messages preserves the scroll position and survives live refresh and deletion', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  const log = screen.getByRole('log')
  let height = 1000
  Object.defineProperty(log, 'scrollHeight', { get: () => height })
  Object.defineProperty(log, 'clientHeight', { value: 300 })
  const latest = historyMessage(60, 'Recent question')
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest],
        has_more: true,
      }),
    })
  )
  log.scrollTop = 20
  fireEvent.scroll(log)
  let resolve: ((value: unknown) => void) | undefined
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  expect(log.querySelector('button[disabled]')).toBeInTheDocument()
  height = 1500
  await act(async () =>
    resolve?.({
      data: {
        success: true,
        data: {
          items: [historyMessage(1, 'Earlier today')],
          has_more: false,
          day_start: 0,
          day_end: 0,
          deleted_ids: [],
        },
      },
    })
  )
  expect(await screen.findByText('Earlier today')).toBeInTheDocument()
  expect(log.scrollTop).toBe(520)
  expect(api.get).toHaveBeenCalledWith('/api/community/messages', {
    params: { before_id: 60, limit: 50 },
  })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest, historyMessage(61, 'New live message')],
        has_more: true,
      }),
    })
  )
  expect(screen.getByText('Earlier today')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Load earlier messages' })
  ).not.toBeInTheDocument()
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [latest, historyMessage(61, 'New live message')],
        has_more: true,
        deleted_ids: [1],
      }),
    })
  )
  expect(screen.queryByText('Earlier today')).not.toBeInTheDocument()
  expect(screen.getByText('Message deleted')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Chat records' })
  ).not.toBeInTheDocument()
})

test('a failed history page can be retried and a new day clears previously loaded messages', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [{ ...historyMessage(60, 'Previous day'), created_at: 1 }],
        has_more: true,
        day_start: 1,
      }),
    })
  )
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ ...historyMessage(1, 'Old morning'), created_at: 1 }],
          has_more: false,
          day_start: 1,
          day_end: 0,
          deleted_ids: [],
        },
      },
    })
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  await user.click(
    await within(screen.getByRole('log', { name: 'Chat messages' })).findByRole(
      'button',
      { name: 'Retry' }
    )
  )
  expect(await screen.findByText('Old morning')).toBeInTheDocument()
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(70, 'New day')],
        has_more: false,
        day_start: 2,
      }),
    })
  )
  expect(screen.queryByText('Previous day')).not.toBeInTheDocument()
  expect(screen.queryByText('Old morning')).not.toBeInTheDocument()
  expect(screen.getByText('New day')).toBeInTheDocument()
})

test('administrator history loads older dates and preserves deleted originals and quoted content', async () => {
  const user = userEvent.setup()
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Alice', role: 10 } },
  }))
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  vi.mocked(api.get)
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              ...historyMessage(60, 'Deleted original'),
              deleted: true,
              reply_to_id: 1,
              reply: {
                id: 1,
                name: 'Alice',
                text: 'Deleted quote',
                deleted: true,
              },
            },
          ],
          has_more: true,
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [historyMessage(1, 'Last month')], has_more: false },
      },
    })
  await user.click(screen.getByRole('button', { name: 'Chat records' }))
  expect(await screen.findByText('Deleted original')).toBeInTheDocument()
  expect(screen.getByText('Deleted quote')).toBeInTheDocument()
  expect(screen.getByText('Message deleted')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  expect(await screen.findByText('Last month')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/api/community/history', {
    params: { before_id: 60, limit: 50 },
  })
  expect(
    screen.queryByRole('button', { name: 'Load earlier messages' })
  ).not.toBeInTheDocument()
})

test('a late history response cannot bring back messages from the previous day', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [{ ...historyMessage(60, 'Before midnight'), created_at: 1 }],
        has_more: true,
        day_start: 1,
      }),
    })
  )
  let resolve: ((value: unknown) => void) | undefined
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(70, 'After midnight')],
        has_more: false,
        day_start: 2,
      }),
    })
  )
  await act(async () =>
    resolve?.({
      data: {
        success: true,
        data: {
          items: [historyMessage(1, 'Expired history')],
          has_more: false,
          day_start: 1,
          day_end: 0,
          deleted_ids: [],
        },
      },
    })
  )
  expect(screen.queryByText('Expired history')).not.toBeInTheDocument()
  expect(screen.queryByText('Before midnight')).not.toBeInTheDocument()
  expect(screen.getByText('After midnight')).toBeInTheDocument()
})

test('the server day boundary clears visible history even when the socket is disconnected', async () => {
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  vi.useFakeTimers()
  try {
    const end = Math.floor(Date.now() / 1000) + 2
    act(() =>
      FakeSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: 'history',
          messages: [
            {
              ...historyMessage(1, 'Expires at midnight'),
              created_at: end - 1,
            },
          ],
          day_start: end - 86400,
          day_end: end,
        }),
      })
    )
    expect(screen.getByText('Expires at midnight')).toBeInTheDocument()
    act(() => FakeSocket.instances[0].onclose?.())
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.queryByText('Expires at midnight')).not.toBeInTheDocument()
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('another sender using the same request ID cannot acknowledge a failed local message', async () => {
  const user = userEvent.setup()
  let fail: ((error: Error) => void) | undefined
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  show(<CommunityChat />)
  const editor = await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [] }),
    })
  )
  await user.type(editor, 'Keep my draft')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  const request = vi.mocked(api.post).mock.calls[0][1] as { client_id: string }
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            ...historyMessage(42, 'Other sender'),
            client_id: request.client_id,
          },
        ],
      }),
    })
  )
  await act(async () => fail?.(new Error('Not delivered')))
  expect(editor).toHaveValue('Keep my draft')
  expect(screen.getByRole('log')).toHaveTextContent('Other sender')
})

test('mention options include only connected chat users and disappear on departure or disconnect', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  const socket = FakeSocket.instances[0]
  act(() => {
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [
          {
            id: 91,
            user_id: 2,
            name: 'Offline author',
            text: 'Previous message',
            kind: 'text',
            created_at: 1700000000,
          },
        ],
      }),
    })
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [{ user_id: 3, name: 'Online visitor', avatar: '' }],
      }),
    })
  })
  await user.click(screen.getByRole('button', { name: 'Mention user' }))
  expect(
    await screen.findByRole('option', { name: /Online visitor/ })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('option', { name: /Offline author/ })
  ).not.toBeInTheDocument()
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({ type: 'presence', users: [] }),
    })
  )
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'presence',
        users: [{ user_id: 3, name: 'Online visitor', avatar: '' }],
      }),
    })
  )
  expect(
    await screen.findByRole('option', { name: /Online visitor/ })
  ).toBeInTheDocument()
  act(() => socket.onclose?.())
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
})

test('an administrator can delete another user message after confirmation', async () => {
  const user = userEvent.setup()
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Alice', role: 10 } },
  }))
  vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } })
  show(<CommunityChat />)
  await screen.findByRole('textbox', { name: 'Message' })
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(23, 'Other user message')],
      }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  expect(api.delete).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(api.delete).toHaveBeenCalledWith('/api/community/messages/23')
  )
})

test('archive messages offer deletion without offering reply', async () => {
  const { ChatMessageBubble } = await import('../message-bubble')
  const user = userEvent.setup()
  const remove = vi.fn()
  show(
    <ChatMessageBubble
      message={historyMessage(1, 'Old archive message')}
      showDeletedContent
      onRemove={remove}
    />
  )
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  expect(
    screen.queryByRole('menuitem', { name: 'Reply' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

test('clearing the chat discards loaded history and stale pages while preserving the draft and new messages', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const draft = await screen.findByRole('textbox', { name: 'Message' })
  const socket = FakeSocket.instances[0]
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(60, 'Before clear')],
        has_more: true,
        cleared_through_id: 0,
      }),
    })
  )
  await user.type(draft, 'Keep my draft')
  let finish: (value: unknown) => void = () => {}
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Load earlier messages' })
  )
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [],
        has_more: false,
        cleared_through_id: 60,
      }),
    })
  )
  expect(screen.queryByText('Before clear')).not.toBeInTheDocument()
  expect(screen.getByText('No messages yet')).toBeInTheDocument()
  await act(async () =>
    finish({
      data: {
        success: true,
        data: {
          items: [historyMessage(1, 'Late old page')],
          has_more: true,
          day_start: 0,
          day_end: 0,
          deleted_ids: [],
          cleared_through_id: 0,
        },
      },
    })
  )
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(60, 'Stale snapshot')],
        has_more: true,
        cleared_through_id: 0,
      }),
    })
  )
  expect(screen.queryByText('Late old page')).not.toBeInTheDocument()
  expect(screen.queryByText('Stale snapshot')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Load earlier messages' })
  ).not.toBeInTheDocument()
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [historyMessage(61, 'After clear')],
        has_more: false,
        cleared_through_id: 60,
      }),
    })
  )
  expect(screen.getByText('After clear')).toBeInTheDocument()
  expect(draft).toHaveValue('Keep my draft')
})

test('clear confirmation permits cancellation, blocks repeat requests, and keeps failures retryable', async () => {
  const { ChatModerationDialog } = await import('../moderation-dialog')
  const user = userEvent.setup()
  const close = vi.fn()
  const cleared = vi.fn()
  const rendered = show(
    <ChatModerationDialog target='all' onClose={close} onCleared={cleared} />
  )
  expect(
    screen.getByText(
      /Administrators can still view the original messages and bot feedback/
    )
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(close).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  close.mockClear()
  let finish: (value: unknown) => void = () => {}
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Clear all conversations' })
  )
  expect(
    screen.getByRole('button', { name: 'Clear all conversations' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await act(async () =>
    finish({
      data: { success: false, message: 'Could not clear conversations' },
    })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Clear all conversations' })
    ).toBeEnabled()
  )
  expect(close).not.toHaveBeenCalled()
  expect(cleared).not.toHaveBeenCalled()
  vi.mocked(api.post).mockResolvedValueOnce({
    data: {
      success: true,
      data: { cleared_through_id: 60, message_count: 60 },
    },
  })
  await user.click(
    screen.getByRole('button', { name: 'Clear all conversations' })
  )
  await waitFor(() => expect(cleared).toHaveBeenCalledWith(60))
  expect(api.post).toHaveBeenLastCalledWith('/api/community/messages/clear', {
    confirm: true,
  })
  expect(close).toHaveBeenCalledOnce()
  rendered.unmount()
})

test('administrator history exposes clear controls and marks cleared originals', async () => {
  const { CommunityHistory } = await import('../history')
  const user = userEvent.setup()
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'Alice', role: 10 } },
  }))
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [{ ...historyMessage(1, 'Retained original'), cleared: true }],
        has_more: false,
      },
    },
  })
  show(<CommunityHistory />)
  expect(await screen.findByText('Retained original')).toBeInTheDocument()
  expect(screen.getByText('Cleared from chat')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Clear all conversations' })
  )
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('a delayed send response cannot restore a cleared message or its quoted content', async () => {
  const { useChat } = await import('../use-chat')
  const client = new QueryClient()
  const { result } = renderHook(() => useChat(true), {
    wrapper: (props) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  })
  act(() => {
    result.current.onSending({
      ...historyMessage(-1, 'Pending text'),
      sending: true,
      client_id: 'pending',
    })
    result.current.clearThrough(60)
    result.current.onSent('pending', historyMessage(50, 'Late cleared message'))
  })
  expect(result.current.messages).toEqual([])
  act(() => {
    result.current.onSending({
      ...historyMessage(-2, 'New text'),
      sending: true,
      client_id: 'new',
    })
    result.current.onSent('new', {
      ...historyMessage(61, 'New text'),
      reply_to_id: 50,
      reply: {
        id: 50,
        text: 'Cleared quote',
        filename: '',
        name: 'Bob',
        deleted: false,
      },
    })
  })
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].text).toBe('New text')
  expect(result.current.messages[0].reply).toBeUndefined()
})

test('site presence survives entering and leaving the lobby and closes on logout', async () => {
  function Site() {
    const [lobby, setLobby] = useState(false)
    return (
      <CommunityProvider onOpenChat={() => setLobby(true)}>
        <button type='button' onClick={() => setLobby(!lobby)}>
          Switch page
        </button>
        {lobby ? <CommunityChat /> : <p>Dashboard</p>}
      </CommunityProvider>
    )
  }
  const user = userEvent.setup()
  show(<Site />)
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  const socket = FakeSocket.instances[0]
  await user.click(screen.getByRole('button', { name: 'Switch page' }))
  await screen.findByRole('textbox', { name: 'Message' })
  await user.click(screen.getByRole('button', { name: 'Switch page' }))
  expect(screen.getByText('Dashboard')).toBeInTheDocument()
  expect(FakeSocket.instances).toHaveLength(1)
  expect(socket.close).not.toHaveBeenCalled()
  act(() =>
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: null, accessToken: '' },
    }))
  )
  expect(socket.close).toHaveBeenCalledOnce()
})

test('new mentions notify outside the lobby, without replaying history or other users mentions', async () => {
  const opened = vi.fn()
  const notices: {
    title: string
    options: NotificationOptions
    onclick?: () => void
    close: ReturnType<typeof vi.fn>
  }[] = []
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal(
    'Notification',
    class {
      static permission = 'granted'
      close = vi.fn()
      constructor(
        public title: string,
        public options: NotificationOptions
      ) {
        notices.push(this)
      }
    }
  )
  vi.spyOn(window, 'focus').mockImplementation(() => {})
  show(
    <CommunityProvider onOpenChat={opened}>
      <p>Dashboard</p>
    </CommunityProvider>
  )
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  const socket = FakeSocket.instances[0]
  const mentioned = {
    ...historyMessage(10, 'Hello @[Alice](user:1)'),
    user_id: 2,
  }
  act(() =>
    socket.onmessage?.({
      data: JSON.stringify({ type: 'history', messages: [mentioned] }),
    })
  )
  expect(notices).toHaveLength(0)
  const messages = [
    mentioned,
    { ...mentioned, id: 11 },
    { ...mentioned, id: 12, user_id: 1 },
    { ...mentioned, id: 13, text: '@[Alice](user:3)' },
    { ...mentioned, id: 14, deleted: true },
    { ...mentioned, id: 15, expires_at: 1 },
    {
      ...mentioned,
      id: 16,
      text: 'reply only',
      reply: { id: 10, text: mentioned.text },
    },
  ]
  act(() =>
    socket.onmessage?.({ data: JSON.stringify({ type: 'history', messages }) })
  )
  expect(notices).toHaveLength(1)
  expect(notices[0].options.body).toBe('Hello @Alice')
  act(() =>
    socket.onmessage?.({ data: JSON.stringify({ type: 'history', messages }) })
  )
  expect(notices).toHaveLength(1)
  vi.useFakeTimers()
  try {
    act(() => socket.onclose?.())
    act(() => vi.advanceTimersByTime(3000))
    const reconnected = FakeSocket.instances[1]
    act(() =>
      reconnected.onmessage?.({
        data: JSON.stringify({ type: 'history', messages }),
      })
    )
    expect(notices).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
  act(() => notices[0].onclick?.())
  expect(opened).toHaveBeenCalledOnce()
  expect(notices[0].close).toHaveBeenCalledOnce()
})

test('mention notification permission is requested only after a user action', async () => {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal(
    'Notification',
    class {
      static permission = 'default'
      static requestPermission = requestPermission
    }
  )
  const user = userEvent.setup()
  show(<CommunityChat />)
  const button = await screen.findByRole('button', {
    name: 'Enable mention notifications',
  })
  expect(requestPermission).not.toHaveBeenCalled()
  await user.click(button)
  await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Enable mention notifications' })
    ).not.toBeInTheDocument()
  )
})

test.each(['denied', 'unsupported', 'constructor-failure'])(
  'mentions fall back to site alerts when browser notifications are %s',
  async (mode) => {
    const { useMentionNotifications } =
      await import('../use-mention-notifications')
    const showToast = vi.spyOn(toast, 'info')
    const openChat = vi.fn()
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal(
      'Notification',
      mode === 'unsupported'
        ? undefined
        : class {
            static permission = mode === 'denied' ? 'denied' : 'granted'
            constructor() {
              throw new Error('Unsupported constructor')
            }
          }
    )
    const { result } = renderHook(() => useMentionNotifications(true, openChat))
    act(() =>
      result.current.notify([
        { ...historyMessage(22, 'Hi @[Alice](user:1)'), user_id: 2 },
      ])
    )
    expect(showToast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: 'Hi @Alice',
        action: { label: 'Community chat', onClick: openChat },
      })
    )
  }
)

test('guest pages and disabled community chat do not open a presence connection', async () => {
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: null, accessToken: '' },
  }))
  const rendered = show(
    <CommunityProvider onOpenChat={() => {}}>
      <p>Public page</p>
    </CommunityProvider>
  )
  expect(api.get).not.toHaveBeenCalled()
  expect(FakeSocket.instances).toHaveLength(0)
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { enabled: false } },
  })
  act(() =>
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 1, username: 'Alice', role: 1 },
        accessToken: 'test-session-token',
      },
    }))
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/community/status')
  )
  expect(FakeSocket.instances).toHaveLength(0)
  rendered.unmount()
})

const giftPacket = {
  id: 80,
  user_id: 2,
  name: 'Bob',
  greeting: 'Good luck',
  total: 2,
  claimed: 0,
  created_at: 1700000000,
  expires_at: 4102444800,
  records: [],
  redeemed: false,
}

test('red packets in the board and conversation open the same detail and preserve the draft', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/community/status') {
      return {
        data: { success: true, data: { enabled: true, name: 'Lounge' } },
      }
    }
    return {
      data: {
        success: true,
        data: url === '/api/community/red-packets' ? [giftPacket] : giftPacket,
      },
    }
  })
  show(<CommunityChat />)
  const draft = await screen.findByRole('textbox', { name: 'Message' })
  await user.type(draft, 'Keep writing')
  act(() =>
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'history',
        messages: [{ ...historyMessage(80, 'Good luck'), kind: 'red_packet' }],
      }),
    })
  )
  const cards = await screen.findAllByRole('button', { name: /Good luck/ })
  expect(cards).toHaveLength(2)
  await user.click(cards[0])
  expect(
    await screen.findByRole('dialog', { name: 'Quota red packet' })
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: 'Open red packet' })
  ).toBeEnabled()
  expect(
    screen.queryByText('11111111111111111111111111111111')
  ).not.toBeInTheDocument()
  const target = document.querySelector<HTMLElement>('#message-80')
  if (!target) throw new Error('Message target missing')
  Object.defineProperty(target, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  await user.click(screen.getByRole('button', { name: 'View in chat' }))
  await waitFor(() => expect(target).toHaveFocus())
  expect(target.scrollIntoView).toHaveBeenCalledWith({
    block: 'center',
    behavior: 'instant',
  })
  expect(draft).toHaveValue('Keep writing')
  await user.click(cards[1])
  expect(
    await screen.findByRole('dialog', { name: 'Quota red packet' })
  ).toBeInTheDocument()
})

test('claiming disables repeat requests, shows the assigned code and updates shared progress', async () => {
  const { RedPacketDetailDialog } = await import('../red-packet-detail')
  const user = userEvent.setup()
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: giftPacket },
  })
  let finish: (value: unknown) => void = () => {}
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  show(<RedPacketDetailDialog id={80} onClose={() => {}} onLocate={() => {}} />)
  const open = await screen.findByRole('button', { name: 'Open red packet' })
  await user.click(open)
  expect(open).toBeDisabled()
  await act(async () =>
    finish({
      data: {
        success: true,
        data: {
          ...giftPacket,
          claimed: 1,
          my_code: '11111111111111111111111111111111',
          my_quota: 100,
          records: [{ user_id: 1, name: 'Alice', claimed_at: 1700000000 }],
        },
      },
    })
  )
  expect(
    await screen.findByText('11111111111111111111111111111111')
  ).toBeInTheDocument()
  expect(screen.getByText('1 / 2 claimed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Redeem to wallet' })).toBeEnabled()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

test.each(['expired', 'exhausted'])(
  '%s red packets show records and disable new claims',
  async (state) => {
    const { RedPacketDetailDialog } = await import('../red-packet-detail')
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          ...giftPacket,
          expires_at: state === 'expired' ? 1 : giftPacket.expires_at,
          claimed: state === 'exhausted' ? 2 : 0,
        },
      },
    })
    show(
      <RedPacketDetailDialog id={80} onClose={() => {}} onLocate={() => {}} />
    )
    expect(
      await screen.findByRole('button', {
        name: state === 'expired' ? 'Expired' : 'All claimed',
      })
    ).toBeDisabled()
    expect(
      screen.getByRole('region', { name: 'Claim records' })
    ).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  }
)

test('invalid duplicate codes prevent publishing and a failed publish preserves the draft', async () => {
  const { RedPacketCreate } = await import('../red-packet-create')
  const user = userEvent.setup()
  const created = vi.fn()
  show(<RedPacketCreate onClose={() => {}} onCreated={created} />)
  const codes = screen.getByRole('textbox', { name: 'Redemption codes' })
  await user.type(
    codes,
    '11111111111111111111111111111111\n11111111111111111111111111111111'
  )
  await user.click(screen.getByRole('button', { name: 'Send a red packet' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter 1 to 100 unique, 32-character codes.'
  )
  expect(codes).toHaveAttribute('aria-invalid', 'true')
  expect(api.post).not.toHaveBeenCalled()
  await user.clear(codes)
  await user.type(codes, '11111111111111111111111111111111')
  vi.mocked(api.post).mockRejectedValueOnce(
    new Error('Could not send red packet')
  )
  await user.click(screen.getByRole('button', { name: 'Send a red packet' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send a red packet' })
    ).toBeEnabled()
  )
  expect(codes).toHaveValue('11111111111111111111111111111111')
  expect(created).not.toHaveBeenCalled()
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: true, data: giftPacket },
  })
  await user.click(screen.getByRole('button', { name: 'Send a red packet' }))
  await waitFor(() => expect(created).toHaveBeenCalledWith(giftPacket))
})

test('the compact board entry opens the public content without replacing the composer', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/community/status' ? { enabled: true } : [],
    },
  }))
  show(<CommunityChat />)
  const entry = await screen.findByRole('button', { name: 'Community board' })
  expect(entry).toHaveClass('lg:hidden')
  const composer = screen.getByRole('textbox', { name: 'Message' })
  await user.type(composer, 'Draft')
  await user.click(entry)
  expect(
    await screen.findByRole('dialog', { name: 'Community board' })
  ).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(composer).toHaveValue('Draft')
  expect(
    screen.queryByRole('button', { name: 'Send a red packet' })
  ).not.toBeInTheDocument()
})
