import { SmileIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

const EmojiBrowser = lazy(() => import('./emoji-browser'))

export function EmojiPicker(props: {
  disabled: boolean
  onSelect: (emoji: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon'
            disabled={props.disabled}
            aria-label={t('Insert emoji')}
            title={t('Insert emoji')}
          />
        }
      >
        <HugeiconsIcon icon={SmileIcon} size={20} />
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='start'
        className='w-80 max-w-[calc(100vw-2rem)] p-0'
      >
        <PopoverTitle className='sr-only'>{t('Insert emoji')}</PopoverTitle>
        <Suspense
          fallback={
            <p role='status' className='p-3'>
              {t('Loading...')}
            </p>
          }
        >
          <EmojiBrowser
            onSelect={(emoji) => {
              if (!props.disabled) props.onSelect(emoji)
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
