import { useTranslation } from 'react-i18next'

import { MessageContent } from '@/components/ai-elements/message'
import { DataTableRowActionMenu } from '@/components/data-table'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ChatMessage } from './api'
import { MessageText } from './message-text'

export function ChatMessageBubble(props: {
  message: ChatMessage
  currentUserId?: number
  showDeletedContent?: boolean
  onReply?: (message: ChatMessage) => void
  onRemove?: (message: ChatMessage) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const message = props.message
  return (
    <article
      id={`message-${message.id}`}
      aria-busy={message.sending || undefined}
      className={cn('group group/message flex items-start gap-3', {
        'flex-row-reverse is-user': message.user_id === props.currentUserId,
        'is-assistant': message.user_id !== props.currentUserId,
      })}
    >
      <Avatar className='size-9 shrink-0'>
        <AvatarImage src={message.avatar || undefined} alt={message.name} />
        <AvatarFallback style={getUserAvatarStyle(message.name)}>
          {getUserAvatarFallback(message.name)}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn('flex min-w-0 max-w-[min(80%,42rem)] flex-col gap-1', {
          'items-end': message.user_id === props.currentUserId,
          'items-start': message.user_id !== props.currentUserId,
        })}
      >
        <div
          className={cn(
            'flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5',
            {
              'justify-end': message.user_id === props.currentUserId,
            }
          )}
        >
          <span className='max-w-full min-w-0 font-medium break-words'>
            {message.name}
          </span>
          {message.deleted && props.showDeletedContent && (
            <Badge variant='outline'>{t('Message deleted')}</Badge>
          )}
          {message.is_bot && <Badge variant='secondary'>{t('Bot')}</Badge>}
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
                message.user_id === props.currentUserId,
              'items-start rounded-tl-sm border-border/60':
                message.user_id !== props.currentUserId,
            }
          )}
        >
          {message.reply_to_id &&
            (!message.deleted || props.showDeletedContent) && (
              <blockquote className='border-primary bg-muted max-w-full border-l-2 p-2 text-sm'>
                <p className='font-medium'>
                  {message.reply?.name || t('Reply')}
                </p>
                <p className='line-clamp-2 break-words'>
                  <MessageText
                    text={
                      message.reply &&
                      (!message.reply.deleted || props.showDeletedContent)
                        ? message.reply.text || message.reply.filename
                        : t('Message deleted')
                    }
                    currentUserId={props.currentUserId}
                  />
                </p>
              </blockquote>
            )}
          {message.deleted && !props.showDeletedContent ? (
            <p className='text-muted-foreground italic'>
              {t('Message deleted')}
            </p>
          ) : (
            <>
              {message.deleted && !message.text && !message.url && (
                <p className='text-muted-foreground italic'>
                  {t('Original content is no longer available')}
                </p>
              )}
              {message.text && (
                <p className='max-w-full text-left break-words whitespace-pre-wrap'>
                  <MessageText
                    text={message.text}
                    currentUserId={props.currentUserId}
                  />
                </p>
              )}
              {message.url &&
                (message.kind === 'image' || message.kind === 'sticker') && (
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
              {message.url && message.kind === 'file' && (
                <a
                  className='text-primary block break-all underline'
                  href={message.url}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {message.filename} ({formatNumber(message.size, locale)} B)
                </a>
              )}
            </>
          )}
        </MessageContent>
        {message.sending && (
          <span role='status'>
            <LoadingState inline size='sm' message={t('Sending...')} />
          </span>
        )}
        {props.onReply && !message.deleted && !message.sending && (
          <div
            data-message-actions
            className='text-muted-foreground flex h-6 items-center gap-1'
          >
            <DataTableRowActionMenu
              ariaLabel={t('More actions')}
              triggerSize='icon-xs'
              contentClassName='w-36'
            >
              <DropdownMenuItem onClick={() => props.onReply?.(message)}>
                {t('Reply')}
              </DropdownMenuItem>
              {props.onRemove && (
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => props.onRemove?.(message)}
                >
                  {t('Delete')}
                </DropdownMenuItem>
              )}
            </DataTableRowActionMenu>
          </div>
        )}
      </div>
    </article>
  )
}
