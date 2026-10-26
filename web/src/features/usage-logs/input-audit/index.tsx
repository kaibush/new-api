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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
  getInputAuditStatus,
  type InputAudit,
  type InputAuditFilters,
} from './api'
import { useInputAuditColumns } from './columns'
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
  const columns = useInputAuditColumns()
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
    enableRowSelection: false,
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
      (start && end && start > end)
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
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={query.isPending && canRead}
      isFetching={query.isFetching}
      emptyTitle={
        query.isError ? t('Failed to load audit records') : t('No records')
      }
      paginationInFooter
      compactPagination={isMobile}
      toolbar={
        <div className='flex flex-col gap-2'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Short messages are stored in full. Long messages retain the beginning and end. Time is when the gateway received the first matching input.'
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
                  chars: formatNumber(status.data.settings.max_chars, locale),
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
              · {status.data.settings.enabled ? t('Enabled') : t('Disabled')}
            </p>
          )}
          <LogsFilterToolbar
            table={table}
            primaryFilters={
              <>
                <LogsFilterField>
                  <LogsFilterInput
                    aria-label={t('User ID')}
                    placeholder={t('User ID')}
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
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
            hasActiveFilters={!!userId || !!requestId || !!start || !!end}
            onSearch={search}
            searchLoading={query.isFetching}
            onReset={() => {
              setUserId('')
              setRequestId('')
              setStart(undefined)
              setEnd(undefined)
              setInvalid(false)
              setFilters({ p: 1, page_size: filters.page_size })
            }}
            actionStart={
              status.data && (
                <InputAuditSettingsDialog settings={status.data.settings} />
              )
            }
          />
          {invalid && (
            <Alert variant='destructive'>
              <AlertDescription>{t('Invalid audit filters')}</AlertDescription>
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
  )
}
