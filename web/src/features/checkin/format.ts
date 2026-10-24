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
import { formatNumber } from '@/lib/format'

// Preserve the distinction between zero, partial and full activity when the
// shared two-decimal formatter would otherwise round to 0% or 100%.
export function formatCheckinPercent(value: number, locale?: string): string {
  if (value > 0 && value < 0.01) return `<${formatNumber(0.01, locale)}%`
  if (value > 99.99 && value < 100) return `>${formatNumber(99.99, locale)}%`
  return `${formatNumber(value, locale)}%`
}
