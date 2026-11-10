import { SmileIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { CatchBoundary } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

function EmojiPickerContent(props: { onSelect: (emoji: string) => void }) {
  const { t } = useTranslation()
  // React.lazy caches rejections: retry needs a fresh lazy component as well
  // as a reset boundary. This state is also recreated when the popup reopens.
  const [browser, setBrowser] = useState(() => ({
    Component: lazy(() => import('./emoji-browser')),
    attempt: 0,
  }))
  return (
    <CatchBoundary
      getResetKey={() => browser.attempt}
      errorComponent={() => (
        <ErrorState
          className='min-h-0 p-4'
          title={t('Failed to load emoji')}
          description={t('Check your connection and try again.')}
          onRetry={() =>
            setBrowser((previous) => ({
              Component: lazy(() => import('./emoji-browser')),
              attempt: previous.attempt + 1,
            }))
          }
        />
      )}
    >
      <Suspense fallback={<LoadingState size='sm' />}>
        <browser.Component onSelect={props.onSelect} />
      </Suspense>
    </CatchBoundary>
  )
}

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
        <EmojiPickerContent
          onSelect={(emoji) => {
            if (!props.disabled) props.onSelect(emoji)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
