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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CheckinUserDetailDialog } from '@/features/checkin/components/user-detail'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { listUserActivity, type ActivityQuery, type ActivityUser } from '../api'
import { ActivityPeriodNote } from './period-note'

const EMPTY_USERS: ActivityUser[] = []
export function UserActivityUsersPanel(props: { days: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [filters, setFilters] = useState({
    page: 1,
    page_size: 10,
    search: '',
    filter: '',
    sort: 'spend_desc',
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const debounced = useDebounce(
    JSON.stringify({ ...filters, days: props.days }),
    350
  )
  const query = useQuery({
    queryKey: ['user-activity', 'users', debounced],
    queryFn: ({ signal }) =>
      listUserActivity(JSON.parse(debounced) as ActivityQuery, signal),
    refetchInterval: 30000,
  })
  const columns = useMemo<ColumnDef<ActivityUser>[]>(
    () => [
      {
        id: 'user',
        header: t('User'),
        cell: ({ row }) => (
          <Button
            variant='link'
            className='h-auto p-0'
            onClick={() => setSelectedId(row.original.id)}
          >
            {row.original.display_name || row.original.username}
          </Button>
        ),
      },
      {
        id: 'spending',
        header: t('Settled spending'),
        cell: ({ row }) => formatQuotaWithCurrency(row.original.consumed_quota),
      },
      {
        id: 'records',
        header: t('Charged records'),
        cell: ({ row }) => formatNumber(row.original.charged_records, locale),
      },
      {
        id: 'days',
        header: t('Days with spending'),
        cell: ({ row }) => formatNumber(row.original.active_days, locale),
      },
      {
        id: 'last',
        header: t('Last recorded spending'),
        cell: ({ row }) =>
          row.original.last_used_at > 0
            ? dayjs
                .unix(row.original.last_used_at)
                .format('YYYY-MM-DD HH:mm:ss')
            : t('None'),
      },
      {
        id: 'coverage',
        header: t('History'),
        cell: ({ row }) =>
          row.original.history_complete
            ? t('Complete')
            : t('Incomplete history'),
      },
    ],
    [t, locale]
  )
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY_USERS : (query.data?.items ?? EMPTY_USERS),
    totalCount: query.data?.total ?? 0,
    getRowId: (row) => String(row.id),
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
    pagination: { pageIndex: filters.page - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) =>
      setFilters((previous) => {
        const current = {
          pageIndex: previous.page - 1,
          pageSize: previous.page_size,
        }
        const next = typeof updater === 'function' ? updater(current) : updater
        return {
          ...previous,
          page: next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      }),
  })
  return (
    <section className='space-y-4' aria-label={t('User usage')}>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-full sm:w-60'
          aria-label={t('Search users')}
          placeholder={t('Search users')}
          value={filters.search}
          onChange={(event) =>
            setFilters((previous) => ({
              ...previous,
              search: event.target.value,
              page: 1,
            }))
          }
        />
        <Select
          value={filters.filter || 'all'}
          items={[
            { value: 'all', label: t('All users') },
            { value: 'used', label: t('Users with spending') },
            { value: 'unused', label: t('No recorded spending') },
            { value: 'incomplete', label: t('Incomplete history') },
          ]}
          onValueChange={(value) =>
            setFilters((previous) => ({
              ...previous,
              filter: value === 'all' ? '' : String(value),
              page: 1,
            }))
          }
        >
          <SelectTrigger className='w-48' aria-label={t('Usage status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('All users')}</SelectItem>
            <SelectItem value='used'>{t('Users with spending')}</SelectItem>
            <SelectItem value='unused'>{t('No recorded spending')}</SelectItem>
            <SelectItem value='incomplete'>
              {t('Incomplete history')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.sort}
          items={[
            { value: 'spend_desc', label: t('Spending: high to low') },
            { value: 'last_used_desc', label: t('Most recent spending') },
            { value: 'id_desc', label: t('Newest users first') },
          ]}
          onValueChange={(value) =>
            setFilters((previous) => ({
              ...previous,
              sort: String(value),
              page: 1,
            }))
          }
        >
          <SelectTrigger className='w-48' aria-label={t('Usage sorting')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='spend_desc'>
              {t('Spending: high to low')}
            </SelectItem>
            <SelectItem value='last_used_desc'>
              {t('Most recent spending')}
            </SelectItem>
            <SelectItem value='id_desc'>{t('Newest users first')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant='outline'
          size='sm'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      {query.data && !query.isError && (
        <ActivityPeriodNote period={query.data} />
      )}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        paginationInFooter={false}
        toolbarProps={null}
        className='h-auto'
        emptyTitle={t('No records')}
      />
      {selectedId !== null && (
        <CheckinUserDetailDialog
          key={selectedId}
          userId={selectedId}
          initialTab='usage'
          days={props.days}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}
