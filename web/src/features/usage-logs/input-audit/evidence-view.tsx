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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { DataTablePagination, useDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { InputAuditEvidenceDocument } from './api'

export function InputAuditEvidenceView(props: {
  document: InputAuditEvidenceDocument
  complete: boolean
  onPromptHash?: (hash: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const messages = useMemo(() => {
    const needle = search.toLowerCase()
    return props.document.messages.filter((message) =>
      [
        message.role,
        message.name,
        message.call_id,
        message.path,
        message.text,
      ].some((value) => value?.toLowerCase().includes(needle))
    )
  }, [props.document.messages, search])
  const { table } = useDataTable({
    data: messages,
    columns: [],
    withPaginationRowModel: true,
    manualPagination: false,
    initialPagination: { pageIndex: 0, pageSize: 10 },
  })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='flex flex-col gap-3'>
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
      <Input
        aria-label={t('Search retained evidence')}
        placeholder={t('Search retained evidence')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          table.setPageIndex(0)
        }}
      />
      <Accordion defaultValue={['message-0']}>
        {table.getRowModel().rows.map((row) => {
          const message = row.original
          const index = message.index ?? row.index
          return (
            <AccordionItem
              key={message.index ?? index}
              value={`message-${index}`}
            >
              <AccordionTrigger>
                {t('Message')} {formatNumber(index + 1, locale)} ·{' '}
                {message.role} · {message.kind ?? t('Message')} {message.name}
              </AccordionTrigger>
              <AccordionContent>
                <p className='text-muted-foreground text-xs break-all'>
                  {message.path} {message.call_id}
                </p>
                {message.original_chars !== undefined && (
                  <p className='text-muted-foreground text-xs'>
                    {t('Original length')}:{' '}
                    {formatNumber(message.original_chars, locale)} ·{' '}
                    {message.truncated
                      ? t('Excerpt retained')
                      : t('Complete submitted text')}
                  </p>
                )}
                {message.original_hash && (
                  <p className='text-muted-foreground text-xs break-all'>
                    {t('Original content hash')}: {message.original_hash}
                  </p>
                )}
                {!message.text && (
                  <p className='text-muted-foreground text-xs'>
                    {t('Text omitted by request budget')}
                  </p>
                )}
                {props.onPromptHash &&
                  message.original_hash &&
                  message.kind === 'message' &&
                  (message.role === 'system' ||
                    message.role === 'developer') && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        if (message.original_hash) {
                          props.onPromptHash?.(message.original_hash)
                        }
                      }}
                    >
                      {t('Requests using this prompt')}
                    </Button>
                  )}
                <p className='max-h-64 overflow-y-auto text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
                  {message.text}
                </p>
                <CopyButton
                  value={message.text}
                  size='sm'
                  disabled={!message.text}
                >
                  {t('Copy')}
                </CopyButton>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      {messages.length === 0 && <EmptyState className='min-h-24' />}
      <DataTablePagination table={table} compact />
    </div>
  )
}
