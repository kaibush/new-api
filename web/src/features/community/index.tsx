import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteChatMessage,
  getChatStatus,
  sendChatMessage,
  uploadChatFile,
  type ChatMessage,
} from './api'
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
  const { messages, connected } = useChat(status.data?.enabled === true)
  const [text, setText] = useState('')
  const [uploadKind, setUploadKind] = useState('image')
  const [remove, setRemove] = useState<ChatMessage | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const send = useMutation({
    mutationFn: sendChatMessage,
    onSuccess: () => setText(''),
  })
  const upload = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: string }) =>
      uploadChatFile(file, kind, text),
    onSuccess: (_, vars) => {
      if (vars.kind !== 'avatar') setText('')
      toast.success(t('Upload successful'))
    },
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
  const busy = send.isPending || upload.isPending
  const selectFile = (kind: string) => {
    setUploadKind(kind)
    if (fileInput.current) {
      fileInput.current.accept =
        kind === 'file'
          ? '.pdf,.txt,.csv,.zip,.docx,.xlsx,.pptx'
          : '.png,.jpg,.jpeg,.webp,.gif'
      fileInput.current.click()
    }
  }
  return (
    <Main>
      <div className='mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 p-3 sm:p-5'>
        <header className='flex flex-wrap items-center justify-between gap-2 border-b pb-3'>
          <div>
            <h1 className='text-xl font-semibold'>{t('Community chat')}</h1>
            <p className='text-muted-foreground text-sm' role='status'>
              {connected ? t('Connected') : t('Reconnecting')}
            </p>
          </div>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => selectFile('avatar')}
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
            <article key={message.id} className='flex gap-3'>
              <Avatar className='size-9 shrink-0'>
                <AvatarImage
                  src={message.avatar || undefined}
                  alt={message.name}
                />
                <AvatarFallback style={getUserAvatarStyle(message.name)}>
                  {getUserAvatarFallback(message.name)}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{message.name}</span>
                  <time
                    className='text-muted-foreground text-xs'
                    dateTime={new Date(message.created_at * 1000).toISOString()}
                  >
                    {new Date(message.created_at * 1000).toLocaleString(locale)}
                  </time>
                </div>
                {message.deleted ? (
                  <p className='text-muted-foreground italic'>
                    {t('Message deleted')}
                  </p>
                ) : (
                  <>
                    {message.text && (
                      <p className='break-words whitespace-pre-wrap'>
                        {message.text}
                      </p>
                    )}
                    {(message.kind === 'image' ||
                      message.kind === 'sticker') && (
                      <a
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
                              ? 'max-h-40 max-w-40 rounded-md object-contain'
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
                        {message.filename} ({formatNumber(message.size, locale)}{' '}
                        B)
                      </a>
                    )}
                  </>
                )}
              </div>
              {(user?.role ?? 0) >= 100 && !message.deleted && (
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => setRemove(message)}
                >
                  {t('Delete')}
                </Button>
              )}
            </article>
          ))}
        </div>
        <form
          className='space-y-2 border-t pt-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim() && !busy) send.mutate(text)
          }}
        >
          {status.data.bot_enabled && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                setText((value) => `${value}@${status.data.bot_name} `)
              }
            >
              {t('Mention bot')} @{status.data.bot_name}
            </Button>
          )}
          <Textarea
            aria-label={t('Message')}
            placeholder={t('Write a message')}
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            rows={3}
          />
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => selectFile('image')}
            >
              {t('Image')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => selectFile('sticker')}
            >
              {t('Sticker')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => selectFile('file')}
            >
              {t('File')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              aria-label={t('Insert emoji')}
              disabled={busy}
              onClick={() => setText((value) => `${value}😊`)}
            >
              😊
            </Button>
            <Button
              type='submit'
              disabled={busy || !connected || !text.trim()}
              className='ms-auto'
            >
              {t('Send')}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Images and stickers: 5 MiB. Files: 10 MiB. Attachment links can be shared outside this chat.'
            )}
          </p>
          <Input
            ref={fileInput}
            type='file'
            className='hidden'
            aria-label={t('Upload attachment')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) upload.mutate({ file, kind: uploadKind })
            }}
          />
        </form>
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
