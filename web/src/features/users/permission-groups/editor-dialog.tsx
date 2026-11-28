import { type ReactNode, type FormEventHandler, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

export function EditorDialog(props: {
  title: string
  submitLabel: string
  pending: boolean
  onClose: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose()
      }}
      title={props.title}
      fitVisualViewport
      initialFocus={false}
      showCloseButton={false}
      contentClassName='max-w-[calc(100%-1rem)] overflow-hidden sm:max-w-lg'
      footerClassName='grid grid-cols-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex'
      footer={
        <>
          <Button
            className='min-h-9'
            variant='outline'
            disabled={props.pending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            className='min-h-9'
            type='submit'
            form={id}
            disabled={props.pending}
          >
            {props.submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} noValidate onSubmit={props.onSubmit}>
        <fieldset disabled={props.pending} className='grid min-w-0 gap-4'>
          {props.children}
        </fieldset>
      </form>
    </Dialog>
  )
}
