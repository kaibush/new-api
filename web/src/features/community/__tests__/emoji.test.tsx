import { CatchBoundary } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { Input } from '@/components/ui/input'

import { EmojiPicker } from '../emoji-picker'
import { MessageText } from '../message-text'

let images: HTMLImageElement[]

beforeEach(() => {
  images = []
  vi.stubGlobal(
    'Image',
    class extends Image {
      constructor() {
        super()
        images.push(this)
      }
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => vi.unstubAllGlobals())

test('unavailable emoji images stay inside the popup and retry preserves the draft', async () => {
  const user = userEvent.setup()
  render(
    <CatchBoundary
      getResetKey={() => 0}
      errorComponent={() => <p>Page failed</p>}
    >
      <Input aria-label='Message' defaultValue='Keep my draft' />
      <EmojiPicker disabled={false} onSelect={() => {}} />
    </CatchBoundary>
  )
  await user.click(screen.getByRole('button', { name: 'Insert emoji' }))
  await waitFor(() => expect(images).toHaveLength(1))
  fireEvent.error(images[0])
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(images).toHaveLength(2))
  fireEvent.load(images[1])
  await waitFor(() =>
    expect(document.querySelector('em-emoji-picker')).toBeInTheDocument()
  )
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Keep my draft'
  )
  expect(screen.queryByText('Page failed')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Insert emoji' })
    ).toHaveAttribute('aria-expanded', 'false')
  )
})

test('message emoji use the picker artwork without splitting skin tones, flags or families', async () => {
  const text = '你好 😀👍🏽🇨🇳👨‍👩‍👧‍👦❤️1️⃣\n@[Alice 😀](user:7) <script>'
  const { container } = render(<MessageText text={text} currentUserId={7} />)
  await waitFor(() => expect(images).toHaveLength(1))
  fireEvent.load(images[0])
  expect(await screen.findAllByRole('img')).toHaveLength(7)
  for (const emoji of screen.getAllByRole('img')) {
    expect(emoji.style.backgroundImage).toContain('/emoji/twitter.png')
    expect(emoji).toHaveAccessibleName(emoji.textContent || '')
  }
  expect(container.textContent).toBe('你好 😀👍🏽🇨🇳👨‍👩‍👧‍👦❤️1️⃣\n@Alice 😀 <script>')
  expect(container.querySelector('mark')).toHaveClass('font-bold')
  expect(container.querySelector('script')).toBeNull()
})

test('failed emoji artwork keeps readable text and recovers when the connection returns', async () => {
  const { container } = render(<MessageText text='Hello 😀' />)
  await waitFor(() => expect(images).toHaveLength(1))
  fireEvent.error(images[0])
  expect(container.textContent).toBe('Hello 😀')
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  fireEvent.online(window)
  fireEvent.load(images[0])
  expect(await screen.findByRole('img', { name: '😀' })).toBeInTheDocument()
})

test('plain text, explicit text presentation and unsupported emoji remain unchanged', async () => {
  const text = '123 <b>hello</b> ☺︎ 🫩'
  const { container } = render(<MessageText text={text} />)
  await waitFor(() => expect(images).toHaveLength(1))
  fireEvent.load(images[0])
  expect(container.textContent).toBe(text)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(container.querySelector('b')).toBeNull()
})

test('a picker initialization failure can be dismissed and reopening loads it again', async () => {
  const user = userEvent.setup()
  const append = Node.prototype.appendChild
  const appendSpy = vi
    .spyOn(Node.prototype, 'appendChild')
    .mockImplementation(function <T extends Node>(this: Node, node: T): T {
      if (node.nodeName === 'EM-EMOJI-PICKER') {
        throw new Error('Picker unavailable')
      }
      return append.call(this, node) as T
    })
  render(
    <CatchBoundary
      getResetKey={() => 0}
      errorComponent={() => <p>Page failed</p>}
    >
      <EmojiPicker disabled={false} onSelect={() => {}} />
    </CatchBoundary>
  )
  const trigger = screen.getByRole('button', { name: 'Insert emoji' })
  await user.click(trigger)
  await waitFor(() => expect(images).toHaveLength(1))
  fireEvent.load(images[0])
  expect(
    await screen.findByRole('button', { name: 'Retry' })
  ).toBeInTheDocument()
  expect(screen.queryByText('Page failed')).not.toBeInTheDocument()
  appendSpy.mockRestore()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  await user.click(trigger)
  await waitFor(() => expect(images).toHaveLength(2))
  fireEvent.load(images[1])
  await waitFor(() =>
    expect(document.querySelector('em-emoji-picker')).toBeInTheDocument()
  )
})
