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
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

interface PendingName {
  id: number
  signal: AbortSignal
  resolve: (username: string) => void
  reject: (error: unknown) => void
}

// Only pending requests live here. React Query owns the session-scoped cache.
const pendingNames = new Map<string, PendingName[]>()

function isCurrentAdminSession(userId: number, sid: string): boolean {
  const auth = useAuthStore.getState().auth
  return (
    auth.user?.id === userId &&
    auth.user.role >= ROLE.ADMIN &&
    auth.session?.sid === sid &&
    !!auth.accessToken
  )
}

async function resolveNames(userId: number, sid: string): Promise<void> {
  const requests = pendingNames.get(sid) ?? []
  pendingNames.delete(sid)
  for (let offset = 0; offset < requests.length; offset += 100) {
    const batch = requests.slice(offset, offset + 100)
    try {
      const active = batch.filter((request) => !request.signal.aborted)
      if (!active.length || !isCurrentAdminSession(userId, sid)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const response = await api.get<{
        success: boolean
        message?: string
        data: { id: number; username: string }[]
      }>('/api/user/names', {
        params: { ids: active.map((request) => request.id).join(',') },
      })
      const users = requireServerSuccess(response.data).data
      if (!isCurrentAdminSession(userId, sid)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const names = new Map(users.map((user) => [user.id, user.username]))
      for (const request of batch) {
        if (request.signal.aborted) {
          request.reject(new DOMException('Aborted', 'AbortError'))
        } else {
          request.resolve(names.get(request.id) ?? '')
        }
      }
    } catch (error) {
      // Names only enhance an existing ID. Cache failures briefly as missing
      // names so an optional lookup cannot trigger the global error page.
      for (const request of batch) {
        if (request.signal.aborted || !isCurrentAdminSession(userId, sid)) {
          request.reject(error)
        } else {
          request.resolve('')
        }
      }
    }
  }
}

export function useUserName(
  id: number,
  username?: string,
  enabled = true
): string {
  const user = useAuthStore((state) => state.auth.user)
  const sid = useAuthStore((state) => state.auth.session?.sid)
  const hasToken = useAuthStore((state) => !!state.auth.accessToken)
  const canLookup =
    enabled &&
    !username &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    !!user &&
    user.role >= ROLE.ADMIN &&
    !!sid &&
    hasToken
  const query = useQuery<string>({
    queryKey: ['usernames', user?.id, sid, id],
    enabled: canLookup,
    // Successful names change rarely; retry missing names sooner on a later visit.
    staleTime: (query) => (query.state.data ? 60 * 60_000 : 5 * 60_000),
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { errorToast: false },
    queryFn: ({ signal }) =>
      new Promise<string>((resolve, reject) => {
        if (!sid || !user || !isCurrentAdminSession(user.id, sid)) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        const batch = pendingNames.get(sid)
        const request = { id, signal, resolve, reject }
        if (batch) {
          batch.push(request)
        } else {
          pendingNames.set(sid, [request])
          queueMicrotask(() => void resolveNames(user.id, sid))
        }
      }),
  })
  if (username) return username
  return canLookup && !query.isError ? (query.data ?? '') : ''
}
