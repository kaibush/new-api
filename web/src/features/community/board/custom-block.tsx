import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useStatus } from '@/hooks/use-status'

import {
  actionSchema,
  boardRoutes,
  safeBoardURL,
  type BoardAction,
  type BoardBlock,
} from './schema'

const RichContent = lazy(() =>
  import('@/components/rich-content').then((m) => ({ default: m.RichContent }))
)

const CheckinCalendar = lazy(() =>
  import('@/features/profile/components/checkin-calendar-card').then((m) => ({
    default: m.CheckinCalendarCard,
  }))
)
const Leaderboard = lazy(() =>
  import('@/features/checkin/components/leaderboard').then((m) => ({
    default: m.CheckinLeaderboard,
  }))
)

function BoardWidget(props: { value: string }) {
  const { status } = useStatus()
  if (props.value === 'checkin_leaderboard') return <Leaderboard />
  return (
    <CheckinCalendar
      embedded
      checkinEnabled={status?.checkin_enabled === true}
      turnstileEnabled={status?.turnstile_check === true}
      turnstileSiteKey={status?.turnstile_site_key || ''}
    />
  )
}

export function BoardActionButton(props: {
  action: BoardAction
  onPrefill?: (text: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const action = props.action
  if (!actionSchema.safeParse(action).success) return null
  if (action.type === 'copy_text') {
    return (
      <CopyButton
        value={action.value}
        size='sm'
        variant='outline'
        aria-label={action.label}
      >
        {action.label}
      </CopyButton>
    )
  }
  if (action.type === 'chat_prefill') {
    return (
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={!props.onPrefill}
        onClick={() => props.onPrefill?.(action.value)}
      >
        {action.label}
      </Button>
    )
  }
  if (action.type === 'external_url' && action.confirm_leave) {
    return (
      <>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => setOpen(true)}
        >
          {action.label}
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t('External URL')}
          desc={action.value}
          handleConfirm={() => {
            window.open(action.value, '_blank', 'noopener,noreferrer')
            setOpen(false)
          }}
        />
      </>
    )
  }
  if (action.type === 'external_url') {
    return (
      <Button
        type='button'
        size='sm'
        variant='outline'
        render={
          <a href={action.value} target='_blank' rel='noopener noreferrer' />
        }
      >
        {action.label}
      </Button>
    )
  }
  if (action.type === 'internal_route') {
    const route = boardRoutes.find((route) => route === action.value)
    if (!route) return null
    return (
      <Button
        type='button'
        size='sm'
        variant='outline'
        render={<Link to={route} />}
      >
        {action.label}
      </Button>
    )
  }
  return (
    <>
      <Button
        type='button'
        size='sm'
        variant='outline'
        onClick={() => setOpen(true)}
      >
        {action.label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={action.label || t('Details')}
      >
        {open && (
          <Suspense fallback={<LoadingState />}>
            {action.type === 'modal_widget' ? (
              <BoardWidget value={action.value} />
            ) : (
              <RichContent content={action.value} mode='markdown' />
            )}
          </Suspense>
        )}
      </Dialog>
    </>
  )
}
export function CustomBoardBlock(props: {
  block: BoardBlock
  onPrefill?: (text: string) => void
}) {
  const b = props.block
  return (
    <Card size='sm' data-card-hover='false' className='min-w-0 overflow-hidden'>
      {b.image_url && safeBoardURL(b.image_url) && (
        <img
          src={b.image_url}
          alt={b.title}
          loading='lazy'
          referrerPolicy='no-referrer'
          className='max-h-64 w-full object-contain'
        />
      )}
      {b.title && (
        <CardHeader>
          <CardTitle className='break-words'>{b.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className='space-y-3 break-words'>
        {b.body && (
          <Suspense fallback={<LoadingState size='sm' />}>
            <RichContent content={b.body} mode='markdown' />
          </Suspense>
        )}
        <div
          className={
            b.type === 'custom.link_grid'
              ? 'grid grid-cols-2 gap-2 [&>*]:h-auto [&>*]:min-w-0 [&>*]:break-words [&>*]:whitespace-normal'
              : 'flex flex-wrap gap-2'
          }
        >
          {b.actions.map((action) => (
            <BoardActionButton
              key={JSON.stringify(action)}
              action={action}
              onPrefill={props.onPrefill}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
