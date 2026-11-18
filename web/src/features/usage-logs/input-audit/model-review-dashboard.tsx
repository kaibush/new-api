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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UserIdentity } from '@/components/user-identity'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { useInputAuditCaseLabels } from './case-labels'
import {
  getModelReviewUsers,
  deleteModelReviewResults,
  type ModelReviewUser,
} from './model-review-api'

const EMPTY: ModelReviewUser[] = []

export function ModelReviewDashboard(props: {
  active?: boolean
  showHeading?: boolean
  jobID?: number
  userID?: number
  onSelectUser: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const operator = useAuthStore((state) => state.auth.user?.id)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const categories = useInputAuditCaseLabels().categories
  const onSelectUser = props.onSelectUser
  const client = useQueryClient()
  const [deletingUser, setDeletingUser] = useState<number>()
  const remove = useMutation({
    mutationFn: (id: number) =>
      deleteModelReviewResults({ all: true, user_id: id }),
    onSuccess: () => {
      setDeletingUser(undefined)
      void client.invalidateQueries({ queryKey: ['model-review-users'] })
      void client.invalidateQueries({ queryKey: ['model-review-results'] })
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
    },
  })
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    queryKey: [
      'model-review-users',
      operator,
      props.jobID,
      props.userID,
      pagination,
    ],
    queryFn: () =>
      getModelReviewUsers({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        job_id: props.jobID,
        user_id: props.userID,
      }),
    enabled: props.active !== false,
    refetchInterval: props.active !== false ? 10000 : false,
    retry: false,
  })
  const columns = useMemo<ColumnDef<ModelReviewUser>[]>(
    () => [
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => <UserIdentity userId={row.original.user_id} />,
        meta: { mobileTitle: true, label: t('User') },
      },
      {
        accessorKey: 'suspected',
        header: t('Suspected anomalies'),
        cell: ({ row }) => (
          <Badge variant={row.original.suspected ? 'destructive' : 'secondary'}>
            {formatNumber(row.original.suspected, locale)}
          </Badge>
        ),
        meta: { label: t('Suspected anomalies') },
      },
      {
        id: 'categories',
        header: t('Anomaly categories'),
        cell: ({ row }) => (
          <div className='flex flex-wrap gap-1'>
            <span className='text-muted-foreground text-xs'>
              {formatNumber(
                Object.keys(row.original.categories).length,
                locale
              )}
            </span>
            {Object.entries(row.original.categories)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, count]) => (
                <Badge key={category} variant='outline'>
                  {categories[category as keyof typeof categories] ?? category}{' '}
                  · {formatNumber(count, locale)}
                </Badge>
              ))}
          </div>
        ),
        meta: { label: t('Anomaly categories') },
      },
      {
        accessorKey: 'insufficient',
        header: t('Insufficient evidence'),
        cell: ({ row }) => formatNumber(row.original.insufficient, locale),
        meta: { label: t('Insufficient evidence') },
      },
      {
        accessorKey: 'failed',
        header: t('Failed'),
        cell: ({ row }) => formatNumber(row.original.failed, locale),
        meta: { label: t('Failed') },
      },
      {
        id: 'results',
        header: t('Results'),
        cell: ({ row }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={() => onSelectUser(row.original.user_id)}
          >
            {t('Results')}
          </Button>
        ),
        meta: { label: t('Results') },
      },
      {
        id: 'delete',
        header: t('Delete'),
        cell: ({ row }) => (
          <Button
            variant='destructive'
            size='sm'
            disabled={remove.isPending}
            onClick={() => setDeletingUser(row.original.user_id)}
          >
            {t('Clear user results')}
          </Button>
        ),
        meta: { label: t('Delete') },
      },
    ],
    [t, locale, categories, onSelectUser, remove.isPending]
  )
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY : (query.data?.items ?? EMPTY),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: false,
    getRowId: (row) => String(row.user_id),
  })
  return (
    <section aria-label={t('User review dashboard')} className='space-y-3'>
      {props.showHeading !== false && (
        <h3 className='font-medium'>{t('User review dashboard')}</h3>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Counts use the latest retained result for each message in the selected scope. Only results requiring human review count as suspected anomalies; they are not confirmed violations.'
        )}
      </p>
      <div className='grid grid-cols-3 gap-2'>
        {[
          { label: t('Reviewed messages'), value: query.data?.reviewed },
          { label: t('Suspected anomalies'), value: query.data?.suspected },
          {
            label: t('Users with suspected anomalies'),
            value: query.data?.affected_users,
          },
        ].map((item) => (
          <Card
            key={item.label}
            role='group'
            aria-label={item.label}
            className='gap-2 py-3'
          >
            <CardHeader className='px-3'>
              <CardTitle className='text-muted-foreground min-h-8 text-[11px] font-normal sm:min-h-0 sm:text-xs'>
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent className='px-3 text-lg font-semibold'>
              {query.isError || query.isPending
                ? '—'
                : formatNumber(item.value ?? 0, locale)}
            </CardContent>
          </Card>
        ))}
      </div>
      <DataTablePage
        fixedHeight={false}
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        paginationInFooter={false}
        className='h-auto'
        emptyTitle={
          query.isError ? t('Failed to load audit records') : t('No records')
        }
        toolbar={
          query.isError ? (
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={deletingUser !== undefined}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeletingUser(undefined)
        }}
        title={t('Clear user results')}
        desc={t(
          'Delete all retained review results for this user. This cannot be undone.'
        )}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deletingUser !== undefined) remove.mutate(deletingUser)
        }}
        confirmText={t('Delete')}
      />
    </section>
  )
}
