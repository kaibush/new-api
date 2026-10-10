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

import {
  cleanBackupCode,
  formatBackupCode,
  isValidBackupCode,
  isValidOTP,
} from '../validation'

it.each([
  ['ab-cd ef!gh', 'ABCD-EFGH', 'ABCDEFGH'],
  ['ab--cd--efgh1234', 'ABCD-EFGH', 'ABCDEFGH'],
  ['', '', ''],
  ['abcd', 'ABCD', 'ABCD'],
])(
  'formats %s without changing the backup-code submission representation',
  (input, formatted, submitted) => {
    expect(formatBackupCode(input)).toBe(formatted)
    expect(cleanBackupCode(formatted)).toBe(submitted)
  }
)

it('removes every backup-code separator while retaining strict code validation', () => {
  expect(cleanBackupCode('AB-CD-EF-GH')).toBe('ABCDEFGH')
  expect(isValidBackupCode('ABCD-EFGH')).toBe(true)
  expect(isValidBackupCode('ABCD-EFG!')).toBe(false)
  expect(isValidOTP('012345')).toBe(true)
  expect(isValidOTP('01234a')).toBe(false)
})
