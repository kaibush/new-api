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
import type { ReactNode } from 'react'

import { keywordPattern } from './keyword'

export function HighlightedText(props: { text: string; query?: string }) {
  const pattern = keywordPattern(props.query)
  if (!pattern) return props.text
  const parts: ReactNode[] = []
  let offset = 0
  for (const match of props.text.matchAll(pattern)) {
    parts.push(props.text.slice(offset, match.index))
    parts.push(
      <mark
        key={match.index}
        className='rounded-sm bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50'
      >
        {match[0]}
      </mark>
    )
    offset = match.index + match[0].length
  }
  if (offset === 0) return props.text
  parts.push(props.text.slice(offset))
  return parts
}
