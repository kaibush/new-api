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
import { expect, it } from 'vitest'

import { parseHeaderNavModules } from '@/lib/nav-modules'

import { buildPreviewDocument, helpCenterSchema } from '../config'
import { HelpContent } from '../help-content'

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
