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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTablePage,
  DataTableBulkActions,
  useDataTable,
} from '@/components/data-table'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { InputAuditAllowlistDialog } from './allowlist-dialog'
import {
  getInputAudits,
  deleteInputAudits,
  getInputAuditStatus,
  type InputAudit,
  type InputAuditFilters,
} from './api'
import { InputAuditCasesDialog } from './cases-dialog'
import { useInputAuditColumns } from './columns'
import { MatchesDialog } from './matches-dialog'
import { ModelReviewDialog } from './model-review-dialog'
import { InputAuditSettingsDialog } from './settings-dialog'

const EMPTY_ROWS: InputAudit[] = []

export function InputAuditViewer() {
  const { t, i18n } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
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
    enabled: canRead,
    retry: false,
  })
  const status = useQuery({
    queryKey: ['input-audit-status', user?.id],
    queryFn: getInputAuditStatus,
    enabled: canRead,
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
  const columns = useInputAuditColumns(
    canRead ? (id) => setDeletion({ ids: [id] }) : undefined
  )
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
            <Accordion>
              <AccordionItem value='collection'>
                <AccordionTrigger className='py-2'>
                  {t('Input audit settings')}
                </AccordionTrigger>
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
                  {status.data && (
                    <p role='status' className='text-muted-foreground text-xs'>
                      {t(
                        'Retention: {{days}} days · {{records}} records · {{chars}} characters · text up to {{size}} MiB · dropped on this instance: {{dropped}}',
                        {
                          days: formatNumber(
                            status.data.settings.retention_days,
                            locale
                          ),
                          records: formatNumber(
                            status.data.settings.max_records,
                            locale
                          ),
                          chars: formatNumber(
                            status.data.settings.max_chars,
                            locale
                          ),
                          size: formatNumber(
                            Math.ceil(
                              (status.data.settings.max_records *
                                status.data.settings.max_chars *
                                4) /
                                1024 /
                                1024
                            ),
                            locale
                          ),
                          dropped: formatNumber(status.data.dropped, locale),
                        }
                      )}{' '}
                      ·{' '}
                      {status.data.settings.enabled
                        ? t('Enabled')
                        : t('Disabled')}
                    </p>
                  )}
                  {status.data && (
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Evidence on this instance: {{pending}} queued · {{dropped}} dropped · {{failures}} write failures',
                        {
                          pending: formatNumber(
                            status.data.evidence_pending ?? 0,
                            locale
                          ),
                          dropped: formatNumber(
                            status.data.evidence_dropped ?? 0,
                            locale
                          ),
                          failures: formatNumber(
                            status.data.evidence_write_failures ?? 0,
                            locale
                          ),
                        }
                      )}
                    </p>
                  )}
                  {status.data && (
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Match evidence: {{pending}} queued · {{dropped}} dropped · {{failures}} write failures',
                        {
                          pending: formatNumber(
                            status.data.match_pending ?? 0,
                            locale
                          ),
                          dropped: formatNumber(
                            status.data.match_dropped ?? 0,
                            locale
                          ),
                          failures: formatNumber(
                            status.data.match_write_failures ?? 0,
                            locale
                          ),
                        }
                      )}
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
              stats={
                status.data && (
                  <nav
                    aria-label={t('Audit management')}
                    className='grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap [&>button]:h-9 [&>button]:w-full [&>button]:min-w-0 [&>button]:rounded-md [&>button]:px-3 [&>button]:text-sm [&>button]:whitespace-normal sm:[&>button]:w-32'
                  >
                    <MatchesDialog />
                    {canRead && <InputAuditCasesDialog />}
                    <ModelReviewDialog />
                    {canRead && (
                      <InputAuditAllowlistDialog
                        collectionEnabled={status.data.settings.enabled}
                      />
                    )}
                    <InputAuditSettingsDialog settings={status.data.settings} />
                  </nav>
                )
              }
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
