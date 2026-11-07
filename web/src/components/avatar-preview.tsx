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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { cn } from '@/lib/utils'

export function AvatarPreview(props: {
  src?: string
  name: string
  label?: string
  className?: string
}) {
  const { t } = useTranslation()
  const label =
    props.label || t('View avatar for {{name}}', { name: props.name })

  return (
    <Dialog
      title={t('Image Preview')}
      contentClassName='sm:max-w-3xl'
      trigger={
        <Button
          type='button'
          variant='ghost'
          size='icon'
          disabled={!props.src}
          aria-label={label}
          title={label}
          className={cn('cursor-zoom-in rounded-full p-0', props.className)}
        >
          <Avatar className='size-full'>
            <AvatarImage src={props.src || undefined} alt={props.name} />
            <AvatarFallback style={getUserAvatarStyle(props.name)}>
              {getUserAvatarFallback(props.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      }
    >
      {props.src && (
        <img
          src={props.src}
          alt={props.name}
          className='max-h-[75dvh] w-full rounded-md object-contain'
        />
      )}
    </Dialog>
  )
}
