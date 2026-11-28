import { Link } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export function PermissionGroupsLink() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role)
  if (role !== ROLE.SUPER_ADMIN) return null
  return (
    <Button
      size='sm'
      variant='outline'
      render={<Link to='/users/permission-groups' />}
    >
      <Users />
      {t('Permission groups')}
    </Button>
  )
}
