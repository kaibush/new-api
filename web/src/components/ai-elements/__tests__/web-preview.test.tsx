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

import { WebPreview, WebPreviewBody } from '../web-preview'

it('keeps inline and host previews isolated even when an external src is also provided', () => {
  const { rerender } = render(
    <WebPreview>
      <WebPreviewBody src='https://external.example/page' />
    </WebPreview>
  )
  expect(
    screen.getByTitle('Preview').getAttribute('sandbox')?.split(' ')
  ).toContain('allow-same-origin')
  rerender(
    <WebPreview>
      <WebPreviewBody src='/preview' />
    </WebPreview>
  )
  expect(
    screen.getByTitle('Preview').getAttribute('sandbox')?.split(' ')
  ).not.toContain('allow-same-origin')
  rerender(
    <WebPreview>
      <WebPreviewBody
        src='https://external.example/page'
        srcDoc='<script>window.example = true</script>'
      />
    </WebPreview>
  )
  const frame = screen.getByTitle('Preview')
  expect(frame).toHaveAttribute(
    'srcdoc',
    '<script>window.example = true</script>'
  )
  expect(frame.getAttribute('sandbox')?.split(' ')).toContain('allow-scripts')
  expect(frame.getAttribute('sandbox')?.split(' ')).not.toContain(
    'allow-same-origin'
  )
})
