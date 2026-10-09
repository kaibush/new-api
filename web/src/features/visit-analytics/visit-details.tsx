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
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  DataTableView,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { toIntlLocale } from '@/i18n/languages'

import { getVisitDetails, type VisitDetail, type VisitFilters } from './api'

export function VisitDetails(props: { filters: VisitFilters }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  })
  const query = useQuery({
    queryKey: ['site-visits', 'details', props.filters, pagination.pageIndex],
    queryFn: () => getVisitDetails(props.filters, pagination.pageIndex + 1),
  })
  const columns: ColumnDef<VisitDetail>[] = [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) =>
        new Date(row.original.created_at * 1000).toLocaleString(locale),
    },
    {
      accessorKey: 'username',
      header: t('User'),
      cell: ({ row }) =>
        row.original.user_id
          ? `${row.original.username} (#${row.original.user_id})`
          : t('Anonymous visitor'),
    },
    { accessorKey: 'page', header: t('Page') },
    { accessorKey: 'ip', header: t('IP Address') },
    {
      accessorKey: 'referrer',
      header: t('Referrer'),
      cell: ({ row }) => row.original.referrer || t('Direct visit'),
    },
    { accessorKey: 'browser', header: t('Browser') },
    { accessorKey: 'os', header: t('Operating system') },
    {
      accessorKey: 'device',
      header: t('Device'),
      cell: ({ row }) => t(row.original.device),
    },
    { accessorKey: 'language', header: t('Language') },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
  })
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-4'>
      <DataTableView table={table} isLoading={query.isPending} />
      <DataTablePagination table={table} compact />
    </div>
  )
}
