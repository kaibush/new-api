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
import { expect, it } from 'vitest'

import { getIframeSandbox } from '../iframe-sandbox'

it.each([
  ['https://chat.example.com/app', true],
  ['//chat.example.com/app', true],
  ['https://gateway.example.com/app', false],
  ['/help-center', false],
  ['about:blank', false],
  ['data:text/html,<script></script>', false],
  ['javascript:alert(1)', false],
  [undefined, false],
] as const)(
  'isolates %s and permits storage only for external HTTP pages',
  (src, allowStorage) => {
    const permissions = getIframeSandbox(
      src,
      'https://gateway.example.com'
    ).split(' ')
    expect(permissions).toContain('allow-scripts')
    expect(permissions).toContain('allow-forms')
    expect(permissions.includes('allow-same-origin')).toBe(allowStorage)
    expect(permissions).not.toContain('allow-top-navigation')
  }
)
