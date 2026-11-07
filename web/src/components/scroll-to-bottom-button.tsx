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
import { ArrowDown02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ScrollToBottomButton(props: ComponentProps<typeof Button>) {
  const { t } = useTranslation()

  return (
    <Button
      size='icon'
      type='button'
      variant='outline'
      aria-label={t('Back to latest messages')}
      {...props}
      className={cn(
        'absolute bottom-4 left-1/2 -translate-x-1/2',
        props.className
      )}
    >
      <HugeiconsIcon
        icon={ArrowDown02Icon}
        strokeWidth={2}
        aria-hidden='true'
      />
      {props.children}
    </Button>
  )
}
