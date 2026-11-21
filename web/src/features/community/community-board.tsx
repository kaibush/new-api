import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Gift } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'

import type { ChatMessage } from './api'
import { getBoard } from './board/api'
import { CustomBoardBlock } from './board/custom-block'
import { BoardLeaderboard } from './board/leaderboard'
import type { BoardDocument } from './board/schema'
import { CommunityCheckin } from './community-checkin'
import { useCommunityEvents } from './event-api'
import { EventCard } from './event-card'
import { RedPacketBoard } from './red-packet-board'
import type { useRedPackets } from './use-red-packets'

export type CommunityBoardProps = {
  onPrefill?: (text: string) => void
  retentionMinutes?: number
  packetMessages: ChatMessage[]
  packets: ReturnType<typeof useRedPackets>
  onOpen: (id: number) => void
  onCreate: () => void
  onOpenEvent: (id: number) => void
  onCreateEvent: () => void
}

export function CommunityBoard(props: CommunityBoardProps) {
  const board = useQuery({
    queryKey: ['community-board'],
    queryFn: () => getBoard(),
    refetchInterval: 30000,
  })
  if (board.isPending) return <LoadingState />
  if (board.isError && !board.data) {
    return <ErrorState onRetry={() => void board.refetch()} />
  }
  return <BoardRenderer {...props} document={board.data} />
}

export function BoardRenderer(
  props: CommunityBoardProps & { document: BoardDocument; preview?: boolean }
) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const events = useCommunityEvents()
  const [expanded, setExpanded] = useState(false)
  const document = props.document
  return (
    <div className='flex min-h-0 min-w-0 flex-col gap-5'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='font-semibold'>
            {document.title || t('Community board')}
          </h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {document.subtitle || t('Shared moments, all in one place.')}
          </p>
        </div>
        <Gift
          className='text-muted-foreground size-5 shrink-0'
          aria-hidden='true'
        />
      </div>
      {document.blocks
        .filter((block) => block.enabled)
        .map((block) => {
          let content
          switch (block.type) {
            case 'builtin.checkin':
              content = <CommunityCheckin showLeaderboard={false} />
              break
            case 'builtin.checkin_leaderboard':
              content = <BoardLeaderboard block={block} />
              break
            case 'builtin.events':
              content = (
                <section
                  className='flex flex-col gap-3 border-b pb-4'
                  aria-label={t('Upcoming events')}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <h3 className='flex items-center gap-2 text-sm font-semibold'>
                      <CalendarDays className='size-4' aria-hidden='true' />
                      {t('Upcoming events')}
                    </h3>
                    {(user?.role ?? 0) >= 10 && (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={props.onCreateEvent}
                      >
                        {t('Publish event')}
                      </Button>
                    )}
                  </div>
                  {events.isPending && <LoadingState size='sm' />}
                  {events.isError && (
                    <ErrorState
                      className='min-h-0'
                      onRetry={() => void events.refetch()}
                    />
                  )}
                  {events.data?.length === 0 && (
                    <EmptyState
                      icon={CalendarDays}
                      className='min-h-0 py-3'
                      title={t('Upcoming events')}
                      description={t(
                        'No upcoming events. New announcements will appear here.'
                      )}
                    />
                  )}
                  {events.data?.slice(0, expanded ? 50 : 3).map((event) => (
                    <EventCard
                      key={event.id}
                      id={event.id}
                      title={event.title}
                      event={event}
                      onOpen={props.onOpenEvent}
                    />
                  ))}
                  {(events.data?.length ?? 0) > 3 && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? t('Show less') : t('Show more')}
                    </Button>
                  )}
                </section>
              )
              break
            case 'builtin.red_packets':
              content = (
                <RedPacketBoard
                  messages={props.packetMessages}
                  packets={props.packets}
                  retentionMinutes={props.retentionMinutes ?? 10}
                  canCreate={(user?.role ?? 0) >= 10}
                  onCreate={props.onCreate}
                  onOpen={props.onOpen}
                />
              )
              break
            case 'builtin.red_packet_rules':
              content = (
                <Card
                  size='sm'
                  data-card-hover='false'
                  className='bg-muted/40 ring-0'
                >
                  <CardHeader>
                    <CardTitle>{t('About red packets')}</CardTitle>
                    <CardDescription>
                      {t('One code per person, first come, first served.')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='text-muted-foreground text-xs leading-relaxed'>
                    {t(
                      'Open a packet to claim your code and see who has received one. Codes stay private; claim records are shared.'
                    )}
                  </CardContent>
                </Card>
              )
              break
            default:
              content = (
                <CustomBoardBlock block={block} onPrefill={props.onPrefill} />
              )
          }
          return (
            <fieldset
              key={block.id}
              className='min-w-0'
              disabled={
                props.preview &&
                block.type.startsWith('builtin.') &&
                block.type !== 'builtin.checkin_leaderboard'
              }
            >
              {content}
            </fieldset>
          )
        })}
    </div>
  )
}
