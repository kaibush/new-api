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
type VisoraUser = {
  id: string | number
  name?: string | null
  email?: string | null
}

let latestUser: VisoraUser | null | undefined
let waitingForTracker = false

function applyUser() {
  waitingForTracker = false
  if (latestUser !== undefined) window.visora?.identify(latestUser)
}

/** undefined 表示登录状态尚未确定；null 表示已确认匿名。 */
export function syncVisoraUser(user: VisoraUser | null | undefined) {
  if (typeof window === 'undefined' || user === undefined) return
  latestUser =
    user === null ? null : { id: user.id, name: user.name, email: user.email }
  if (window.visora) {
    applyUser()
  } else if (!waitingForTracker) {
    waitingForTracker = true
    window.addEventListener('visora:ready', applyUser, { once: true })
  }
}

declare global {
  interface Window {
    visora?: {
      disabled: boolean
      pageview(): void
      track(name: string): void
      identify(user: VisoraUser | null): boolean
      reset(): void
    }
  }
}
