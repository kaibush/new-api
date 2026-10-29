import { useMutation } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { uploadChatFile, type ChatMessage } from './api'
import { ChatComposer } from './chat-composer'
import { CommunityBoard } from './community-board'
import { EventCreate } from './event-create'
import { EventDetail } from './event-detail'
import { CommunityRecords } from './history'
import { ChatMessageBubble } from './message-bubble'
import { ChatModerationDialog } from './moderation-dialog'
import { OnlineUsers } from './online-users'
import { RedPacketCreate } from './red-packet-create'
import { RedPacketDetailDialog } from './red-packet-detail'
import { useCommunityChat } from './use-community-chat'
import { useRedPackets } from './use-red-packets'

export function CommunityChat() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((s) => s.auth.user)
  const { status, chat, notifications } = useCommunityChat()
  const {
    messages,
    connected,
    users,
    onSending,
    onSent,
    onFailed,
    hasMore,
    loadEarlier,
    loadingEarlier,
    historyError,
    clearThrough,
    markDeleted,
  } = chat
  const packetMessages = messages.filter(
    (message) =>
      message.kind === 'red_packet' &&
      !message.deleted &&
      !message.cleared &&
      !message.sending
  )
  const packets = useRedPackets(
    packetMessages.map((message) => message.id),
    status.data?.enabled === true
  )
  const packetById = new Map(packets.data?.map((packet) => [packet.id, packet]))
  const [boardOpen, setBoardOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [packetId, setPacketId] = useState<number | null>(null)
  const [eventId, setEventId] = useState<number | null>(null)
  const [eventCreateOpen, setEventCreateOpen] = useState(false)
  const [locateId, setLocateId] = useState<number | null>(null)
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [remove, setRemove] = useState<ChatMessage | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const upload = useMutation({
    mutationFn: (file: File) => uploadChatFile(file, 'avatar'),
    onSuccess: () => toast.success(t('Upload successful')),
  })
  const previousScroll = useRef({ firstId: 0, height: 0 })
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const firstId = messages[0]?.id || 0
    if (stickToBottom.current) el.scrollTop = el.scrollHeight
    else if (firstId > 0 && firstId < previousScroll.current.firstId) {
      el.scrollTop += el.scrollHeight - previousScroll.current.height
    }
    previousScroll.current = { firstId, height: el.scrollHeight }
  }, [messages])
  useEffect(() => {
    if (locateId === null) return
    const target = document.querySelector<HTMLElement>(`#message-${locateId}`)
    if (target) {
      stickToBottom.current = false
      target.scrollIntoView({ block: 'center', behavior: 'instant' })
      target.focus({ preventScroll: true })
      setLocateId(null)
    } else if (historyError || !hasMore) {
      toast.info(t('This message is outside the available chat history.'))
      setLocateId(null)
    } else if (!loadingEarlier) {
      stickToBottom.current = false
      loadEarlier()
    }
  }, [
    locateId,
    messages,
    hasMore,
    loadingEarlier,
    historyError,
    loadEarlier,
    t,
  ])
  if (status.isPending) return <LoadingState />
  if (status.isError) {
    return <ErrorState onRetry={() => void status.refetch()} />
  }
  if (!status.data.enabled) {
    return <EmptyState title={t('Community chat is disabled')} />
  }
  const members = new Map(users.map((member) => [member.user_id, member]))
  return (
    <Main>
      <div className='mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-1 flex-col gap-3 p-3 sm:p-5'>
        <header className='flex flex-wrap items-center justify-between gap-2 border-b pb-3'>
          <div className='min-w-0 flex-1 basis-40'>
            <h1 className='text-xl font-semibold break-words'>
              {status.data.name || t('Community chat')}
            </h1>
            <p className='text-muted-foreground text-sm' role='status'>
              {connected ? t('Connected') : t('Reconnecting')}
            </p>
          </div>
          <Button
            variant='outline'
            className='lg:hidden'
            onClick={() => setBoardOpen(true)}
          >
            {t('Community board')}
          </Button>
          <OnlineUsers users={users} connected={connected} />
          {notifications.supported &&
            notifications.permission !== 'granted' && (
              <Button
                variant='outline'
                onClick={() => void notifications.request()}
              >
                {t('Enable mention notifications')}
              </Button>
            )}
          {(user?.role ?? 0) >= 10 && (
            <Button variant='outline' onClick={() => setFeedbackOpen(true)}>
              {t('Chat records')}
            </Button>
          )}
          <Button
            variant='outline'
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {t('Upload avatar')}
          </Button>
        </header>
        <div className='grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]'>
          <section
            className='flex min-h-0 min-w-0 flex-col gap-3'
            aria-label={t('Chat messages')}
          >
            <p className='text-muted-foreground text-sm'>
              {t(
                'You can load messages from the last {{days}} days, including today, in the site’s time zone.',
                { days: formatNumber(status.data.history_days || 1, locale) }
              )}
            </p>
            <div
              ref={scroll}
              className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain [overflow-anchor:none]'
              role='log'
              aria-label={t('Chat messages')}
              aria-live='polite'
              onScroll={() => {
                const el = scroll.current
                if (el) {
                  stickToBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80
                }
              }}
            >
              {hasMore && (
                <div className='flex justify-center'>
                  <Button
                    variant='outline'
                    disabled={loadingEarlier}
                    onClick={() => {
                      stickToBottom.current = false
                      loadEarlier()
                    }}
                  >
                    {loadingEarlier ? (
                      <LoadingState inline size='sm' />
                    ) : (
                      t('Load earlier messages')
                    )}
                  </Button>
                </div>
              )}
              {historyError && (
                <ErrorState className='min-h-0' onRetry={loadEarlier} />
              )}
              {messages.length === 0 && (
                <EmptyState title={t('No messages yet')} />
              )}
              {messages.map((message) => (
                <ChatMessageBubble
                  key={`${message.user_id}:${message.client_id || message.id}`}
                  message={message}
                  currentUserId={user?.id}
                  onReply={setReply}
                  onOpenRedPacket={setPacketId}
                  onOpenEvent={setEventId}
                  redPacket={packetById.get(message.id)}
                  onRemove={(user?.role ?? 0) >= 10 ? setRemove : undefined}
                />
              ))}
            </div>
            <ChatComposer
              connected={connected}
              currentUser={
                members.get(user?.id ?? 0) || {
                  user_id: user?.id ?? 0,
                  name: user?.display_name || user?.username || '',
                  avatar: '',
                }
              }
              onSending={(message) => {
                stickToBottom.current = true
                onSending(message)
              }}
              onDelivered={onSent}
              onFailed={onFailed}
              status={status.data}
              users={[...members.values()]}
              reply={
                reply
                  ? messages.find((message) => message.id === reply.id) || null
                  : null
              }
              onCancelReply={() => setReply(null)}
              onSent={(sentReplyId) =>
                setReply((current) =>
                  current?.id === sentReplyId ? null : current
                )
              }
            />
          </section>
          <aside
            className='hidden min-h-0 overflow-y-auto border-l pl-6 lg:block'
            aria-label={t('Community board')}
          >
            <CommunityBoard
              retentionMinutes={status.data?.red_packet_retention_minutes}
              packetMessages={packetMessages}
              packets={packets}
              onOpen={setPacketId}
              onCreate={() => setCreateOpen(true)}
              onOpenEvent={setEventId}
              onCreateEvent={() => setEventCreateOpen(true)}
            />
          </aside>
        </div>
        <Dialog
          open={boardOpen}
          onOpenChange={setBoardOpen}
          title={t('Community board')}
          contentClassName='sm:max-w-md'
        >
          {boardOpen && (
            <CommunityBoard
              retentionMinutes={status.data?.red_packet_retention_minutes}
              packetMessages={packetMessages}
              packets={packets}
              onOpenEvent={(id) => {
                setBoardOpen(false)
                setEventId(id)
              }}
              onCreateEvent={() => {
                setBoardOpen(false)
                setEventCreateOpen(true)
              }}
              onOpen={(id) => {
                setBoardOpen(false)
                setPacketId(id)
              }}
              onCreate={() => {
                setBoardOpen(false)
                setCreateOpen(true)
              }}
            />
          )}
        </Dialog>
        {createOpen && (
          <RedPacketCreate
            onClose={() => setCreateOpen(false)}
            onCreated={(packet) => {
              setCreateOpen(false)
              stickToBottom.current = true
              onSending({
                id: packet.id,
                user_id: packet.user_id,
                name: packet.name,
                avatar: members.get(packet.user_id)?.avatar || '',
                text: packet.greeting,
                kind: 'red_packet',
                url: '',
                filename: '',
                size: 0,
                created_at: packet.created_at,
                deleted: false,
              })
              setPacketId(packet.id)
            }}
          />
        )}
        {eventCreateOpen && (
          <EventCreate
            onClose={() => setEventCreateOpen(false)}
            onCreated={(event) => {
              setEventCreateOpen(false)
              stickToBottom.current = true
              onSending({
                id: event.id,
                user_id: event.user_id,
                name: event.name,
                avatar: members.get(event.user_id)?.avatar || '',
                text: event.title,
                kind: 'event',
                event,
                url: '',
                filename: '',
                size: 0,
                created_at: event.created_at,
                deleted: false,
              })
              setEventId(event.id)
            }}
          />
        )}
        {eventId !== null && (
          <EventDetail
            key={eventId}
            id={eventId}
            onClose={() => setEventId(null)}
            onLocate={(id) => {
              setEventId(null)
              setLocateId(id)
            }}
          />
        )}
        {packetId !== null && (
          <RedPacketDetailDialog
            key={packetId}
            id={packetId}
            onClose={() => setPacketId(null)}
            onLocate={(id) => {
              setPacketId(null)
              setLocateId(id)
            }}
          />
        )}
        <Input
          ref={fileInput}
          type='file'
          accept='.png,.jpg,.jpeg,.webp,.gif'
          className='hidden'
          aria-label={t('Upload avatar')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) upload.mutate(file)
          }}
        />
        <ChatModerationDialog
          target={remove}
          onClose={() => setRemove(null)}
          onDeleted={markDeleted}
        />
        {(user?.role ?? 0) >= 10 && (
          <Dialog
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            title={t('Chat records')}
            contentClassName='sm:max-w-5xl'
          >
            {feedbackOpen && (
              <CommunityRecords
                onCleared={clearThrough}
                onDeleted={markDeleted}
              />
            )}
          </Dialog>
        )}
      </div>
    </Main>
  )
}
