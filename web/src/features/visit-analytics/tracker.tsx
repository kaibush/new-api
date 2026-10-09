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
import { useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { api } from '@/lib/api'

import { visitMetadata } from './metadata'

export function VisitTracker() {
  const router = useRouter()
  const path = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  })
  const lastPath = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!path || lastPath.current === path) return
    const match = router.state.matches.at(-1)
    if (!match || match.status !== 'success') return
    const route = router.routesById[match.routeId]
    if (!route) return
    lastPath.current = path
    const metadata = visitMetadata(route.fullPath)
    if (metadata) {
      // Analytics must never interrupt navigation or display request failure toasts.
      void api.post('/api/site-visits', metadata).catch(() => undefined)
    }
  }, [path, router])
  return null
}
