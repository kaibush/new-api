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
import { expect, test } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'

import { formatCheckinPercent } from '../format'

test.each([
  ['en', '.'],
  ['zhCN', '.'],
  ['zhTW', '.'],
  ['fr', ','],
  ['ja', '.'],
  ['ru', ','],
  ['vi', ','],
  ['invalid_locale', '.'],
])(
  'partial activity remains distinct from zero and full activity in %s',
  (language, decimal) => {
    const locale = toIntlLocale(language)
    expect(formatCheckinPercent(0, locale)).toBe('0%')
    expect(formatCheckinPercent(0.0001, locale)).toBe(`<0${decimal}01%`)
    expect(formatCheckinPercent(60.25, locale)).toBe(`60${decimal}25%`)
    expect(formatCheckinPercent(99.99999, locale)).toBe(`>99${decimal}99%`)
    expect(formatCheckinPercent(100, locale)).toBe('100%')
  }
)
