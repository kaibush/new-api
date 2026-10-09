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
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

const RechargeWallet = lazy(() =>
  import('../index').then((module) => ({ default: module.Wallet }))
)

type RechargeNavButtonProps = {
  className?: string
  disabled?: boolean
  onOpen?: () => void
}

export function RechargeNavButton(props: RechargeNavButtonProps) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <Link
        to='/wallet'
        className={props.className}
        disabled={props.disabled}
        onClick={props.onOpen}
      >
        {t('Online Top-up')}
      </Link>
    )
  }

  return (
    <Dialog
      title={t('Online Top-up')}
      description={t('Choose an amount and payment method')}
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) props.onOpen?.()
      }}
      contentClassName='sm:max-w-3xl'
      trigger={
        <Button
          variant='ghost'
          disabled={props.disabled}
          className={props.className}
        >
          {t('Online Top-up')}
        </Button>
      }
    >
      {open && (
        <Suspense fallback={<LoadingState />}>
          <RechargeWallet rechargeOnly />
        </Suspense>
      )}
    </Dialog>
  )
}
