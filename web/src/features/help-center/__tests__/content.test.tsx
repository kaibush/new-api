/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { parseHeaderNavModules } from '@/lib/nav-modules'

import { buildPreviewDocument, helpCenterSchema } from '../config'
import { HelpContent } from '../help-content'

it('switches between preview and read-only source without restarting the preview', async () => {
  const user = userEvent.setup()
  const source = '<h1>Pelican</h1>\n<script>window.animation = true</script>'
  render(
    <HelpContent
      item={{
        id: 'bird',
        title: 'Pelican',
        kind: 'html',
        content: source,
        enabled: true,
      }}
    />
  )
  const frame = screen.getByTitle('Pelican')
  expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    screen.queryByRole('textbox', { name: 'HTML source' })
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Source and preview' }))
  const sourceView = screen.getByRole('textbox', { name: 'HTML source' })
  expect(sourceView).toHaveAttribute('aria-readonly', 'true')
  expect(sourceView.textContent).toContain('<h1>Pelican</h1>')
  expect(
    screen.getByRole('button', { name: 'Source and preview' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTitle('Pelican')).toBe(frame)
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  // Source scrolls separately; narrow screens stack the panes.
  expect(sourceView.closest('.h-80')).toHaveClass('min-w-0', 'overflow-auto')
  expect(frame.parentElement).toHaveClass('grid', 'lg:grid-cols-2')

  const previewButton = screen.getByRole('button', { name: 'Preview' })
  previewButton.focus()
  await user.keyboard('{Enter}')
  expect(previewButton).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.queryByRole('textbox', { name: 'HTML source' })
  ).not.toBeInTheDocument()
  expect(screen.getByTitle('Pelican')).toBe(frame)
  expect(frame.parentElement).not.toHaveClass('lg:grid-cols-2')
})

it('preserves animation scripts inside a sandbox without same-origin access', () => {
  const source =
    '<html><head><style>body{color:red}</style></head><body><svg id="bird"></svg><script>requestAnimationFrame(() => {})</script></body></html>'
  render(
    <HelpContent
      item={{
        id: 'bird',
        title: 'Pelican',
        kind: 'html',
        content: source,
        enabled: true,
      }}
    />
  )
  const frame = screen.getByTitle('Pelican')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  const document = new DOMParser().parseFromString(
    buildPreviewDocument(source),
    'text/html'
  )
  expect(document.head.firstElementChild?.getAttribute('http-equiv')).toBe(
    'Content-Security-Policy'
  )
  expect(document.head.firstElementChild?.getAttribute('content')).toContain(
    "connect-src 'none'"
  )
  expect(document.querySelector('script')?.textContent).toBe(
    'requestAnimationFrame(() => {})'
  )
})

it('renders configured markdown and safe external links', () => {
  const { rerender } = render(
    <HelpContent
      item={{
        id: 'guide',
        title: 'Guide',
        kind: 'markdown',
        content: '# Connect a client',
        enabled: true,
      }}
    />
  )
  expect(
    screen.getByRole('heading', { name: 'Connect a client' })
  ).toBeVisible()
  expect(
    screen.queryByRole('group', { name: 'View mode' })
  ).not.toBeInTheDocument()
  rerender(
    <HelpContent
      item={{
        id: 'guide',
        title: 'Guide',
        kind: 'link',
        content: 'https://example.com/guide',
        enabled: true,
      }}
    />
  )
  expect(screen.getByRole('link', { name: 'Open link' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  )
})

it('allows HTTPS and embedded HTML images while keeping scripts and connections isolated', () => {
  const source =
    '<img src="https://images.example.com/guide.png" alt="Client setup"><script src="https://images.example.com/code.js"></script>'
  const document = new DOMParser().parseFromString(
    buildPreviewDocument(source),
    'text/html'
  )
  const policy = document.head.firstElementChild?.getAttribute('content') ?? ''
  expect(policy.split(';').map((directive) => directive.trim())).toEqual(
    expect.arrayContaining([
      'img-src https: data: blob:',
      "script-src 'unsafe-inline'",
      "connect-src 'none'",
      "frame-src 'none'",
    ])
  )
  expect(document.querySelector('img')?.getAttribute('src')).toBe(
    'https://images.example.com/guide.png'
  )
})

it('renders Markdown image URLs and alt text while removing executable image attributes', () => {
  render(
    <HelpContent
      item={{
        id: 'images',
        title: 'Images',
        kind: 'markdown',
        enabled: true,
        content:
          '![Client setup](https://images.example.com/guide.png)\n\n<img src="https://images.example.com/detail.png" alt="Detail" onerror="alert(1)">',
      }}
    />
  )
  expect(screen.getByRole('img', { name: 'Client setup' })).toHaveAttribute(
    'src',
    'https://images.example.com/guide.png'
  )
  expect(screen.getByRole('img', { name: 'Detail' })).not.toHaveAttribute(
    'onerror'
  )
})

it('rejects executable links and duplicate IDs while allowing an empty help center', () => {
  const item = {
    id: 'guide',
    title: 'Guide',
    kind: 'link',
    content: 'javascript:alert(1)',
    enabled: true,
  }
  expect(
    helpCenterSchema.safeParse({ version: 1, items: [item] }).success
  ).toBe(false)
  item.content = 'https://example.com'
  expect(
    helpCenterSchema.safeParse({ version: 1, items: [item, item] }).success
  ).toBe(false)
  expect(helpCenterSchema.safeParse({ version: 1, items: [] }).success).toBe(
    true
  )
  expect(parseHeaderNavModules('{"help":false}').help).toBe(false)
})
