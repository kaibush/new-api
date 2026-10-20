import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
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
  vi.stubGlobal('WebSocket', FakeSocket)
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

test('uploads a sticker through the shared attachment API and closes the socket on unmount', async () => {
  const user = userEvent.setup()
  const view = show(<CommunityChat />)
  await screen.findByRole('button', { name: 'Sticker' })
  await user.click(screen.getByRole('button', { name: 'Sticker' }))
  await user.upload(
    screen.getByLabelText('Upload attachment'),
    new File(['image'], 'sticker.gif', { type: 'image/gif' })
  )
  await waitFor(() => expect(api.post).toHaveBeenCalled())
  const data = vi.mocked(api.post).mock.calls[0][1] as FormData
  expect(data.get('kind')).toBe('sticker')
  expect((data.get('file') as File).name).toBe('sticker.gif')
  view.unmount()
  expect(FakeSocket.instances[0].close).toHaveBeenCalled()
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

test('emoji popup supports category selection, keyboard insertion and Escape', async () => {
  const user = userEvent.setup()
  show(<CommunityChat />)
  const trigger = await screen.findByRole('button', { name: 'Insert emoji' })
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello ')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const smileys = await screen.findByRole('button', { name: 'Smileys' })
  smileys.focus()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('button', { name: 'Gestures' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  const emoji = screen.getByRole('button', { name: 'Insert 👍' })
  emoji.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Hello 👍'
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(trigger).toHaveFocus()
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
