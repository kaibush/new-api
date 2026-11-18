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
import type { ComponentProps } from 'react'

import { Dialog } from '@/components/dialog'
import { cn } from '@/lib/utils'

// Management screens live in tabs; the same content can still be opened from
// request-specific entry points. Detail dialogs use the available viewport.
export function AuditFeatureSurface(
  props: ComponentProps<typeof Dialog> & {
    embedded?: boolean
    showHeading?: boolean
  }
) {
  const { embedded, showHeading = true, ...dialogProps } = props
  if (embedded) {
    return (
      <section
        aria-label={typeof props.title === 'string' ? props.title : undefined}
        className='min-w-0 space-y-4'
      >
        {showHeading && (
          <h2 className='text-base font-semibold'>{props.title}</h2>
        )}
        {props.description && (
          <p className='text-muted-foreground text-sm'>{props.description}</p>
        )}
        {props.children}
        {props.footer}
      </section>
    )
  }
  return (
    <Dialog
      {...dialogProps}
      contentHeight='auto'
      contentClassName={cn(
        props.contentClassName,
        'sm:w-[calc(100%-3rem)] sm:max-w-6xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-[var(--dialog-available-height,100dvh)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none'
      )}
      scrollAreaClassName={cn(props.scrollAreaClassName, 'flex-1')}
    />
  )
}
