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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
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
import { getInputAuditEvidence, type InputAudit } from './api'
import { InputAuditCasePanel } from './case-panel'
import { InputAuditEvidenceView } from './evidence-view'

export function InputAuditRequestContent(props: {
  entry: InputAudit
  active: boolean
  tab: string
  onTabChange: (tab: string) => void
  onPromptHash: (hash: string) => void
}) {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const evidence = useQuery({
    queryKey: ['input-audit-evidence', user?.id, props.entry.id],
    queryFn: () => getInputAuditEvidence(props.entry.id),
    enabled: props.active && user?.role === ROLE.SUPER_ADMIN,
    retry: false,
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
    <>
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
      <Tabs value={props.tab} onValueChange={props.onTabChange}>
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
        {user?.role === ROLE.SUPER_ADMIN && (
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
                    onPromptHash={props.onPromptHash}
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
    </>
  )
}
