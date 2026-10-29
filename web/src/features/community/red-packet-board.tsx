import { Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'

import type { ChatMessage } from './api'
import { RedPacketCard } from './red-packet-card'
import type { useRedPackets } from './use-red-packets'

export function RedPacketBoard(props: {
  messages: ChatMessage[]
  packets: ReturnType<typeof useRedPackets>
  retentionMinutes: number
  canCreate: boolean
  onCreate: () => void
  onOpen: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [clock, setClock] = useState(Date.now)
  const now = Math.max(clock, Date.now()) / 1000
  const packetById = new Map(
    props.packets.data?.map((packet) => [packet.id, packet])
  )
  const available: ChatMessage[] = []
  const completed: ChatMessage[] = []
  const history: ChatMessage[] = []
  let nextChange = Infinity
  for (const message of [...props.messages].reverse()) {
    const packet = packetById.get(message.id)
    // A completed list refresh can confirm a server-side deletion before
    // the chat socket reconnects. Never retain such cards from cached messages.
    if (!packet && props.packets.data !== undefined) continue
    if (!packet) {
      available.push(message)
      continue
    }
    const fullyClaimed = packet.claimed >= packet.total
    let archiveAt = packet.expires_at
    if (fullyClaimed) {
      archiveAt = Math.min(
        archiveAt,
        (packet.completed_at || packet.created_at) + props.retentionMinutes * 60
      )
    }
    if (now >= archiveAt) history.push(message)
    else {
      nextChange = Math.min(nextChange, archiveAt)
      if (fullyClaimed) completed.push(message)
      else available.push(message)
    }
  }
  // Schedule the next transition independently of network polling so expiry
  // and retention still work while disconnected or with unchanged query data.
  useEffect(() => {
    if (!Number.isFinite(nextChange)) return
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(2147483647, Math.max(0, nextChange * 1000 - Date.now()))
    )
    return () => window.clearTimeout(timer)
  }, [nextChange, clock])
  const groups = [
    { key: 'current', messages: [...available, ...completed] },
    { key: 'history', messages: history },
  ]
  return (
    <section className='flex flex-col gap-3' aria-label={t('Red packets')}>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>{t('Red packets')}</h3>
        {props.canCreate && (
          <Button variant='ghost' size='sm' onClick={props.onCreate}>
            <Gift data-icon='inline-start' />
            {t('Send a red packet')}
          </Button>
        )}
      </div>
      <Tabs defaultValue='current'>
        <TabsList className='w-full' aria-label={t('Red packets')}>
          <TabsTrigger value='current'>{t('Current red packets')}</TabsTrigger>
          <TabsTrigger value='history'>{t('Red packet history')}</TabsTrigger>
        </TabsList>
        {props.packets.isLoading && <LoadingState size='sm' />}
        {props.packets.isError && (
          <ErrorState
            className='min-h-0'
            onRetry={() => void props.packets.refetch()}
          />
        )}
        {groups.map((group) => (
          <TabsContent
            key={group.key}
            value={group.key}
            className='max-h-112 overflow-y-auto overscroll-contain'
          >
            <div className='flex flex-col gap-3'>
              {group.messages.map((message) => (
                <article key={message.id} className='flex flex-col gap-2'>
                  <div className='text-muted-foreground flex items-center justify-between gap-2 text-xs'>
                    <span className='min-w-0 truncate'>{message.name}</span>
                    <time
                      className='shrink-0'
                      dateTime={new Date(
                        message.created_at * 1000
                      ).toISOString()}
                    >
                      {new Date(message.created_at * 1000).toLocaleDateString(
                        locale
                      )}
                    </time>
                  </div>
                  <RedPacketCard
                    id={message.id}
                    greeting={message.text}
                    packet={packetById.get(message.id)}
                    onOpen={props.onOpen}
                  />
                </article>
              ))}
              {!props.packets.isLoading &&
                !props.packets.isError &&
                group.messages.length === 0 && (
                  <EmptyState
                    className='min-h-0 py-6'
                    icon={Gift}
                    title={
                      group.key === 'current'
                        ? t('No current red packets')
                        : t('No historical red packets')
                    }
                    description={
                      group.key === 'current'
                        ? t('Completed packets appear in Red packet history.')
                        : t(
                            'Load earlier chat messages to see more red packets and claim records.'
                          )
                    }
                  />
                )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <p className='text-muted-foreground text-xs'>
        {t('Red packets follow the loaded chat history.')}
      </p>
    </section>
  )
}
