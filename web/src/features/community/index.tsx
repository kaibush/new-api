import { useMutation, useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteChatMessage,
  getChatStatus,
  uploadChatFile,
  type ChatMessage,
} from './api'
import { ChatComposer } from './chat-composer'
import { CommunityRecords } from './history'
import { ChatMessageBubble } from './message-bubble'
import { OnlineUsers } from './online-users'
import { useChat } from './use-chat'

export function CommunityChat() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const status = useQuery({
    queryKey: ['community-status'],
    queryFn: getChatStatus,
    refetchInterval: 15000,
  })
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
  } = useChat(status.data?.enabled === true)
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
  const deletion = useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: () => setRemove(null),
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
      <div className='mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 p-3 sm:p-5'>
        <header className='flex flex-wrap items-center justify-between gap-2 border-b pb-3'>
          <div className='min-w-0 flex-1 basis-40'>
            <h1 className='text-xl font-semibold break-words'>
              {status.data.name || t('Community chat')}
            </h1>
            <p className='text-muted-foreground text-sm' role='status'>
              {connected ? t('Connected') : t('Reconnecting')}
            </p>
          </div>
          <OnlineUsers users={users} connected={connected} />
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
        <p className='text-muted-foreground text-sm'>
          {t('You can load today’s messages, based on the site’s time zone.')}
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
          {messages.length === 0 && <EmptyState title={t('No messages yet')} />}
          {messages.map((message) => (
            <ChatMessageBubble
              key={`${message.user_id}:${message.client_id || message.id}`}
              message={message}
              currentUserId={user?.id}
              onReply={setReply}
              onRemove={(user?.role ?? 0) >= 100 ? setRemove : undefined}
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
        <ConfirmDialog
          open={remove !== null}
          onOpenChange={(open) => {
            if (!open) setRemove(null)
          }}
          title={t('Delete message')}
          desc={t('This message will be removed from the chat.')}
          handleConfirm={() => {
            if (remove) deletion.mutate(remove.id)
          }}
          isLoading={deletion.isPending}
        />
        {(user?.role ?? 0) >= 10 && (
          <Dialog
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            title={t('Chat records')}
            contentClassName='sm:max-w-5xl'
          >
            {feedbackOpen && <CommunityRecords />}
          </Dialog>
        )}
      </div>
    </Main>
  )
}
