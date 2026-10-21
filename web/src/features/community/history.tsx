import { useInfiniteQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStore } from '@/stores/auth-store'

import { getChatHistory, type ChatMessage } from './api'
import { CommunityBotFeedback } from './bot-feedback'
import { ChatMessageBubble } from './message-bubble'
import { ChatModerationDialog } from './moderation-dialog'

type ModerationCallbacks = {
  onCleared?: (throughId: number) => void
  onDeleted?: (id: number) => void
}

export function CommunityHistory(props: ModerationCallbacks) {
  const { t } = useTranslation()
  const userId = useAuthStore((s) => s.auth.user?.id)
  const canModerate = useAuthStore((s) => (s.auth.user?.role ?? 0) >= 10)
  const [target, setTarget] = useState<ChatMessage | 'all' | null>(null)
  const history = useInfiniteQuery({
    queryKey: ['community-history', userId],
    queryFn: ({ pageParam }) => getChatHistory(pageParam, true),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.has_more ? page.items[0]?.id : undefined),
    gcTime: 0,
  })
  const scroll = useRef<HTMLDivElement>(null)
  const previous = useRef({ pages: 0, height: 0 })
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const pages = history.data?.pages.length || 0
    if (previous.current.pages === 0) el.scrollTop = el.scrollHeight
    else if (pages > previous.current.pages) {
      el.scrollTop += el.scrollHeight - previous.current.height
    }
    previous.current = { pages, height: el.scrollHeight }
  }, [history.data])
  if (history.isPending) return <LoadingState />
  if (history.isError && !history.data) {
    return <ErrorState onRetry={() => void history.refetch()} />
  }
  const messages = [...(history.data?.pages || [])]
    .reverse()
    .flatMap((page) => page.items)
  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground min-w-0 flex-1 text-sm'>
          {t(
            'All dates are available. Deleted messages retain their original content here.'
          )}
        </p>
        {canModerate && (
          <Button variant='outline' onClick={() => setTarget('all')}>
            {t('Clear all conversations')}
          </Button>
        )}
        <Button
          variant='outline'
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      <div
        ref={scroll}
        className='h-[55vh] min-h-48 space-y-4 overflow-y-auto overscroll-contain p-1 [overflow-anchor:none]'
        role='region'
        aria-label={t('Chat history')}
      >
        {history.hasNextPage && (
          <div className='flex justify-center'>
            <Button
              variant='outline'
              disabled={history.isFetching}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? (
                <LoadingState inline size='sm' />
              ) : (
                t('Load earlier messages')
              )}
            </Button>
          </div>
        )}
        {history.isError && (
          <ErrorState
            className='min-h-0'
            onRetry={() =>
              void (history.isFetchNextPageError
                ? history.fetchNextPage()
                : history.refetch())
            }
          />
        )}
        {messages.length === 0 && <EmptyState title={t('No messages yet')} />}
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id}
            message={message}
            currentUserId={userId}
            onRemove={canModerate ? setTarget : undefined}
            showDeletedContent
          />
        ))}
      </div>
      <ChatModerationDialog
        target={target}
        onClose={() => setTarget(null)}
        onCleared={props.onCleared}
        onDeleted={props.onDeleted}
      />
    </div>
  )
}

export function CommunityRecords(props: ModerationCallbacks) {
  const { t } = useTranslation()
  return (
    <Tabs defaultValue='history'>
      <TabsList className='max-w-full justify-start overflow-x-auto'>
        <TabsTrigger className='flex-none' value='history'>
          {t('Chat history')}
        </TabsTrigger>
        <TabsTrigger className='flex-none' value='feedback'>
          {t('Bot feedback records')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value='history'>
        <CommunityHistory
          onCleared={props.onCleared}
          onDeleted={props.onDeleted}
        />
      </TabsContent>
      <TabsContent value='feedback'>
        <CommunityBotFeedback />
      </TabsContent>
    </Tabs>
  )
}
