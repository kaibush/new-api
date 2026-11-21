import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
  cleanup,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { BoardActionButton } from '../custom-block'
import { boardSchema, defaultBoard, safeBoardURL } from '../schema'
import { BoardEditor, BoardStudio } from '../studio'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.forEach((c) => c.clear())
  clients.length = 0
  vi.restoreAllMocks()
})
function showEditor(initial = defaultBoard()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/status' ? { checkin_enabled: false } : [],
    },
  }))
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider
        router={createRouter({
          routeTree: createRootRoute(),
          history: createMemoryHistory(),
        })}
      >
        <BoardEditor initial={initial} />
      </RouterContextProvider>
    </QueryClientProvider>
  )
}
test('unsafe destinations and unknown routes cannot be published', () => {
  for (const value of [
    'javascript:alert(1)',
    '//example.com',
    'https://user:pass@example.com',
    'https://example.com\\evil',
  ]) {
    expect(safeBoardURL(value)).toBe(false)
  }
  const d = defaultBoard()
  d.blocks.push({
    id: 'card',
    type: 'custom.action_card',
    enabled: true,
    title: '',
    body: '',
    image_url: '',
    actions: [{ type: 'internal_route', label: 'Go', value: '/admin' }],
  })
  expect(boardSchema.safeParse(d).success).toBe(false)
  const added = d.blocks.at(-1)
  if (!added) throw new Error('Expected the added card')
  added.actions[0].value = '/models'
  expect(boardSchema.safeParse(d).success).toBe(true)
})
test('move, disable and remove blocks are reflected in published order', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, data) => ({
    data: { success: true, data: { ...boardSchema.parse(data), version: 1 } },
  }))
  showEditor()
  const sections = screen.getAllByRole('region')
  await user.click(within(sections[1]).getByRole('button', { name: 'Move up' }))
  await user.click(within(sections[0]).getByRole('switch', { name: 'Enabled' }))
  await user.click(within(sections[2]).getByRole('button', { name: 'Remove' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  const document = boardSchema.parse(put.mock.calls[0][1])
  expect(document.blocks.map((b: { type: string }) => b.type)).toEqual([
    'builtin.checkin_leaderboard',
    'builtin.checkin',
    'builtin.red_packets',
    'builtin.red_packet_rules',
  ])
  expect(document.blocks[1].enabled).toBe(false)
})
test('failed publish keeps unsaved card text available for correction', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockRejectedValue(new Error('Conflict'))
  showEditor()
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'My board')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My board')
})
test('content action opens a keyboard accessible dialog and unsafe actions are hidden', async () => {
  const user = userEvent.setup()
  render(
    <>
      <BoardActionButton
        action={{
          type: 'modal_content',
          label: 'Read notice',
          value: 'Community notice',
        }}
      />
      <BoardActionButton
        action={{
          type: 'external_url',
          label: 'Unsafe',
          value: 'javascript:alert(1)',
        }}
      />
    </>
  )
  expect(
    screen.queryByRole('button', { name: 'Unsafe' })
  ).not.toBeInTheDocument()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(
    await screen.findByRole('dialog', { name: 'Read notice' })
  ).toBeInTheDocument()
  expect(await screen.findByText('Community notice')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

test('duplicate singleton widgets and hidden builtin action payloads cannot be published', () => {
  const document = defaultBoard()
  document.blocks.push({ ...document.blocks[0], id: 'duplicate' })
  expect(boardSchema.safeParse(document).success).toBe(false)
  document.blocks.pop()
  document.blocks[0].actions = [
    { type: 'copy_text', label: 'Copy', value: 'hidden' },
  ]
  expect(boardSchema.safeParse(document).success).toBe(false)
})

test('restoring defaults requires confirmation and does not publish until saved', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  showEditor()
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Draft board')
  await user.click(screen.getByRole('button', { name: 'Restore defaults' }))
  let dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Draft board'
  )
  await user.click(screen.getByRole('button', { name: 'Restore defaults' }))
  dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
  expect(put).not.toHaveBeenCalled()
})

test('import validates the document and keeps the current publication version', async () => {
  const user = userEvent.setup()
  const initial = { ...defaultBoard(), version: 7 }
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, data) => ({
    data: { success: true, data: { ...boardSchema.parse(data), version: 8 } },
  }))
  showEditor(initial)
  await user.click(screen.getByRole('button', { name: 'Import / Export' }))
  const dialog = screen.getByRole('dialog')
  const input = within(dialog).getByRole('textbox', {
    name: 'Board configuration',
  })
  fireEvent.input(input, { target: { value: '{bad' } })
  await user.click(within(dialog).getByRole('button', { name: 'Import' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Invalid community board configuration'
  )
  fireEvent.input(input, {
    target: {
      value: JSON.stringify({
        ...defaultBoard(),
        version: 90,
        title: 'Imported',
        blocks: [],
      }),
    },
  })
  await user.click(within(dialog).getByRole('button', { name: 'Import' }))
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Imported')
  expect(put).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/option/community/board',
      expect.objectContaining({ version: 7, title: 'Imported', blocks: [] })
    )
  )
})

test('external links request confirmation and chat actions only fill a draft', async () => {
  const user = userEvent.setup()
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const prefill = vi.fn()
  render(
    <>
      <BoardActionButton
        action={{
          type: 'external_url',
          label: 'Visit',
          value: 'https://example.com',
          confirm_leave: true,
        }}
      />
      <BoardActionButton
        action={{
          type: 'chat_prefill',
          label: 'Discuss',
          value: 'Hello community',
        }}
        onPrefill={prefill}
      />
    </>
  )
  await user.click(screen.getByRole('button', { name: 'Visit' }))
  expect(open).not.toHaveBeenCalled()
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Continue',
    })
  )
  expect(open).toHaveBeenCalledWith(
    'https://example.com',
    '_blank',
    'noopener,noreferrer'
  )
  await user.click(screen.getByRole('button', { name: 'Discuss' }))
  expect(prefill).toHaveBeenCalledWith('Hello community')
})

test('a leaderboard block applies its selected view, entry limit and full-page destination', async () => {
  const { BoardLeaderboard } = await import('../leaderboard')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { checkin_enabled: true }
          : {
              enabled: true,
              top: [
                {
                  rank: 1,
                  display_name: 'Daily winner',
                  username: 'daily',
                  quota_awarded: 100,
                },
              ],
              recent_totals: [
                {
                  rank: 1,
                  display_name: 'First total',
                  username: 'one',
                  quota_awarded: 400,
                },
                {
                  rank: 2,
                  display_name: 'Second total',
                  username: 'two',
                  quota_awarded: 300,
                },
                {
                  rank: 3,
                  display_name: 'Third total',
                  username: 'three',
                  quota_awarded: 200,
                },
                {
                  rank: 4,
                  display_name: 'Fourth total',
                  username: 'four',
                  quota_awarded: 100,
                },
              ],
            },
    },
  }))
  const block = {
    ...defaultBoard().blocks[1],
    leaderboard_tab: 'total' as const,
    leaderboard_limit: 3,
    leaderboard_route: true,
  }
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider
        router={createRouter({
          routeTree: createRootRoute(),
          history: createMemoryHistory(),
        })}
      >
        <BoardLeaderboard block={block} />
      </RouterContextProvider>
    </QueryClientProvider>
  )
  expect(await screen.findByText(/First total/)).toBeInTheDocument()
  expect(screen.getByText(/Third total/)).toBeInTheDocument()
  expect(screen.queryByText(/Fourth total/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Daily winner/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'View full leaderboard' })
  ).toHaveAttribute('href', '/checkin-leaderboard')
})

test('rich-text dialogs sanitize executable HTML from administrator content', async () => {
  const user = userEvent.setup()
  render(
    <BoardActionButton
      action={{
        type: 'modal_content',
        label: 'Notice details',
        value:
          '<img src="https://example.com/image.png" onerror="alert(1)"><script>alert(2)</script>Safe notice',
      }}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Notice details' }))
  const dialog = screen.getByRole('dialog', { name: 'Notice details' })
  await within(dialog).findByText(/Safe notice/)
  expect(dialog.querySelector('script')).toBeNull()
  expect(dialog.querySelector('[onerror]')).toBeNull()
})

test('saving a board with default widget settings clears the unsaved state even when the server omits false fields', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockImplementation(async (_url, data) => {
    const document = boardSchema.parse(data)
    for (const block of document.blocks) delete block.leaderboard_route
    return { data: { success: true, data: { ...document, version: 1 } } }
  })
  showEditor()
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Saved board')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
})

test('a failed background settings refresh preserves the open editor and its draft', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['community-board-admin'], defaultBoard())
  let failed = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/community/board') {
      if (failed) throw new Error('Unavailable')
      return { data: { success: true, data: defaultBoard() } }
    }
    return {
      data: {
        success: true,
        data: url === '/api/status' ? { checkin_enabled: false } : [],
      },
    }
  })
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider
        router={createRouter({
          routeTree: createRootRoute(),
          history: createMemoryHistory(),
        })}
      >
        <BoardStudio />
      </RouterContextProvider>
    </QueryClientProvider>
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Title' }),
    'Keep this draft'
  )
  failed = true
  await act(async () => {
    await client.refetchQueries({ queryKey: ['community-board-admin'] })
  })
  await user.type(screen.getByRole('textbox', { name: 'Title' }), '!')
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Keep this draft!'
  )
})
