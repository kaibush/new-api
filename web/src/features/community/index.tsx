import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { MessageContent } from '@/components/ai-elements/message'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableRowActionMenu } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteChatMessage,
  getChatStatus,
  uploadChatFile,
  type ChatMessage,
} from './api'
import { ChatComposer } from './chat-composer'
import { MessageText } from './message-text'
import { OnlineUsers } from './online-users'
import { useChat } from './use-chat'

export function CommunityChat() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((s) => s.auth.user)
  const status = useQuery({
    queryKey: ['community-status'],
    queryFn: getChatStatus,
    refetchInterval: 15000,
  })
  const { messages, connected, users } = useChat(status.data?.enabled === true)
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [remove, setRemove] = useState<ChatMessage | null>(null)
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
  useEffect(() => {
    if (stickToBottom.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight
    }
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
          <Button
            variant='outline'
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {t('Upload avatar')}
          </Button>
        </header>
        <p className='text-muted-foreground text-sm'>
          {t(
            'The latest 50 messages are shown. All signed-in users can read this chat.'
          )}
        </p>
        <div
          ref={scroll}
          className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain'
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
          {messages.length === 0 && <EmptyState title={t('No messages yet')} />}
          {messages.map((message) => (
            <article
              key={message.id}
              id={`message-${message.id}`}
              className={cn('group group/message flex items-start gap-3', {
                'flex-row-reverse is-user': message.user_id === user?.id,
                'is-assistant': message.user_id !== user?.id,
              })}
            >
              <Avatar className='size-9 shrink-0'>
                <AvatarImage
                  src={message.avatar || undefined}
                  alt={message.name}
                />
                <AvatarFallback style={getUserAvatarStyle(message.name)}>
                  {getUserAvatarFallback(message.name)}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  'flex min-w-0 max-w-[min(80%,42rem)] flex-col gap-1',
                  {
                    'items-end': message.user_id === user?.id,
                    'items-start': message.user_id !== user?.id,
                  }
                )}
              >
                <div
                  className={cn(
                    'flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5',
                    {
                      'justify-end': message.user_id === user?.id,
                    }
                  )}
                >
                  <span className='max-w-full min-w-0 font-medium break-words'>
                    {message.name}
                  </span>
                  <time
                    className='text-muted-foreground max-w-full shrink-0 text-xs break-words'
                    dateTime={new Date(message.created_at * 1000).toISOString()}
                  >
                    {new Date(message.created_at * 1000).toLocaleString(locale)}
                  </time>
                </div>
                <MessageContent
                  variant='contained'
                  className={cn(
                    'min-w-0 max-w-full rounded-2xl border px-3.5 py-2.5 leading-relaxed shadow-xs group-[.is-user]:bg-primary/10 group-[.is-user]:text-foreground group-[.is-assistant]:bg-muted/50',
                    {
                      'items-end rounded-tr-sm border-primary/10':
                        message.user_id === user?.id,
                      'items-start rounded-tl-sm border-border/60':
                        message.user_id !== user?.id,
                    }
                  )}
                >
                  {message.reply_to_id && !message.deleted && (
                    <blockquote className='border-primary bg-muted max-w-full border-l-2 p-2 text-sm'>
                      <p className='font-medium'>
                        {message.reply?.name || t('Reply')}
                      </p>
                      <p className='line-clamp-2 break-words'>
                        <MessageText
                          text={
                            message.reply && !message.reply.deleted
                              ? message.reply.text || message.reply.filename
                              : t('Message deleted')
                          }
                          currentUserId={user?.id}
                        />
                      </p>
                    </blockquote>
                  )}
                  {message.deleted ? (
                    <p className='text-muted-foreground italic'>
                      {t('Message deleted')}
                    </p>
                  ) : (
                    <>
                      {message.text && (
                        <p className='max-w-full text-left break-words whitespace-pre-wrap'>
                          <MessageText
                            text={message.text}
                            currentUserId={user?.id}
                          />
                        </p>
                      )}
                      {(message.kind === 'image' ||
                        message.kind === 'sticker') && (
                        <a
                          className='max-w-full'
                          href={message.url}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          <img
                            src={message.url}
                            alt={message.filename}
                            loading='lazy'
                            className={
                              message.kind === 'sticker'
                                ? 'max-h-40 max-w-[min(10rem,100%)] rounded-md object-contain'
                                : 'max-h-80 max-w-full rounded-md object-contain'
                            }
                          />
                        </a>
                      )}
                      {message.kind === 'file' && (
                        <a
                          className='text-primary block break-all underline'
                          href={message.url}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          {message.filename} (
                          {formatNumber(message.size, locale)} B)
                        </a>
                      )}
                    </>
                  )}
                </MessageContent>
                {!message.deleted && (
                  <div
                    data-message-actions
                    className='text-muted-foreground flex h-6 items-center gap-1'
                  >
                    <DataTableRowActionMenu
                      ariaLabel={t('More actions')}
                      triggerSize='icon-xs'
                      contentClassName='w-36'
                    >
                      <DropdownMenuItem onClick={() => setReply(message)}>
                        {t('Reply')}
                      </DropdownMenuItem>
                      {(user?.role ?? 0) >= 100 && (
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => setRemove(message)}
                        >
                          {t('Delete')}
                        </DropdownMenuItem>
                      )}
                    </DataTableRowActionMenu>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
        <ChatComposer
          connected={connected}
          status={status.data}
          users={[...members.values()]}
          reply={
            reply
              ? messages.find((message) => message.id === reply.id) || reply
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
      </div>
    </Main>
  )
}
