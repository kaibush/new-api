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
// Keywords match literally and ignore case, like the server-side search.
export function keywordPattern(query?: string) {
  const keyword = query?.trim()
  if (!keyword) return undefined
  return new RegExp(keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
}

// Clamped previews start shortly before the first match so it stays visible.
export function keywordExcerpt(text: string, query?: string, lead = 24) {
  const index = keywordPattern(query)?.exec(text)?.index ?? -1
  if (index <= lead) return text
  let start = index - lead
  if (/[\uDC00-\uDFFF]/.test(text[start])) start--
  return `…${text.slice(start)}`
}
