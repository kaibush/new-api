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
function createVisitID(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let fallbackVisitor: string | undefined
let fallbackSession: string | undefined

export function visitMetadata(page: string, now = Date.now()) {
  if (navigator.doNotTrack === '1') return null
  fallbackVisitor ??= createVisitID()
  fallbackSession ??= createVisitID()
  let visitor = fallbackVisitor
  let session = fallbackSession
  try {
    visitor = localStorage.getItem('site-visit-id') || visitor
    localStorage.setItem('site-visit-id', visitor)
    const previous = Number(sessionStorage.getItem('site-visit-last'))
    session = sessionStorage.getItem('site-visit-session') || session
    if (previous && now - previous > 30 * 60 * 1000) session = createVisitID()
    sessionStorage.setItem('site-visit-session', session)
    sessionStorage.setItem('site-visit-last', String(now))
  } catch {
    // Restricted storage still permits best-effort, in-memory analytics.
  }
  let referrer = ''
  try {
    referrer = document.referrer ? new URL(document.referrer).origin : ''
  } catch {
    /* Invalid referrers are omitted. */
  }
  return {
    page: page.replace(/\/$/, '') || '/',
    visitor,
    session,
    referrer,
    language: navigator.language.slice(0, 32),
  }
}
