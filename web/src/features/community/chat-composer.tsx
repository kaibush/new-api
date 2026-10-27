import { Attachment01Icon, Image01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import {
  sendChatMessage,
  uploadChatFile,
  type ChatMember,
  type ChatMessage,
  type ChatStatus,
} from './api'
import { EmojiPicker } from './emoji-picker'
import { MessageText } from './message-text'

export function ChatComposer(props: {
  connected: boolean
  status: ChatStatus
  users: ChatMember[]
  reply: ChatMessage | null
  onCancelReply: () => void
  currentUser: ChatMember
  onSending: (message: ChatMessage) => void
  onDelivered: (clientId: string, message: ChatMessage) => void
  onFailed: (clientId: string) => boolean
  onSent: (sentReplyId?: number) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<{
    file: File
    kind: 'image' | 'file'
  } | null>(null)
  const [preview, setPreview] = useState('')
  const [mentions, setMentions] = useState<Record<string, ChatMember>>({})
  const [mentionOpen, setMentionOpen] = useState(false)
  const retry = useRef<{
    clientId: string
    text: string
    file?: File
    replyId?: number
  } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const inFlight = useRef(false)
  const kind = useRef<'image' | 'file'>('image')
  const selection = useRef({ start: 0, end: 0 })
  useEffect(() => {
    if (!pending || pending.kind !== 'image') {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(pending.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])
  const send = useMutation({
    mutationFn: (submission: {
      clientId: string
      outgoing: string
      draft: string
      mentions: Record<string, ChatMember>
      attachment: typeof pending
      reply: ChatMessage | null
    }) =>
      submission.attachment
        ? uploadChatFile(
            submission.attachment.file,
            submission.attachment.kind,
            submission.outgoing,
            submission.reply?.id,
            submission.clientId
          )
        : sendChatMessage(
            submission.outgoing,
            submission.reply?.id,
            submission.clientId
          ),
    onMutate: (submission) => {
      const attachment = submission.attachment
      props.onSending({
        id: -Date.now(),
        client_id: submission.clientId,
        sending: true,
        user_id: props.currentUser.user_id,
        name: props.currentUser.name,
        avatar: props.currentUser.avatar,
        text: submission.outgoing,
        kind: attachment?.kind || 'text',
        url: attachment ? URL.createObjectURL(attachment.file) : '',
        filename: attachment?.file.name || '',
        size: attachment?.file.size || 0,
        created_at: Math.floor(Date.now() / 1000),
        deleted: false,
        reply_to_id: submission.reply?.id,
        reply: submission.reply || undefined,
      })
      setText('')
      setPending(null)
      setMentions({})
    },
    onSuccess: (result, submission) => {
      props.onDelivered(submission.clientId, result.data)
      props.onSent(submission.reply?.id)
      retry.current = null
    },
    onError: (error, submission) => {
      if (!props.onFailed(submission.clientId)) {
        props.onSent(submission.reply?.id)
        retry.current = null
        return
      }
      setText(submission.draft)
      setPending(submission.attachment)
      setMentions(submission.mentions)
      handleServerError(error)
    },
    onSettled: () => {
      inFlight.current = false
    },
  })
  function stage(file: File, fileKind: 'image' | 'file') {
    if (pending) {
      toast.error(t('Remove the pending attachment first'))
      return
    }
    if (file.size > (fileKind === 'image' ? 5 : 10) * 1024 * 1024) {
      toast.error(t('Attachment exceeds the size limit'))
      return
    }
    if (
      fileKind === 'image' &&
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        file.type
      )
    ) {
      toast.error(t('Unsupported or invalid file'))
      return
    }
    setPending({ file, kind: fileKind })
  }
  function insert(value: string) {
    const { start, end } = selection.current
    const next = text.slice(0, start) + value + text.slice(end)
    if (next.length > 2000) return
    setText(next)
    selection.current = {
      start: start + value.length,
      end: start + value.length,
    }
    requestAnimationFrame(() => {
      editor.current?.focus()
      editor.current?.setSelectionRange(
        selection.current.start,
        selection.current.end
      )
    })
  }
  return (
    <form
      className='space-y-2 rounded-lg border p-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (
          !inFlight.current &&
          !props.reply?.deleted &&
          props.connected &&
          (text.trim() || pending)
        ) {
          const labels = Object.keys(mentions).sort(
            (a, b) => b.length - a.length
          )
          let outgoing = text
          if (labels.length) {
            const pattern = labels
              .map((label) => label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('|')
            outgoing = text.replaceAll(
              new RegExp(`(^|\\s)(${pattern})(?=$|\\s|[.,!?，。！？])`, 'g'),
              (_, prefix: string, label: string) =>
                `${prefix}@[${mentions[label].name.replaceAll(/[\]\r\n]/g, '')}](user:${mentions[label].user_id})`
            )
          }
          const previous = retry.current
          const clientId =
            previous &&
            previous.text === outgoing &&
            previous.file === pending?.file &&
            previous.replyId === props.reply?.id
              ? previous.clientId
              : crypto.randomUUID()
          retry.current = {
            clientId,
            text: outgoing,
            file: pending?.file,
            replyId: props.reply?.id,
          }
          inFlight.current = true
          send.mutate({
            clientId,
            outgoing,
            draft: text,
            mentions,
            attachment: pending,
            reply: props.reply,
          })
          editor.current?.focus({ preventScroll: true })
        }
      }}
    >
      <div
        role='group'
        aria-label={t('Message tools')}
        className='flex flex-wrap items-center gap-1 border-b pb-2'
      >
        <EmojiPicker
          disabled={send.isPending || text.length >= 2000}
          onSelect={insert}
        />
        {(['image', 'file'] as const).map((item) => (
          <Button
            key={item}
            type='button'
            variant='ghost'
            size='icon'
            disabled={send.isPending || !!pending}
            aria-label={item === 'image' ? t('Image') : t('File')}
            title={item === 'image' ? t('Image') : t('File')}
            onClick={() => {
              kind.current = item
              if (input.current) {
                input.current.accept =
                  item === 'image'
                    ? '.png,.jpg,.jpeg,.webp,.gif'
                    : '.pdf,.txt,.csv,.zip,.docx,.xlsx,.pptx'
                input.current.click()
              }
            }}
          >
            <HugeiconsIcon
              icon={item === 'image' ? Image01Icon : Attachment01Icon}
              size={20}
            />
          </Button>
        ))}
        <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
          <PopoverTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('Mention user')}
                title={t('Mention user')}
                disabled={send.isPending}
              />
            }
          >
            @
          </PopoverTrigger>
          <PopoverContent align='start' side='top'>
            <PopoverTitle className='sr-only'>{t('Mention user')}</PopoverTitle>
            <Command>
              <CommandInput placeholder={t('Search users')} />
              <CommandList>
                <CommandEmpty>{t('No users found')}</CommandEmpty>
                {props.users.map((user) => (
                  <CommandItem
                    key={user.user_id}
                    value={`${user.name} ${user.user_id}`}
                    onSelect={() => {
                      const duplicateName = props.users.some(
                        (other) =>
                          other.user_id !== user.user_id &&
                          other.name === user.name
                      )
                      const label = `@${user.name}${duplicateName ? ` #${user.user_id}` : ''}`
                      setMentions((current) => ({ ...current, [label]: user }))
                      insert(` ${label} `)
                      setMentionOpen(false)
                    }}
                  >
                    {user.name}{' '}
                    <span className='text-muted-foreground'>
                      #{user.user_id}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {props.status.bot_enabled && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={send.isPending}
            onClick={() =>
              insert(
                `${text && !/\s$/.test(text.slice(0, selection.current.start)) ? ' ' : ''}@${props.status.bot_name} `
              )
            }
          >
            {t('Mention bot')} @{props.status.bot_name}
          </Button>
        )}
      </div>
      {props.reply && (
        <div className='bg-muted flex items-start justify-between gap-2 rounded p-2 text-sm'>
          <div className='min-w-0'>
            <p>{t('Replying to {{name}}', { name: props.reply.name })}</p>
            <p className='text-muted-foreground truncate'>
              <MessageText
                text={
                  props.reply.deleted
                    ? t('Message deleted')
                    : props.reply.text || props.reply.filename
                }
              />
            </p>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={send.isPending}
            onClick={() => props.onCancelReply()}
          >
            {t('Cancel reply')}
          </Button>
        </div>
      )}
      {pending && (
        <div className='bg-muted flex items-center gap-2 rounded p-2'>
          {preview && (
            <img
              src={preview}
              alt={t('Pending image')}
              className='size-16 rounded object-contain'
            />
          )}
          <span className='min-w-0 flex-1 truncate text-sm'>
            {pending.file.name}
          </span>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={send.isPending}
            onClick={() => setPending(null)}
          >
            {t('Remove attachment')}
          </Button>
        </div>
      )}
      <Textarea
        ref={editor}
        aria-label={t('Message')}
        placeholder={t('Write a message')}
        value={text}
        maxLength={2000}
        readOnly={send.isPending}
        rows={3}
        aria-describedby='community-send-hint'
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            return
          }
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
        onChange={(event) => setText(event.target.value)}
        onSelect={(event) => {
          selection.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          }
        }}
        onPaste={(event) => {
          const images = [...event.clipboardData.items].filter(
            (item) => item.kind === 'file' && item.type.startsWith('image/')
          )
          if (!images.length) return
          event.preventDefault()
          if (send.isPending) return
          if (images.length > 1) {
            toast.error(t('Select one supported file'))
            return
          }
          const file = images[0].getAsFile()
          if (file) stage(file, 'image')
        }}
      />
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Paste an image to preview it before sending. Images: 5 MiB. Files: 10 MiB.'
          )}
        </p>
        <Button
          type='submit'
          disabled={
            send.isPending ||
            !props.connected ||
            (!text.trim() && !pending) ||
            !!props.reply?.deleted
          }
        >
          {send.isPending ? t('Sending...') : t('Send')}
        </Button>
      </div>
      <p id='community-send-hint' className='text-muted-foreground text-xs'>
        {t('Enter to send, Shift+Enter for a new line')}
      </p>
      <Input
        ref={input}
        type='file'
        className='hidden'
        aria-label={t('Upload attachment')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) stage(file, kind.current)
        }}
      />
    </form>
  )
}
