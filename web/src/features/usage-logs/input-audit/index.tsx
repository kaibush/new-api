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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTablePage,
  DataTableBulkActions,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserSelector } from '@/components/user-selector'
import { useMediaQuery } from '@/hooks'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { CompactDateTimeRangePicker } from '../components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '../components/logs-filter-toolbar'
import {
  getInputAudits,
  deleteInputAudits,
  getInputAuditStatus,
  type InputAudit,
  type InputAuditFilters,
  type InputAuditStatus,
} from './api'
import { useInputAuditColumns } from './columns'

const InputAuditAllowlistDialog = lazy(() =>
  import('./allowlist-dialog').then((feature) => ({
    default: feature.InputAuditAllowlistDialog,
  }))
)
const InputAuditCasesDialog = lazy(() =>
  import('./cases-dialog').then((feature) => ({
    default: feature.InputAuditCasesDialog,
  }))
)
const MatchesDialog = lazy(() =>
  import('./matches-dialog').then((feature) => ({
    default: feature.MatchesDialog,
  }))
)
const ModelReviewDialog = lazy(() =>
  import('./model-review-dialog').then((feature) => ({
    default: feature.ModelReviewDialog,
  }))
)
const InputAuditSettingsDialog = lazy(() =>
  import('./settings-dialog').then((feature) => ({
    default: feature.InputAuditSettingsDialog,
  }))
)

const EMPTY_ROWS: InputAudit[] = []

function InputAuditMessages(props: { active?: boolean }) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<InputAuditFilters>({
    p: 1,
    page_size: 20,
  })
  const [userId, setUserId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [start, setStart] = useState<Date>()
  const [end, setEnd] = useState<Date>()
  const [invalid, setInvalid] = useState(false)
  const canRead = user?.role === ROLE.SUPER_ADMIN
  const query = useQuery({
    queryKey: ['input-audits', user?.id, filters],
    queryFn: () => getInputAudits(filters),
    enabled: canRead && props.active !== false,
    retry: false,
  })
  const status = useQuery({
    queryKey: ['input-audit-status', user?.id],
    queryFn: getInputAuditStatus,
    enabled: canRead && props.active !== false,
    retry: false,
  })
  const [deletion, setDeletion] = useState<
    { ids?: number[]; all?: boolean } & Partial<InputAuditFilters>
  >()
  const remove = useMutation({
    mutationFn: deleteInputAudits,
    onSuccess: () => {
      setDeletion(undefined)
      table.resetRowSelection()
      setFilters((previous) => ({ ...previous, p: 1 }))
      void queryClient.invalidateQueries({ queryKey: ['input-audits'] })
      void queryClient.invalidateQueries({ queryKey: ['input-audit-matches'] })
      void queryClient.invalidateQueries({ queryKey: ['model-review-results'] })
      void queryClient.invalidateQueries({ queryKey: ['model-review-users'] })
      void queryClient.invalidateQueries({ queryKey: ['model-review-summary'] })
    },
  })
  const onDelete = useCallback((id: number) => setDeletion({ ids: [id] }), [])
  const columns = useInputAuditColumns(canRead ? onDelete : undefined)
  const { table } = useDataTable({
    columns,
    data:
      canRead && !query.isError
        ? (query.data?.items ?? EMPTY_ROWS)
        : EMPTY_ROWS,
    getRowId: (entry) => String(entry.id),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination: { pageIndex: filters.p - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) => {
      if (query.isFetching || query.isError) return
      setFilters((previous) => {
        const current = {
          pageIndex: previous.p - 1,
          pageSize: previous.page_size,
        }
        const next = typeof updater === 'function' ? updater(current) : updater
        return {
          ...previous,
          p: next.pageSize === previous.page_size ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      })
    },
    enableRowSelection: canRead,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })
  const search = () => {
    if (
      (userId !== '' &&
        (!/^\d+$/.test(userId) ||
          !Number.isSafeInteger(Number(userId)) ||
          Number(userId) < 1)) ||
      (start && end && start > end) ||
      [...keyword].length > 256 ||
      keyword.includes('\u0000')
    ) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const nextFilters: InputAuditFilters = {
      p: 1,
      page_size: filters.page_size,
      user_id: userId ? Number(userId) : undefined,
      request_id: requestId || undefined,
      keyword: keyword.trim() || undefined,
      start_timestamp: start ? Math.floor(start.getTime() / 1000) : undefined,
      end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
    }
    setFilters(nextFilters)
    void queryClient.invalidateQueries({
      queryKey: ['input-audits', user?.id, nextFilters],
      exact: true,
    })
    void status.refetch()
  }
  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending && canRead}
        isFetching={query.isFetching}
        emptyTitle={
          query.isError ? t('Failed to load audit records') : t('No records')
        }
        paginationInFooter
        showMobileBulkActions
        mobileProps={{ enableRowSelection: canRead }}
        bulkActions={
          canRead && (
            <DataTableBulkActions table={table} entityName={t('User message')}>
              <Button
                variant='destructive'
                disabled={
                  remove.isPending ||
                  table.getFilteredSelectedRowModel().rows.length > 100
                }
                onClick={() =>
                  setDeletion({
                    ids: table
                      .getFilteredSelectedRowModel()
                      .rows.map((row) => row.original.id),
                  })
                }
              >
                {t('Delete selected')}
              </Button>
            </DataTableBulkActions>
          )
        }
        compactPagination={isMobile}
        toolbar={
          <div className='flex flex-col gap-2'>
            <LogsFilterToolbar
              table={table}
              actionStart={
                canRead && (
                  <Button
                    variant='destructive'
                    disabled={
                      !query.data?.total || query.isFetching || remove.isPending
                    }
                    onClick={() => setDeletion({ ...filters, all: true })}
                  >
                    {t('Clear filtered messages')}
                  </Button>
                )
              }
              filterGridClassName='sm:grid-cols-2 xl:grid-cols-6'
              className='[&_[data-slot=input]]:h-9 [&_button]:h-9 [&_button]:rounded-md'
              primaryFilters={
                <>
                  <LogsFilterField wide>
                    <LogsFilterInput
                      aria-label={t('Message keyword')}
                      placeholder={t('Message keyword')}
                      maxLength={256}
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' &&
                          !event.nativeEvent.isComposing &&
                          !query.isFetching
                        ) {
                          search()
                        }
                      }}
                    />
                  </LogsFilterField>
                  <LogsFilterField>
                    <UserSelector
                      value={userId ? Number(userId) : undefined}
                      onChange={(id) => setUserId(id ? String(id) : '')}
                    />
                  </LogsFilterField>
                  <LogsFilterField>
                    <LogsFilterInput
                      aria-label={t('Request ID')}
                      placeholder={t('Request ID')}
                      maxLength={64}
                      value={requestId}
                      onChange={(event) => setRequestId(event.target.value)}
                    />
                  </LogsFilterField>
                  <LogsFilterField wide>
                    <CompactDateTimeRangePicker
                      start={start}
                      end={end}
                      onChange={(range) => {
                        setStart(range.start)
                        setEnd(range.end)
                      }}
                    />
                  </LogsFilterField>
                </>
              }
              hasActiveFilters={
                !!keyword || !!userId || !!requestId || !!start || !!end
              }
              onSearch={search}
              searchLoading={query.isFetching}
              onReset={() => {
                setUserId('')
                setRequestId('')
                setKeyword('')
                setStart(undefined)
                setEnd(undefined)
                setInvalid(false)
                setFilters({ p: 1, page_size: filters.page_size })
              }}
            />
            {invalid && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t('Invalid audit filters')}
                </AlertDescription>
              </Alert>
            )}
            {(query.isError || status.isError) && (
              <Alert variant='destructive'>
                <AlertDescription className='flex items-center justify-between gap-2'>
                  {t('Failed to load audit records')}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      void query.refetch()
                      void status.refetch()
                    }}
                  >
                    {t('Retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeletion(undefined)
        }}
        title={t('Delete submitted messages')}
        desc={t(
          'Delete the selected submitted messages and their live evidence and model review results. Retained human review cases are preserved. Pause or stop active review tasks first. This cannot be undone.'
        )}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deletion) remove.mutate(deletion)
        }}
        confirmText={t('Delete')}
      />
    </>
  )
}

function InputAuditCollectionStatus(props: { status: InputAuditStatus }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <Accordion>
      <AccordionItem value='collection'>
        <AccordionTrigger className='py-2'>{t('Details')}</AccordionTrigger>
        <AccordionContent className='space-y-2'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Short messages are stored in full. Long messages retain the beginning and end. Time is when the gateway received the first matching input.'
            )}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Keyword search matches stored message text. Omitted text cannot be searched.'
            )}
          </p>
          {props.status && (
            <p role='status' className='text-muted-foreground text-xs'>
              {t(
                'Retention: {{days}} days · {{records}} records · {{chars}} characters · text up to {{size}} MiB · dropped on this instance: {{dropped}}',
                {
                  days: formatNumber(
                    props.status.settings.retention_days,
                    locale
                  ),
                  records: formatNumber(
                    props.status.settings.max_records,
                    locale
                  ),
                  chars: formatNumber(props.status.settings.max_chars, locale),
                  size: formatNumber(
                    Math.ceil(
                      (props.status.settings.max_records *
                        props.status.settings.max_chars *
                        4) /
                        1024 /
                        1024
                    ),
                    locale
                  ),
                  dropped: formatNumber(props.status.dropped, locale),
                }
              )}{' '}
              · {props.status.settings.enabled ? t('Enabled') : t('Disabled')}
            </p>
          )}
          {props.status && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Evidence on this instance: {{pending}} queued · {{dropped}} dropped · {{failures}} write failures',
                {
                  pending: formatNumber(
                    props.status.evidence_pending ?? 0,
                    locale
                  ),
                  dropped: formatNumber(
                    props.status.evidence_dropped ?? 0,
                    locale
                  ),
                  failures: formatNumber(
                    props.status.evidence_write_failures ?? 0,
                    locale
                  ),
                }
              )}
            </p>
          )}
          {props.status && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Match evidence: {{pending}} queued · {{dropped}} dropped · {{failures}} write failures',
                {
                  pending: formatNumber(
                    props.status.match_pending ?? 0,
                    locale
                  ),
                  dropped: formatNumber(
                    props.status.match_dropped ?? 0,
                    locale
                  ),
                  failures: formatNumber(
                    props.status.match_write_failures ?? 0,
                    locale
                  ),
                }
              )}
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export function InputAuditViewer() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const [tab, setTab] = useState('messages')
  const [visited, setVisited] = useState(['messages'])
  const canRead = user?.role === ROLE.SUPER_ADMIN
  const status = useQuery({
    queryKey: ['input-audit-status', user?.id],
    queryFn: getInputAuditStatus,
    enabled: canRead,
    retry: false,
  })
  if (!canRead) return <InputAuditMessages />
  const items = [
    { value: 'messages', label: t('User message') },
    { value: 'matches', label: t('Interception evidence') },
    { value: 'cases', label: t('Review cases') },
    { value: 'model', label: t('Model review') },
    { value: 'allowlist', label: t('User allowlist') },
    { value: 'settings', label: t('Settings') },
  ]
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(String(value))
        setVisited((previous) =>
          previous.includes(String(value))
            ? previous
            : [...previous, String(value)]
        )
      }}
      className='h-full min-h-0 min-w-0 gap-3'
    >
      <TabsList
        aria-label={t('Audit management')}
        variant='line'
        className='w-full shrink-0 justify-start overflow-x-auto border-b group-data-horizontal/tabs:h-11 [&>button]:h-10 [&>button]:min-w-28 [&>button]:shrink-0 [&>button]:px-3'
      >
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          keepMounted
          className='min-h-0 min-w-0 overflow-y-auto overscroll-contain data-[hidden]:hidden'
        >
          {visited.includes(item.value) && (
            <Suspense fallback={<LoadingState />}>
              {item.value === 'messages' && (
                <InputAuditMessages active={tab === 'messages'} />
              )}
              {item.value === 'matches' && (
                <MatchesDialog embedded active={tab === 'matches'} />
              )}
              {item.value === 'cases' && (
                <InputAuditCasesDialog embedded active={tab === 'cases'} />
              )}
              {item.value === 'model' && (
                <ModelReviewDialog embedded active={tab === 'model'} />
              )}
              {(item.value === 'allowlist' || item.value === 'settings') &&
                status.isPending && <LoadingState />}
              {(item.value === 'allowlist' || item.value === 'settings') &&
                status.isError && (
                  <ErrorState onRetry={() => void status.refetch()} />
                )}
              {item.value === 'allowlist' && status.data && (
                <InputAuditAllowlistDialog
                  embedded
                  active={tab === 'allowlist'}
                  collectionEnabled={status.data.settings.enabled}
                />
              )}
              {item.value === 'settings' && status.data && (
                <>
                  <InputAuditCollectionStatus status={status.data} />
                  <InputAuditSettingsDialog
                    embedded
                    settings={status.data.settings}
                  />
                </>
              )}
            </Suspense>
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
