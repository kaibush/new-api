import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Ticket as TicketIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Message, MessageContent } from '@/components/ai-elements/message'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useIsAdmin } from '@/hooks/use-admin'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  changeTicketStatus,
  listTickets,
  openTicket,
  readTicket,
  replyToTicket,
  ticketSettingsQuery,
  type TicketStatus,
} from './api'

function useTicketLabels() {
  const { t } = useTranslation()
  return {
    awaiting_staff: t('Awaiting support'),
    awaiting_user: t('Awaiting user'),
    resolved: t('Resolved'),
    closed: t('Closed'),
  } satisfies Record<TicketStatus, string>
}

function TicketComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const create = useMutation({
    mutationFn: openTicket,
    onError: (error) => handleServerError(error),
    onSuccess: (ticket) => onCreated(ticket.id),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose()
      }}
      title={t('New ticket')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!create.isPending && title.trim() && body.trim()) {
            create.mutate({ title, body })
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='ticket-title'>{t('Title')}</FieldLabel>
            <Input
              id='ticket-title'
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='ticket-body'>{t('Message')}</FieldLabel>
            <Textarea
              id='ticket-body'
              rows={6}
              required
              maxLength={4000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <Button
            type='submit'
            disabled={create.isPending || !body.trim() || !title.trim()}
          >
            {t('Create ticket')}
          </Button>
        </FieldGroup>
      </form>
    </Dialog>
  )
}

function TicketThread({
  id,
  userId,
  admin,
  onBack,
}: {
  id: number
  userId: number
  admin: boolean
  onBack: () => void
}) {
  const { t } = useTranslation()
  const labels = useTicketLabels()
  const client = useQueryClient()
  const [body, setBody] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const olderPage = useRef<{ height: number; pages: number } | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['tickets', userId, admin, 'thread', id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => readTicket(id, pageParam, signal),
    getNextPageParam: (last) =>
      last.has_more ? last.messages.at(-1)?.id : undefined,
    refetchInterval: 15000,
  })
  const latest = query.data?.pages[0]
  const ticket = latest?.ticket
  const lastMessage = latest?.messages[0]?.id
  const pages = query.data?.pages.length ?? 0
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    if (olderPage.current && pages > olderPage.current.pages) {
      element.scrollTop += element.scrollHeight - olderPage.current.height
      olderPage.current = null
    } else if (follow.current) element.scrollTop = element.scrollHeight
  }, [lastMessage, pages])
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['tickets', userId, admin] })
  const reply = useMutation({
    mutationFn: () => replyToTicket(id, body),
    onError: (error) => handleServerError(error),
    onSuccess: () => {
      setBody('')
      follow.current = true
      return refresh()
    },
  })
  const update = useMutation({
    mutationFn: (status: TicketStatus) => changeTicketStatus(id, status),
    onError: (error) => handleServerError(error),
    onSuccess: refresh,
  })
  return (
    <>
      <div className='flex items-center gap-2 border-b px-4 pb-3'>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          className='md:hidden'
          aria-label={t('Back')}
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className='min-w-0 flex-1'>
          <span className='text-muted-foreground text-xs'>#{id}</span>
          <h2 className='text-base font-semibold break-words'>
            {ticket?.title}
          </h2>
        </div>
        {ticket &&
          (admin ? (
            <NativeSelect
              aria-label={t('Ticket status')}
              value={ticket.status}
              disabled={update.isPending || reply.isPending}
              onChange={(event) =>
                update.mutate(event.target.value as TicketStatus)
              }
            >
              {Object.entries(labels).map(([key, label]) => (
                <NativeSelectOption key={key} value={key}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Badge variant='secondary'>{labels[ticket.status]}</Badge>
          ))}
      </div>
      {query.isError && !query.isFetchNextPageError && (
        <ErrorState onRetry={() => void query.refetch()} />
      )}
      {query.isPending && <LoadingState />}
      {ticket && (!query.isError || query.isFetchNextPageError) && (
        <>
          <div
            ref={scroll}
            role='region'
            aria-label={t('Ticket conversation')}
            onScroll={(event) => {
              const el = event.currentTarget
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60
            }}
            className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2 [overflow-anchor:none]'
          >
            {query.hasNextPage && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  if (scroll.current) {
                    olderPage.current = {
                      height: scroll.current.scrollHeight,
                      pages,
                    }
                  }
                  follow.current = false
                  void query.fetchNextPage()
                }}
              >
                {t('Load earlier messages')}
              </Button>
            )}
            {query.data?.pages
              .flatMap((page) => page.messages)
              .reverse()
              .map((message) => (
                <Message
                  key={message.id}
                  from={message.author_id === userId ? 'user' : 'assistant'}
                >
                  <MessageContent className='max-w-[85%] py-2'>
                    <div className='flex flex-wrap items-center gap-2 text-xs opacity-80'>
                      <strong>
                        {message.author_id === userId && t('You')}
                        {message.author_id !== userId &&
                          (message.staff
                            ? t('Support team')
                            : `${t('User')} #${message.author_id}`)}
                      </strong>
                      <time
                        dateTime={new Date(
                          message.created_at * 1000
                        ).toISOString()}
                      >
                        {formatTimestamp(message.created_at)}
                      </time>
                    </div>
                    <div className='break-words whitespace-pre-wrap'>
                      {message.body}
                    </div>
                  </MessageContent>
                </Message>
              ))}
          </div>
          {ticket.status === 'closed' ? (
            <p className='text-muted-foreground border-t px-4 pt-3 text-sm'>
              {t('This ticket is closed.')}
            </p>
          ) : (
            <form
              className='flex flex-col items-end gap-2 border-t px-4 pt-3'
              onSubmit={(event) => {
                event.preventDefault()
                if (!reply.isPending && body.trim()) reply.mutate()
              }}
            >
              <Textarea
                aria-label={t('Reply')}
                placeholder={t('Write a reply…')}
                maxLength={4000}
                rows={3}
                value={body}
                disabled={reply.isPending}
                onChange={(event) => setBody(event.target.value)}
              />
              <Button
                type='submit'
                size='sm'
                disabled={reply.isPending || update.isPending || !body.trim()}
              >
                {t('Send reply')}
              </Button>
            </form>
          )}
        </>
      )}
    </>
  )
}

type PageProps = { selected?: number; onSelect: (id?: number) => void }

export function TicketsPage(props: PageProps) {
  const { t } = useTranslation()
  const settings = useQuery(ticketSettingsQuery)
  if (settings.isError) {
    return (
      <Main>
        <ErrorState onRetry={() => void settings.refetch()} />
      </Main>
    )
  }
  if (!settings.data) {
    return (
      <Main>
        <LoadingState />
      </Main>
    )
  }
  if (!settings.data.enabled) {
    return (
      <Main>
        <EmptyState
          icon={TicketIcon}
          title={t('Support tickets are disabled.')}
        />
      </Main>
    )
  }
  return <TicketInbox {...props} name={settings.data.name} />
}

function TicketInbox({
  selected,
  onSelect,
  name,
}: PageProps & { name: string }) {
  const { t, i18n } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id) ?? 0
  const admin = useIsAdmin()
  const client = useQueryClient()
  const labels = useTicketLabels()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [compose, setCompose] = useState(false)
  const term = useDebounce(search.trim(), 250)
  const list = useQuery({
    queryKey: ['tickets', userId, admin, 'list', term, status, page],
    queryFn: ({ signal }) => listTickets(term, status, page, signal),
    refetchInterval: 15000,
  })
  return (
    <Main className='p-3 sm:p-4'>
      <div className='mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)]'>
        <Card className={cn('min-h-0 gap-0', selected && 'hidden md:flex')}>
          <div className='flex flex-col gap-3 border-b px-4 pb-3'>
            <div className='flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <h1
                  className='truncate font-semibold'
                  title={name || undefined}
                >
                  {name || (admin ? t('All tickets') : t('My tickets'))}
                </h1>
                {list.data && (
                  <Badge variant='secondary'>
                    {formatNumber(list.data.total, toIntlLocale(i18n.language))}
                  </Badge>
                )}
              </div>
              <Button size='sm' onClick={() => setCompose(true)}>
                <Plus data-icon='inline-start' />
                {t('New ticket')}
              </Button>
            </div>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={t('Search by ticket number or title')}
                placeholder={t('Search by ticket number or title')}
                maxLength={120}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </InputGroup>
            <div
              className='flex flex-wrap gap-1'
              role='group'
              aria-label={t('Ticket status')}
            >
              {Object.entries({ '': t('All'), ...labels }).map(
                ([key, label]) => (
                  <Button
                    key={key}
                    size='xs'
                    variant={status === key ? 'default' : 'secondary'}
                    className='rounded-full'
                    aria-pressed={key === status}
                    onClick={() => {
                      setStatus(key)
                      setPage(1)
                    }}
                  >
                    {label}
                  </Button>
                )
              )}
            </div>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {list.isError && <ErrorState onRetry={() => void list.refetch()} />}
            {list.isPending && <LoadingState />}
            {list.isSuccess && !list.data.items.length && (
              <EmptyState
                icon={TicketIcon}
                title={
                  term || status || page > 1
                    ? t('No results found')
                    : t('No tickets yet')
                }
                description={
                  term || status || page > 1
                    ? undefined
                    : t(
                        'Open a ticket when you need help. Replies appear here.'
                      )
                }
              />
            )}
            {list.isSuccess &&
              list.data.items.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  aria-pressed={item.id === selected}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'hover:bg-muted focus-visible:ring-ring flex w-full flex-col gap-1 border-b px-4 py-3 text-start focus-visible:ring-2 focus-visible:ring-inset',
                    item.id === selected && 'bg-muted'
                  )}
                >
                  <div className='flex w-full items-center justify-between gap-2'>
                    <span className='text-muted-foreground text-xs'>
                      #{item.id}
                    </span>
                    <Badge variant='outline'>{labels[item.status]}</Badge>
                  </div>
                  <span className='line-clamp-2 font-medium break-words'>
                    {item.title}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {formatTimestamp(item.updated_at)}
                  </span>
                </button>
              ))}
          </div>
          {(page > 1 || list.data?.has_more) && (
            <div className='flex justify-between gap-2 px-4 pt-2'>
              <Button
                size='icon-sm'
                variant='outline'
                aria-label={t('Previous page')}
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                size='icon-sm'
                variant='outline'
                aria-label={t('Next page')}
                disabled={!list.data?.has_more}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </Card>
        <Card
          className={cn(
            'min-h-0 min-w-0',
            !selected && 'hidden justify-center md:flex'
          )}
        >
          {selected ? (
            <TicketThread
              key={`${userId}:${selected}`}
              id={selected}
              onBack={() => onSelect()}
              userId={userId}
              admin={admin}
            />
          ) : (
            <EmptyState
              icon={TicketIcon}
              title={t('Select a ticket to view details')}
              description={t(
                'Choose a ticket from the list to read its history and continue the conversation.'
              )}
            />
          )}
        </Card>
        {compose && (
          <TicketComposer
            onClose={() => setCompose(false)}
            onCreated={(id) => {
              setCompose(false)
              setSearch('')
              setStatus('')
              setPage(1)
              void client.invalidateQueries({
                queryKey: ['tickets', userId, admin],
              })
              onSelect(id)
            }}
          />
        )}
      </div>
    </Main>
  )
}
