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
export function getIframeSandbox(
  src: string | undefined,
  parentOrigin: string
): string {
  const permissions =
    'allow-scripts allow-forms allow-popups allow-presentation allow-downloads'
  if (!src) return permissions
  try {
    const target = new URL(src, parentOrigin)
    // External applications need their own storage. Host and inline content
    // must keep an opaque origin so scripts cannot remove their sandbox.
    if (
      (target.protocol === 'https:' || target.protocol === 'http:') &&
      target.origin !== parentOrigin
    ) {
      return `${permissions} allow-same-origin`
    }
  } catch {
    // Invalid URLs receive the same restricted permissions as inline content.
  }
  return permissions
}
