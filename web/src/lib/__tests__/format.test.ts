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

import { formatBytes } from '../format'

test.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'bad_locale!'])(
  'byte formatting uses decimal units for %s',
  (language) => {
    const locale = toIntlLocale(language)
    expect(formatBytes(0, locale)).toBe('0 B')
    expect(formatBytes(999, locale)).toBe('999 B')
    expect(formatBytes(1200, locale)).toBe(
      `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(1.2)} KB`
    )
    expect(formatBytes(1_000_000, locale)).toBe('1 MB')
  }
)
