import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { cancelCommunityEvent, getCommunityEvent } from './event-api'
import { EventTiming } from './event-card'
import { MessageText } from './message-text'

export function EventDetail(props: {
  id: number
  onClose: () => void
  onLocate: (id: number) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const role = useAuthStore((s) => s.auth.user?.role ?? 0)
  const [confirm, setConfirm] = useState(false)
  const locating = useRef(false)
  const detail = useQuery({
    queryKey: ['community-event', props.id],
    queryFn: ({ signal }) => getCommunityEvent(props.id, signal),
    refetchInterval: 15000,
  })
  const cancel = useMutation({
    mutationFn: () => cancelCommunityEvent(props.id),
    onSuccess: async () => {
      setConfirm(false)
      toast.success(t('Event cancelled'))
      await Promise.all([
        client.invalidateQueries({ queryKey: ['community-events'] }),
        client.invalidateQueries({ queryKey: ['community-event', props.id] }),
      ])
    },
  })
  const event = detail.data
  return (
    <Dialog
      open
      title={t('Event details')}
      contentClassName='sm:max-w-lg'
      onOpenChange={(open) => {
        if (!open && !cancel.isPending) props.onClose()
      }}
      finalFocus={() => !locating.current}
    >
      {detail.isPending && <LoadingState />}
      {detail.isError && <ErrorState onRetry={() => void detail.refetch()} />}
      {event && !detail.isError && (
        <div className='flex flex-col gap-4'>
          <div>
            <p className='text-primary mb-2 text-xs font-medium'>
              {event.kind === 'red_packet'
                ? t('Red packet preview')
                : t('Community event')}
            </p>
            <h3 className='text-xl font-semibold break-words'>{event.title}</h3>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Published by {{name}}', { name: event.name })}
            </p>
          </div>
          <EventTiming event={event} />
          <p className='text-muted-foreground text-xs'>
            {t('Times use your local time zone.')}
          </p>
          {event.description && (
            <div className='bg-muted rounded-xl p-4 text-sm break-words whitespace-pre-wrap'>
              <MessageText text={event.description} />
            </div>
          )}
          {event.kind === 'red_packet' && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'This is a preview. An administrator sends the red packet when the event starts.'
              )}
            </p>
          )}
          <Button
            variant='outline'
            onClick={() => {
              locating.current = true
              props.onLocate(event.id)
            }}
          >
            {t('View in chat')}
          </Button>
          {role >= 10 && !event.cancelled && (
            <Button variant='ghost' onClick={() => setConfirm(true)}>
              {t('Cancel event')}
            </Button>
          )}
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={t('Cancel event')}
            desc={t(
              'The event will leave the board. Its announcement will remain marked as cancelled.'
            )}
            confirmText={t('Cancel event')}
            destructive
            isLoading={cancel.isPending}
            handleConfirm={() => {
              if (!cancel.isPending) cancel.mutate()
            }}
          />
        </div>
      )}
    </Dialog>
  )
}
