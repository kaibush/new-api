/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  DetailRow,
  DetailSection,
} from '../components/dialogs/log-detail-layout'
import {
  getInputAuditTranscript,
  searchInputAuditTranscript,
  type InputAudit,
} from './api'
import { InputAuditCasePanel } from './case-panel'
import { AuditFeatureSurface } from './feature-surface'
import { HighlightedText } from './highlight'
import { InputAuditTranscriptView } from './transcript-view'

const TRANSCRIPT_PAGE = 200

// keyword is the list's message search; the conversation opens on its matches.
export function InputAuditDetailsDialog(props: {
  entry: InputAudit
  keyword?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <AuditFeatureSurface
      open={open}
      onOpenChange={setOpen}
      initialFocus={false}
      title={t('Input Audits')}
      trigger={
        <Button size='sm' variant='ghost'>
          {t('Details')}
        </Button>
      }
      bodyClassName='flex flex-col gap-3'
    >
      {open && (
        <InputAuditConversationDetails
          entry={props.entry}
          keyword={props.keyword}
        />
      )}
    </AuditFeatureSurface>
  )
}

// One list row is one user message. The details show the whole conversation
// it belongs to, with the items each request of that message added.
function InputAuditConversationDetails(props: {
  entry: InputAudit
  keyword?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const [auditID, setAuditID] = useState(props.entry.id)
  const [anchor, setAnchor] = useState<number>()
  const [focus, setFocus] = useState<{ seq: number }>()
  const [tab, setTab] = useState('conversation')
  const conversation = useRef<HTMLDivElement>(null)
  const transcript = useInfiniteQuery({
    queryKey: ['input-audit-transcript', user?.id, auditID, anchor],
    queryFn: ({ pageParam }) => getInputAuditTranscript(auditID, pageParam),
    initialPageParam: { offset: anchor, limit: TRANSCRIPT_PAGE } as {
      offset?: number
      limit: number
    },
    getNextPageParam: (last) =>
      last.offset + TRANSCRIPT_PAGE < last.total
        ? { offset: last.offset + TRANSCRIPT_PAGE, limit: TRANSCRIPT_PAGE }
        : undefined,
    getPreviousPageParam: (first) =>
      first.offset > 0
        ? {
            offset: Math.max(0, first.offset - TRANSCRIPT_PAGE),
            limit: Math.min(TRANSCRIPT_PAGE, first.offset),
          }
        : undefined,
    placeholderData: keepPreviousData,
    enabled: user?.role === ROLE.SUPER_ADMIN,
    retry: false,
  })
  const [searchText, setSearchText] = useState(props.keyword?.trim() ?? '')
  const searchTerm = useDebounce(searchText.trim(), 300)
  const searchable =
    searchTerm !== '' &&
    [...searchTerm].length <= 256 &&
    !searchTerm.includes('\u0000')
  const search = useQuery({
    queryKey: ['input-audit-transcript-search', user?.id, auditID, searchTerm],
    queryFn: () => searchInputAuditTranscript(auditID, searchTerm),
    enabled: user?.role === ROLE.SUPER_ADMIN && searchable,
    retry: false,
  })
  const hits = (searchable && search.data?.seqs) || []
  const highlight = searchable ? searchTerm : undefined
  const [cursor, setCursor] = useState(-1)
  const pages = transcript.data?.pages ?? []
  const current = pages.at(-1)
  const items = pages.flatMap((page) => page.items)
  const jump = (seq: number) => {
    if (!items.some((item) => item.seq === seq)) {
      setAnchor(Math.max(0, seq - 10))
    }
    setFocus({ seq })
  }
  // New results move to the match nearest the message this request was
  // issued for, which is the list row's own match.
  const applied = useRef<unknown>(undefined)
  useEffect(() => {
    if (!search.data || !current || applied.current === search.data) return
    applied.current = search.data
    const seqs = search.data.seqs
    if (seqs.length === 0) {
      setCursor(-1)
      return
    }
    const next = seqs.findIndex((seq) => seq >= current.turn_seq)
    const index = next >= 0 ? next : seqs.length - 1
    setCursor(index)
    if (!items.some((item) => item.seq === seqs[index])) {
      setAnchor(Math.max(0, seqs[index] - 10))
    }
    setFocus({ seq: seqs[index] })
  }, [search.data, current, items])
  const step = (delta: number) => {
    if (hits.length === 0) return
    let next = (cursor + delta + hits.length) % hits.length
    if (cursor < 0) next = delta > 0 ? 0 : hits.length - 1
    setCursor(next)
    jump(hits[next])
  }
  // Earlier captures have no conversation position; show the latest user
  // message they retained.
  const latestUser = items.reduce<number | undefined>(
    (latest, item) =>
      item.role === 'user' && item.kind === 'message' ? item.seq : latest,
    undefined
  )
  const turnTarget =
    current && current.turn_seq >= 0 ? current.turn_seq : latestUser
  const target = focus?.seq ?? turnTarget
  const settled = !transcript.isPending && !transcript.isPlaceholderData
  useEffect(() => {
    if (target === undefined || !settled) return
    conversation.current
      ?.querySelector(`[data-seq="${target}"]`)
      ?.scrollIntoView?.({ block: 'center' })
  }, [focus, target, settled])

  if (transcript.isPending) return <LoadingState />
  if (!current) {
    return <ErrorState onRetry={() => void transcript.refetch()} />
  }
  const request = current.request
  const thread = current.thread
  const range = current.request_range
  const evidenceReasons: Record<string, string> = {
    expired: t('Evidence expired'),
    capacity_evicted: t('Evidence was removed by storage limits'),
    disabled: t('Evidence collection is disabled'),
    pending: t('Evidence is waiting to be stored'),
    capture_failed: t('Evidence collection or storage failed'),
    write_failed: t('Evidence collection or storage failed'),
    queue_dropped: t('Evidence was dropped because the queue was full'),
  }
  const notices: string[] = []
  if (current.source === 'preview') {
    notices.push(
      evidenceReasons[current.reason ?? ''] ??
        t('Historical preview; original context was not retained')
    )
  }
  if (current.source === 'legacy') {
    notices.push(
      t(
        'Captured before conversation tracking; only the text retained for this request is shown.'
      )
    )
  }
  if (thread?.context_missing || current.context_missing) {
    notices.push(
      t(
        'The client referenced context it did not submit, such as a previous response ID. That context cannot be shown.'
      )
    )
  }
  if (thread?.truncated) {
    notices.push(
      t(
        'Some requests exceeded the item limit; their extra items were not stored.'
      )
    )
  }
  if (thread?.parent_id) {
    notices.push(
      t(
        'This conversation branched from an earlier one because the client edited or replayed its history.'
      )
    )
  }
  if (current.source === 'thread' && range.start === range.end) {
    notices.push(
      t(
        'This request added no new items. It resent existing history, for example as a retry.'
      )
    )
  }
  const firstPage = pages[0]
  const turnRequests = current.turn_requests.some(
    (row) => row.id === request.id
  )
    ? current.turn_requests
    : [request, ...current.turn_requests]
  const loadedEnd = current.offset + current.items.length
  let searchStatus = ''
  if (searchable && search.isFetching) searchStatus = t('Searching…')
  else if (searchable && search.isError) searchStatus = t('Search failed')
  else if (searchable && hits.length === 0) searchStatus = t('No matches')
  else if (hits.length > 0) {
    searchStatus = `${formatNumber(Math.max(cursor, 0) + 1, locale)} / ${formatNumber(hits.length, locale)}${search.data?.more ? '+' : ''}`
  }
  return (
    <>
      <header className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0 space-y-1'>
          <h3 className='text-sm font-medium'>
            {request.username} (#{request.user_id}) · {request.model}
          </h3>
          <p className='text-muted-foreground text-xs'>
            {t('Requests for this message: {{requests}}', {
              requests: formatNumber(current.turn_request_count, locale),
            })}
            {thread &&
              ` · ${t(
                'Conversation · items: {{items}} · requests: {{requests}} · {{start}} – {{end}}',
                {
                  items: formatNumber(thread.item_count, locale),
                  requests: formatNumber(thread.request_count, locale),
                  start: dayjs.unix(thread.first_at).format('MM-DD HH:mm'),
                  end: dayjs.unix(thread.last_at).format('MM-DD HH:mm'),
                }
              )}`}
          </p>
          {!!thread?.tools.length && (
            <p
              className='text-muted-foreground line-clamp-2 text-xs break-all'
              title={thread.tools.join(', ')}
            >
              {t('Tools')}: {thread.tools.join(', ')}
            </p>
          )}
        </div>
        <div className='flex shrink-0 flex-col gap-1 sm:w-72'>
          <NativeSelect
            aria-label={t('Request for this message')}
            value={String(auditID)}
            onChange={(event) => {
              setAuditID(Number(event.target.value))
              setAnchor(undefined)
              setFocus(undefined)
              setCursor(-1)
            }}
            className='w-full'
          >
            {turnRequests.map((row) => (
              <NativeSelectOption key={row.id} value={String(row.id)}>
                {dayjs.unix(row.created_at).format('MM-DD HH:mm:ss')} ·{' '}
                {row.model} ·{' '}
                {t('New items: {{items}}', {
                  items: formatNumber(row.new_items ?? 0, locale),
                })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {current.turn_request_count > current.turn_requests.length && (
            <p className='text-muted-foreground text-xs'>
              {t('Showing the latest {{shown}} of {{total}} requests', {
                shown: formatNumber(current.turn_requests.length, locale),
                total: formatNumber(current.turn_request_count, locale),
              })}
            </p>
          )}
        </div>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='conversation'>{t('Conversation')}</TabsTrigger>
          <TabsTrigger value='request'>{t('Request')}</TabsTrigger>
          <TabsTrigger value='review'>{t('Review')}</TabsTrigger>
        </TabsList>
        <TabsContent value='conversation' className='pt-3' keepMounted>
          <div
            className={cn(
              'grid min-w-0 gap-4',
              current.outline.length > 0 && 'lg:grid-cols-[16rem_minmax(0,1fr)]'
            )}
          >
            {current.outline.length > 0 && (
              <nav
                aria-label={t('User messages in this conversation')}
                className='flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto lg:sticky lg:top-0 lg:max-h-[70dvh] lg:self-start'
              >
                <p className='text-muted-foreground px-2 text-xs font-medium'>
                  {t('User messages in this conversation')}
                </p>
                {current.outline.map((entry) => (
                  <Button
                    key={entry.seq}
                    variant='ghost'
                    size='sm'
                    aria-current={
                      entry.seq === current.turn_seq ? 'true' : undefined
                    }
                    className={cn(
                      'h-auto w-full justify-start py-1.5 text-left font-normal whitespace-normal',
                      entry.seq === current.turn_seq &&
                        'bg-primary/10 text-primary'
                    )}
                    onClick={() => jump(entry.seq)}
                  >
                    <span className='flex min-w-0 flex-col gap-0.5'>
                      <span className='line-clamp-2 text-xs [overflow-wrap:anywhere]'>
                        <HighlightedText text={entry.text} query={highlight} />
                      </span>
                      <span className='text-muted-foreground text-[11px]'>
                        #{formatNumber(entry.seq + 1, locale)} ·{' '}
                        {dayjs.unix(entry.created_at).format('MM-DD HH:mm')} · ×
                        {formatNumber(entry.requests, locale)}
                      </span>
                    </span>
                  </Button>
                ))}
              </nav>
            )}
            <div
              ref={conversation}
              aria-busy={transcript.isFetching}
              className={cn(
                'flex min-w-0 flex-col gap-3',
                transcript.isPlaceholderData && 'opacity-60'
              )}
            >
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <Search aria-hidden='true' className='size-3.5' />
                </InputGroupAddon>
                <InputGroupInput
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    step(event.shiftKey ? -1 : 1)
                  }}
                  placeholder={t('Search this conversation')}
                  aria-label={t('Search this conversation')}
                />
                <InputGroupAddon align='inline-end'>
                  <InputGroupText role='status' aria-live='polite'>
                    {searchStatus}
                  </InputGroupText>
                  <InputGroupButton
                    size='icon-xs'
                    aria-label={t('Previous match')}
                    disabled={hits.length === 0}
                    onClick={() => step(-1)}
                  >
                    <ChevronUp aria-hidden='true' />
                  </InputGroupButton>
                  <InputGroupButton
                    size='icon-xs'
                    aria-label={t('Next match')}
                    disabled={hits.length === 0}
                    onClick={() => step(1)}
                  >
                    <ChevronDown aria-hidden='true' />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {notices.length > 0 && (
                <Alert>
                  <AlertDescription className='flex flex-col gap-1'>
                    {notices.map((notice) => (
                      <span key={notice}>{notice}</span>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <InputAuditTranscriptView
                items={items}
                range={current.source === 'thread' ? range : undefined}
                focusSeq={
                  target !== undefined && target >= 0 ? target : undefined
                }
                turnSeq={turnTarget}
                query={highlight}
                before={
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <p className='text-muted-foreground text-xs'>
                      {t('Items {{start}}–{{end}} of {{total}}', {
                        start: formatNumber(
                          Math.min(firstPage.offset + 1, current.total),
                          locale
                        ),
                        end: formatNumber(loadedEnd, locale),
                        total: formatNumber(current.total, locale),
                      })}
                    </p>
                    {transcript.hasPreviousPage && (
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={
                          transcript.isFetchingPreviousPage ||
                          transcript.isPlaceholderData
                        }
                        onClick={() => void transcript.fetchPreviousPage()}
                      >
                        {t('Show earlier items')}
                      </Button>
                    )}
                  </div>
                }
                after={
                  transcript.hasNextPage && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='self-center'
                      disabled={
                        transcript.isFetchingNextPage ||
                        transcript.isPlaceholderData
                      }
                      onClick={() => void transcript.fetchNextPage()}
                    >
                      {t('Show later items')}
                    </Button>
                  )
                }
              />
            </div>
          </div>
        </TabsContent>
        <TabsContent value='request' className='flex flex-col gap-3 pt-3'>
          <DetailSection label={t('Request')}>
            <DetailRow
              label={t('Received at gateway')}
              value={dayjs
                .unix(request.created_at)
                .format('YYYY-MM-DD HH:mm:ss')}
            />
            <DetailRow label={t('Model')} value={request.model} />
            <DetailRow label={t('Token ID')} value={request.token_id} />
            <DetailRow
              label={t('Request ID')}
              value={request.request_id}
              mono
            />
            <DetailRow label={t('Route')} value={request.route} mono />
            <DetailRow label='IP' value={request.ip} mono />
            <DetailRow
              label={t('Conversation items')}
              value={t('Total: {{items}} · Added by this request: {{added}}', {
                items: formatNumber(request.item_count ?? 0, locale),
                added: formatNumber(request.new_items ?? 0, locale),
              })}
            />
            <DetailRow
              label={t('Original length')}
              value={formatNumber(request.content_chars, locale)}
            />
            <DetailRow
              label={t('Original content hash')}
              value={request.input_hash || request.content_hash}
              mono
            />
          </DetailSection>
          <DetailSection label={t('Request text preview')}>
            {request.truncated && (
              <p role='status' className='text-muted-foreground text-xs'>
                {t(
                  'Long messages retain the beginning and end; the middle is omitted.'
                )}
              </p>
            )}
            <p className='max-h-80 overflow-y-auto [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
              <HighlightedText text={request.content} query={highlight} />
            </p>
            <CopyButton value={request.content} size='sm'>
              {t('Copy')}
            </CopyButton>
          </DetailSection>
        </TabsContent>
        <TabsContent value='review' className='pt-3'>
          <InputAuditCasePanel key={auditID} auditID={auditID} />
        </TabsContent>
      </Tabs>
    </>
  )
}
