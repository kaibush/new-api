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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { getConsoleLandingForGuard } from '@/lib/console-landing'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/dashboard/')({
  beforeLoad: async ({ context }) => {
    const to = await getConsoleLandingForGuard(
      context.queryClient,
      useAuthStore.getState().auth.user
    )
    // Internal destinations must use `to`: intent preloads resolve route
    // options directly and do not convert an href into a target pathname.
    if (to === '/dashboard/overview' || to === '/dashboard/models') {
      throw redirect({
        to: '/dashboard/$section',
        params: { section: to.slice('/dashboard/'.length) },
        replace: true,
      })
    }
    if (to === '/usage-logs/common' || to === '/usage-logs/task') {
      throw redirect({
        to: '/usage-logs/$section',
        params: { section: to.slice('/usage-logs/'.length) },
        replace: true,
      })
    }
    if (to === '/models/metadata') {
      throw redirect({
        to: '/models/$section',
        params: { section: 'metadata' },
        replace: true,
      })
    }
    throw redirect({ to, replace: true })
  },
})
