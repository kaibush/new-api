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
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { listCheckinUsers } from '../api'
import { formatCheckinPercent } from '../format'
import type { CheckinSettings, CheckinUser, CheckinUserQuery } from '../types'
import { CheckinUserDetailDialog } from './user-detail'

const EMPTY_USERS: CheckinUser[] = []

export function CheckinActivityPanel(props: {
  preview?: CheckinSettings
  previewInvalid?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [filters, setFilters] = useState<CheckinUserQuery>({
    page: 1,
    page_size: 10,
    search: '',
    filter: '',
    sort: '',
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Primitive JSON input prevents a fresh watched form object from restarting
  // the debounce on every render. Cancellation keeps obsolete previews out.
  const serialized = JSON.stringify({
    ...filters,
    preview: props.preview,
    filter: props.preview ? '' : filters.filter,
    sort: props.preview ? '' : filters.sort,
  })
  const debounced = useDebounce(serialized, 350)
  const query = useQuery({
    queryKey: ['checkin-admin', 'users', debounced],
    queryFn: ({ signal }) =>
      listCheckinUsers(JSON.parse(debounced) as CheckinUserQuery, signal),
    enabled: !props.previewInvalid,
    refetchInterval: (query) => (query.state.data?.updating ? 2000 : 30000),
  })
  const mode =
    props.preview?.mode ??
    query.data?.mode ??
    query.data?.items[0]?.eligibility.mode ??
    1
  const columns = useMemo<ColumnDef<CheckinUser>[]>(
    () => [
      {
        id: 'method',
        header: t('Check-in method'),
        cell: ({ row }) =>
          row.original.eligibility.mode === 2
            ? t('Method 2: Expiring rewards')
            : t('Method 1: Activity rewards'),
      },
      {
        id: 'user',
        header: t('User'),
        cell: ({ row }) => (
          <Button
            variant='link'
            className='h-auto max-w-48 p-0 text-left whitespace-normal'
            onClick={() => setSelectedId(row.original.id)}
          >
            {row.original.display_name ||
              row.original.username ||
              `#${row.original.id}`}
          </Button>
        ),
      },
      {
        id: 'wallet_quota',
        header: t('Recharged quota'),
        cell: ({ row }) =>
          row.original.balance
            ? formatQuotaWithCurrency(row.original.balance.wallet_quota)
            : '—',
      },
      {
        id: 'checkin_quota',
        header: t('Check-in quota'),
        cell: ({ row }) =>
          row.original.balance
            ? formatQuotaWithCurrency(row.original.balance.checkin_quota)
            : '—',
      },
      {
        id: 'expired_quota',
        header: t('Expired check-in quota'),
        cell: ({ row }) =>
          row.original.balance
            ? formatQuotaWithCurrency(row.original.balance.expired_quota)
            : '—',
      },
      {
        id: 'next_expiry',
        header: t('Next reward expiry'),
        cell: ({ row }) => {
          const balance = row.original.balance
          if (!balance) return '—'
          return balance.next_expiry_at > 0
            ? dayjs.unix(balance.next_expiry_at).format('YYYY-MM-DD HH:mm:ss')
            : t('None')
        },
      },
      {
        id: 'grace',
        header: t('New user grace period (days)'),
        cell: ({ row }) => {
          const e = row.original.eligibility
          return e.mode !== 2 && e.grace_remaining_days > 0
            ? `${formatNumber(e.grace_day, locale)} / ${formatNumber(e.new_user_days, locale)} · ${t('Remaining')}: ${formatNumber(e.grace_remaining_days, locale)}`
            : '—'
        },
      },
      {
        id: 'spending',
        header: t('Spending / threshold'),
        cell: ({ row }) =>
          row.original.eligibility.mode === 2
            ? '—'
            : `${formatQuotaWithCurrency(row.original.eligibility.recent_spend)} / ${formatQuotaWithCurrency(row.original.eligibility.minimum_spend)}`,
      },
      {
        id: 'activity',
        header: t('Spending achievement'),
        cell: ({ row }) => {
          if (row.original.eligibility.mode === 2) return '—'
          if (!row.original.eligibility.history_complete) {
            return t('Incomplete history')
          }
          return formatCheckinPercent(
            row.original.eligibility.activity_percent,
            locale
          )
        },
      },
      {
        id: 'percentage',
        header: t('Reward percentage'),
        cell: ({ row }) =>
          formatCheckinPercent(row.original.eligibility.reward_percent, locale),
      },
      {
        id: 'month',
        header: t('Monthly rewards / cap'),
        cell: ({ row }) =>
          `${formatQuotaWithCurrency(row.original.eligibility.monthly_awarded)} / ${row.original.eligibility.limited ? formatQuotaWithCurrency(row.original.eligibility.monthly_cap) : '—'}`,
      },
      {
        id: 'reward',
        header: t('Available reward'),
        cell: ({ row }) =>
          `${formatQuotaWithCurrency(row.original.eligibility.min_quota)} – ${formatQuotaWithCurrency(row.original.eligibility.max_quota)}`,
      },
      {
        id: 'reason',
        header: t('Status'),
        cell: ({ row }) => {
          const e = row.original.eligibility
          if (e.mode === 2) {
            return e.allowed
              ? t('Method 2: Expiring rewards')
              : t('Check-in is disabled.')
          }
          if (e.pending_count > 0) return t('Settlement pending')
          if (e.reasons.includes('monthly_cap')) return t('Monthly cap')
          if (!e.history_complete) return t('Incomplete history')
          if (e.reasons.includes('reward_floor')) return t('Reward floor')
          if (e.reasons.includes('low_activity')) return t('Low activity')
          return e.allowed ? t('Available') : t('Unavailable')
        },
      },
    ],
    [locale, t]
  )
  const previewPending = serialized !== debounced || !!props.previewInvalid
  const visibleColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          mode !== 2 ||
          !['grace', 'spending', 'activity', 'percentage', 'month'].includes(
            column.id ?? ''
          )
      ),
    [columns, mode]
  )
  const { table } = useDataTable({
    columns: visibleColumns,
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
  const update = (patch: Partial<CheckinUserQuery>) =>
    setFilters((previous) => ({ ...previous, ...patch, page: 1 }))
  const pagePending = query.isPending || query.data?.as_of === 0
  const activityDays =
    props.preview?.limits.activity_days ??
    query.data?.items[0]?.eligibility.activity_days
  return (
    <section className='space-y-5' aria-label={t('Check-in activity')}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-medium'>{t('Check-in and balances')}</h3>
        <Button
          variant='outline'
          size='sm'
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('Refresh')}
        </Button>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-full sm:w-60'
          aria-label={t('Search users')}
          placeholder={t('Search users')}
          value={filters.search}
          onChange={(event) => update({ search: event.target.value })}
        />
        {mode !== 2 && (
          <>
            <Select
              value={props.preview ? 'all' : filters.filter || 'all'}
              items={[
                { value: 'all', label: t('All users') },
                { value: 'grace', label: t('In grace period') },
                { value: 'active', label: t('Full activity') },
                { value: 'low_activity', label: t('Low activity') },
                { value: 'zero_activity', label: t('Zero activity') },
                { value: 'incomplete', label: t('Incomplete history') },
                { value: 'pending', label: t('Settlement pending') },
              ]}
              disabled={!!props.preview}
              onValueChange={(value) =>
                update({ filter: value === 'all' ? '' : (value ?? '') })
              }
            >
              <SelectTrigger className='w-44' aria-label={t('Activity filter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ['all', t('All users')],
                  ['grace', t('In grace period')],
                  ['active', t('Full activity')],
                  ['low_activity', t('Low activity')],
                  ['zero_activity', t('Zero activity')],
                  ['incomplete', t('Incomplete history')],
                  ['pending', t('Settlement pending')],
                ].map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={props.preview ? 'id' : filters.sort || 'id'}
              items={[
                { value: 'id', label: t('Newest users first') },
                { value: 'activity_asc', label: t('Activity: low to high') },
                { value: 'activity_desc', label: t('Activity: high to low') },
              ]}
              disabled={!!props.preview}
              onValueChange={(value) =>
                update({ sort: value === 'id' ? '' : (value ?? '') })
              }
            >
              <SelectTrigger
                className='w-48'
                aria-label={t('Activity sorting')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='id'>{t('Newest users first')}</SelectItem>
                <SelectItem value='activity_asc'>
                  {t('Activity: low to high')}
                </SelectItem>
                <SelectItem value='activity_desc'>
                  {t('Activity: high to low')}
                </SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      {props.preview && (
        <p role='status' className='text-sm'>
          {t('Unsaved preview for this page. Rewards are not issued.')}
        </p>
      )}
      {previewPending && (
        <p role='status'>
          {props.previewInvalid
            ? t('Correct the settings to preview rewards.')
            : t('Updating preview...')}
        </p>
      )}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data?.updating && (
        <p role='status'>{t('Updating activity statistics...')}</p>
      )}
      {query.data && query.data.as_of > 0 && (
        <p className='text-muted-foreground text-xs'>
          {mode !== 2 && activityDays !== undefined && (
            <>
              {t('Activity window')}: {formatNumber(activityDays, locale)}{' '}
              {t('days')} ·{' '}
            </>
          )}
          {t('Updated at {{date}}', {
            date: dayjs.unix(query.data.as_of).format('YYYY-MM-DD HH:mm:ss'),
          })}
        </p>
      )}
      <DataTablePage
        table={table}
        columns={visibleColumns}
        isLoading={pagePending}
        isFetching={query.isFetching || previewPending}
        paginationInFooter={false}
        toolbarProps={null}
        className='h-auto'
        emptyTitle={t('No records')}
      />
      {selectedId !== null && (
        <CheckinUserDetailDialog
          key={selectedId}
          userId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}
