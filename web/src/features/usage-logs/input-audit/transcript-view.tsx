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
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type {
  InputAuditEvidenceDocument,
  InputAuditTranscriptItem,
} from './api'
import { HighlightedText } from './highlight'
import { keywordExcerpt } from './keyword'

type TranscriptView = 'all' | 'dialogue' | 'user'

// Users and assistants carry the conversation; prompts, client context and
// tool activity are shown collapsed around it.
function transcriptCategory(item: InputAuditTranscriptItem) {
  if (
    item.kind === 'tool_call' ||
    item.kind === 'tool_result' ||
    item.role === 'tool'
  ) {
    return 'tool'
  }
  if (
    item.kind !== 'message' ||
    item.role === 'system' ||
    item.role === 'developer'
  ) {
    return 'context'
  }
  return item.role === 'user' ? 'user' : 'assistant'
}

export function InputAuditTranscriptView(props: {
  items: InputAuditTranscriptItem[]
  range?: { start: number; end: number }
  focusSeq?: number
  // The user message the request was issued for.
  turnSeq?: number
  query?: string
  before?: ReactNode
  after?: ReactNode
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<TranscriptView>('all')
  const visible = props.items.filter((item) => {
    const category = transcriptCategory(item)
    // A jump target stays visible even when its kind is filtered out.
    if (view === 'all' || item.seq === props.focusSeq) return true
    return (
      category === 'user' || (view === 'dialogue' && category === 'assistant')
    )
  })
  const zoneOf = (seq: number) => {
    if (!props.range || seq < props.range.start) return 'before'
    return seq < props.range.end ? 'request' : 'after'
  }
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <ToggleGroup
        value={[view]}
        onValueChange={(values) => {
          if (values[0]) setView(values[0] as TranscriptView)
        }}
        variant='outline'
        size='sm'
        aria-label={t('Conversation view')}
        className='max-w-full flex-wrap'
      >
        <ToggleGroupItem value='all'>{t('Everything')}</ToggleGroupItem>
        <ToggleGroupItem value='dialogue'>{t('Messages only')}</ToggleGroupItem>
        <ToggleGroupItem value='user'>
          {t('User messages only')}
        </ToggleGroupItem>
      </ToggleGroup>
      {props.before}
      <ol aria-label={t('Conversation')} className='flex flex-col gap-2'>
        {visible.map((item, index) => {
          const zone = zoneOf(item.seq)
          const divider =
            zone !== 'before' &&
            (index === 0 || zoneOf(visible[index - 1].seq) !== zone)
          return (
            <Fragment key={item.seq}>
              {divider && (
                <li
                  aria-hidden='true'
                  className='text-muted-foreground flex items-center gap-2 pt-1 text-xs font-medium'
                >
                  <span className='bg-border h-px flex-1' />
                  {zone === 'request'
                    ? t('Added by this request')
                    : t('Sent after this request')}
                  <span className='bg-border h-px flex-1' />
                </li>
              )}
              <li
                data-seq={item.seq}
                className={cn(
                  'min-w-0 scroll-mt-4',
                  zone === 'request' && 'border-primary border-l-2 pl-2'
                )}
              >
                <InputAuditTranscriptEntry
                  item={item}
                  focused={item.seq === props.focusSeq}
                  turn={item.seq === props.turnSeq}
                  query={props.query}
                />
              </li>
            </Fragment>
          )
        })}
      </ol>
      {visible.length === 0 && <EmptyState className='min-h-24' />}
      {props.after}
    </div>
  )
}

const InputAuditTranscriptEntry = memo(
  function InputAuditTranscriptEntry(props: {
    item: InputAuditTranscriptItem
    focused: boolean
    turn: boolean
    query?: string
  }) {
    const { t, i18n } = useTranslation()
    const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
    const item = props.item
    const category = transcriptCategory(item)
    const body = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const formatted = useMemo(() => {
      if (category !== 'tool' || !/^\s*[[{]/.test(item.text)) return item.text
      try {
        return JSON.stringify(JSON.parse(item.text), null, 2)
      } catch {
        return item.text
      }
    }, [category, item.text])
    // Jumping to an item reveals it, including its first keyword match inside
    // a scrolled message or a collapsed tool item.
    useEffect(() => {
      if (props.focused) setOpen(true)
    }, [props.focused])
    useEffect(() => {
      if (!props.focused || !props.query) return
      body.current
        ?.querySelector('mark')
        ?.scrollIntoView?.({ block: 'nearest' })
    }, [props.focused, props.query, open])
    const labels: Record<string, string> = {
      user: t('User'),
      assistant: t('Assistant'),
      system: t('System'),
      developer: t('Developer'),
      tool: t('Tool'),
    }
    let label = labels[item.role] ?? item.role
    if (item.kind === 'tool_call') label = t('Tool call')
    if (item.kind === 'tool_result') label = t('Tool result')
    if (item.kind === 'context') label = t('Client context')
    const meta = (
      <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
        <span className='text-muted-foreground font-mono text-xs'>
          #{formatNumber(item.seq + 1, locale)}
        </span>
        <span className='text-xs font-medium'>{label}</span>
        {item.name && (
          <span className='font-mono text-xs break-all'>{item.name}</span>
        )}
        {props.turn && <Badge>{t('This message')}</Badge>}
        {category === 'user' && !!item.created_at && (
          <time className='text-muted-foreground text-xs'>
            {dayjs.unix(item.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </time>
        )}
        {item.truncated && (
          <Badge variant='outline'>
            {t('Excerpt of {{chars}} characters', {
              chars: formatNumber(item.original_chars, locale),
            })}
          </Badge>
        )}
        {item.unavailable && (
          <Badge variant='warning'>{t('Text not retained')}</Badge>
        )}
        {!!item.media && (
          <Badge variant='secondary'>
            {t('Media not retained: {{number}}', {
              number: formatNumber(item.media, locale),
            })}
          </Badge>
        )}
      </span>
    )
    if (category === 'user' || category === 'assistant') {
      return (
        <article
          ref={body}
          className={cn(
            'flex min-w-0 flex-col gap-2 rounded-lg border p-3',
            category === 'user' ? 'border-primary/40 bg-primary/5' : 'bg-card',
            props.focused && 'ring-primary/50 ring-2'
          )}
        >
          <header className='flex items-start justify-between gap-2'>
            {meta}
            {item.text && (
              <CopyButton
                value={item.text}
                size='icon'
                variant='ghost'
                className='size-7 shrink-0'
                tooltip={t('Copy')}
              />
            )}
          </header>
          {item.text && (
            <p
              className={cn(
                'overflow-y-auto text-sm [overflow-wrap:anywhere] whitespace-pre-wrap',
                category === 'user' ? 'max-h-96' : 'max-h-72'
              )}
            >
              <HighlightedText text={item.text} query={props.query} />
            </p>
          )}
        </article>
      )
    }
    return (
      <Collapsible
        ref={body}
        open={open}
        onOpenChange={setOpen}
        className={cn(
          'min-w-0 rounded-md border border-dashed',
          category === 'context' && 'bg-muted/40',
          props.focused && 'ring-primary/50 ring-2'
        )}
      >
        <CollapsibleTrigger className='group flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left'>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className='text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90'
            aria-hidden='true'
          />
          {meta}
          <span className='text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs'>
            <HighlightedText
              text={keywordExcerpt(item.text, props.query)
                .slice(0, 240)
                .replaceAll(/\s+/g, ' ')}
              query={props.query}
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent hiddenUntilFound className='border-t px-3 py-2'>
          {item.text && (
            <>
              <pre className='max-h-80 overflow-auto font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap'>
                <HighlightedText text={formatted} query={props.query} />
              </pre>
              <CopyButton value={item.text} size='sm' variant='ghost'>
                {t('Copy')}
              </CopyButton>
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
    )
  }
)

// Case snapshots and interception context store a citation document; its
// message numbers are the ones decisions reference.
export function InputAuditEvidenceView(props: {
  document: InputAuditEvidenceDocument
  complete: boolean
}) {
  const { t } = useTranslation()
  const items = props.document.messages.map((message, index) => ({
    seq: index,
    role: message.role,
    kind: message.kind || 'message',
    name: message.name,
    call_id: message.call_id,
    text: message.text,
    original_chars: message.original_chars ?? message.text.length,
    truncated: message.truncated,
    unavailable: !message.text && (message.original_chars ?? 0) > 0,
  }))
  const latestUser = items.reduce(
    (latest, item) =>
      item.role === 'user' && item.kind === 'message' && item.text
        ? item.seq
        : latest,
    -1
  )
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <Badge variant='secondary'>
        {props.complete
          ? t('Complete submitted text')
          : t('Incomplete evidence')}
      </Badge>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Evidence contains client-submitted messages. Assistant history is not a verified upstream response.'
        )}
      </p>
      {!props.complete && (
        <Alert>
          <AlertDescription>
            {props.document.source === 'legacy_preview'
              ? t('Historical preview; original context was not retained')
              : t(
                  'Only retained excerpts are shown. Omitted text and media may change the interpretation.'
                )}
          </AlertDescription>
        </Alert>
      )}
      {props.document.previous_response_id && (
        <p className='text-xs break-all'>
          {t('Previous response ID')}: {props.document.previous_response_id}
        </p>
      )}
      {!!props.document.omitted?.length && (
        <p className='text-muted-foreground text-xs'>
          {t('Collection gaps')}: {props.document.omitted.join(', ')}
        </p>
      )}
      <InputAuditTranscriptView
        items={items}
        focusSeq={latestUser >= 0 ? latestUser : undefined}
      />
    </div>
  )
}
