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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { DataTablePagination, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  DetailRow,
  DetailSection,
} from '../components/dialogs/log-detail-layout'
import { getInputAuditEvidence, getInputAudits, type InputAudit } from './api'
import { InputAuditCasePanel } from './case-panel'
import { InputAuditEvidenceView } from './evidence-view'
import { AuditFeatureSurface } from './feature-surface'

export function InputAuditDetailsDialog(props: { entry: InputAudit }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [promptHash, setPromptHash] = useState('')
  const [relatedPage, setRelatedPage] = useState(1)
  const user = useAuthStore((state) => state.auth.user)
  const evidence = useQuery({
    queryKey: ['input-audit-evidence', user?.id, props.entry.id],
    queryFn: () => getInputAuditEvidence(props.entry.id),
    enabled: open && user?.role === ROLE.SUPER_ADMIN,
    retry: false,
  })
  const related = useQuery({
    queryKey: [
      'input-audit-related',
      user?.id,
      props.entry.user_id,
      promptHash,
      relatedPage,
    ],
    queryFn: () =>
      getInputAudits({
        p: relatedPage,
        page_size: 10,
        ...(promptHash
          ? { prompt_hash: promptHash }
          : { user_id: props.entry.user_id }),
      }),
    enabled: open && user?.role === ROLE.SUPER_ADMIN,
    retry: false,
  })
  const { table: relatedTable } = useDataTable({
    data: related.data?.items ?? [],
    columns: [],
    totalCount: related.data?.total ?? 0,
    manualPagination: true,
    pagination: { pageIndex: relatedPage - 1, pageSize: 10 },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: relatedPage - 1, pageSize: 10 })
          : updater
      setRelatedPage(next.pageIndex + 1)
    },
  })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const evidenceReasons: Record<string, string> = {
    expired: t('Evidence expired'),
    capacity_evicted: t('Evidence was removed by storage limits'),
    disabled: t('Evidence collection is disabled'),
    pending: t('Evidence is waiting to be stored'),
    capture_failed: t('Evidence collection or storage failed'),
    write_failed: t('Evidence collection or storage failed'),
    queue_dropped: t('Evidence was dropped because the queue was full'),
  }
  return (
    <AuditFeatureSurface
      open={open}
      onOpenChange={setOpen}
      title={t('Input Audits')}
      trigger={
        <Button size='sm' variant='ghost'>
          {t('Details')}
        </Button>
      }
      bodyClassName='flex flex-col gap-3'
      contentClassName='sm:max-w-3xl'
    >
      <Accordion>
        <AccordionItem value='request'>
          <AccordionTrigger>{t('Request')}</AccordionTrigger>
          <AccordionContent>
            <DetailSection label={t('Request')}>
              <DetailRow
                label={t('Username')}
                value={`${props.entry.username} (#${props.entry.user_id})`}
              />
              <DetailRow
                label={t('Received at gateway')}
                value={dayjs
                  .unix(props.entry.created_at)
                  .format('YYYY-MM-DD HH:mm:ss')}
              />
              <DetailRow label={t('Model')} value={props.entry.model} />
              <DetailRow label={t('Token ID')} value={props.entry.token_id} />
              <DetailRow
                label={t('Request ID')}
                value={props.entry.request_id}
                mono
              />
              <DetailRow label={t('Route')} value={props.entry.route} mono />
              <DetailRow label='IP' value={props.entry.ip} mono />
              <DetailRow
                label={t('Original length')}
                value={formatNumber(props.entry.content_chars, locale)}
              />
              <DetailRow
                label={t('Original content hash')}
                value={props.entry.input_hash ?? props.entry.content_hash}
                mono
              />
            </DetailSection>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <Tabs defaultValue='message'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='message'>{t('Request text preview')}</TabsTrigger>
          <TabsTrigger value='evidence'>{t('Evidence message')}</TabsTrigger>
          <TabsTrigger value='review'>{t('Review')}</TabsTrigger>
        </TabsList>
        <TabsContent value='message'>
          <DetailSection label={t('Request text preview')}>
            {props.entry.truncated && (
              <p role='status' className='text-muted-foreground text-xs'>
                {t(
                  'Long messages retain the beginning and end; the middle is omitted.'
                )}
              </p>
            )}
            <p className='max-h-80 overflow-y-auto [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
              {props.entry.content}
            </p>
            <CopyButton value={props.entry.content} size='sm'>
              {t('Copy')}
            </CopyButton>
          </DetailSection>
        </TabsContent>
        {open && user?.role === ROLE.SUPER_ADMIN && (
          <>
            <TabsContent value='evidence'>
              <DetailSection label={t('Evidence and review')}>
                {evidence.isPending && <LoadingState />}
                {evidence.isError && (
                  <ErrorState
                    onRetry={() => {
                      void evidence.refetch()
                    }}
                  />
                )}
                {evidence.data?.document && (
                  <InputAuditEvidenceView
                    document={evidence.data.document}
                    complete={evidence.data.complete}
                    onPromptHash={(hash) => {
                      setPromptHash(hash)
                      setRelatedPage(1)
                    }}
                  />
                )}
                {evidence.data && !evidence.data.available && (
                  <p>
                    {evidenceReasons[evidence.data.reason ?? ''] ??
                      t(
                        'Historical preview; original context was not retained'
                      )}
                  </p>
                )}
              </DetailSection>
            </TabsContent>
            <TabsContent value='review'>
              <InputAuditCasePanel auditID={props.entry.id} />
            </TabsContent>
          </>
        )}
      </Tabs>
      {open && user?.role === ROLE.SUPER_ADMIN && (
        <section
          aria-label={t('Related requests')}
          className='flex flex-col gap-2 border-t pt-3'
        >
          <h3 className='text-sm font-medium'>
            {promptHash
              ? t('Requests using this prompt')
              : t('Recent requests from this user')}
          </h3>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Related requests do not prove they belong to the same conversation.'
            )}
          </p>
          {promptHash && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                setPromptHash('')
                setRelatedPage(1)
              }}
            >
              {t('Recent requests from this user')}
            </Button>
          )}
          {related.isPending && <LoadingState />}
          {related.isError && (
            <ErrorState onRetry={() => void related.refetch()} />
          )}
          {related.data?.items
            .filter((entry) => entry.id !== props.entry.id)
            .map((entry) => (
              <div
                key={entry.id}
                className='flex items-center justify-between gap-2 text-xs'
              >
                <p className='min-w-0 truncate'>
                  #{entry.user_id} ·{' '}
                  {dayjs.unix(entry.created_at).format('MM-DD HH:mm:ss')} ·{' '}
                  {entry.content}
                </p>
                <InputAuditDetailsDialog entry={entry} />
              </div>
            ))}
          {related.data && <DataTablePagination table={relatedTable} compact />}
        </section>
      )}
    </AuditFeatureSurface>
  )
}
