import { createFileRoute, redirect } from '@tanstack/react-router'

import { PermissionGroups } from '@/features/users/permission-groups'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/users/permission-groups')(
  {
    beforeLoad: () => {
      if (useAuthStore.getState().auth.user?.role !== ROLE.SUPER_ADMIN) {
        throw redirect({ to: '/403' })
      }
    },
    component: PermissionGroups,
  }
)
