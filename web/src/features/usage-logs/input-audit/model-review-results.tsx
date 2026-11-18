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
import {
  DataTablePage,
  DataTableBulkActions,
  useDataTable,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { useInputAuditCaseLabels, useModelReviewLabels } from './case-labels'
import { InputAuditCasePanel } from './case-panel'
import { AuditFeatureSurface } from './feature-surface'
import {
  getModelReviewResults,
  deleteModelReviewResults,
  type ModelReviewFilters,
  type ModelReviewResult,
} from './model-review-api'

const EMPTY: ModelReviewResult[] = []

export function ModelReviewResults(props: {
  active?: boolean
  jobID?: number
  userID?: number
  status?: string
}) {
  const { t, i18n } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const labels = useModelReviewLabels()
  const categories = useInputAuditCaseLabels().categories
  const [filters, setFilters] = useState<ModelReviewFilters>({
    p: 1,
    page_size: 20,
    status: props.status ?? '',
    user_id: props.userID,
    job_id: props.jobID,
  })

  const client = useQueryClient()
  const [deletion, setDeletion] = useState<{
    ids?: number[]
    all?: boolean
    job_id?: number
    user_id?: number
    status?: string
  }>()
  const remove = useMutation({
    mutationFn: deleteModelReviewResults,
    onSuccess: () => {
      setDeletion(undefined)
      setSelected(undefined)
      table.resetRowSelection()
      setFilters((previous) => ({ ...previous, p: 1 }))
      void client.invalidateQueries({ queryKey: ['model-review-results'] })
      void client.invalidateQueries({ queryKey: ['model-review-users'] })
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
    },
  })
  const [selected, setSelected] = useState<ModelReviewResult>()
  const query = useQuery({
    queryKey: ['model-review-results', userID, filters],
    queryFn: () => getModelReviewResults(filters),
    enabled: props.active !== false,
    refetchInterval: props.active !== false ? 10000 : false,
    retry: false,
  })
  const columns = useMemo<ColumnDef<ModelReviewResult>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={
              table.getIsSomePageRowsSelected() &&
              !table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(Boolean(value))
            }
            aria-label={t('Select all')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label={t('Select row')}
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => <UserIdentity userId={row.original.user_id} />,
        meta: { mobileTitle: true, label: t('User') },
      },
      {
        accessorKey: 'status',
        header: t('Review result'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'review' ? 'destructive' : 'secondary'
            }
          >
            {labels[row.original.status]}
          </Badge>
        ),
        meta: { label: t('Review result') },
      },
      {
        accessorKey: 'category',
        header: t('Category'),
        cell: ({ row }) =>
          categories[row.original.category as keyof typeof categories] ??
          row.original.category,
        meta: { label: t('Category') },
      },
      {
        accessorKey: 'confidence',
        header: t('Confidence'),
        cell: ({ row }) =>
          row.original.status === 'failed'
            ? '—'
            : `${formatNumber(row.original.confidence, locale)}%`,
        meta: { label: t('Confidence') },
      },
      {
        accessorKey: 'created_at',
        header: t('Created at'),
        cell: ({ row }) =>
          dayjs.unix(row.original.created_at).format('MM-DD HH:mm'),
        meta: { label: t('Created at') },
      },
      {
        id: 'details',
        header: t('Details'),
        cell: ({ row }) => (
          <Button
            size='sm'
            variant='outline'
            onClick={() => setSelected(row.original)}
          >
            {t('Details')}
          </Button>
        ),
        meta: { label: t('Details') },
      },
      {
        id: 'delete',
        header: t('Delete'),
        cell: ({ row }) => (
          <Button
            variant='destructive'
            size='sm'
            disabled={remove.isPending}
            onClick={() => setDeletion({ ids: [row.original.id] })}
          >
            {t('Delete')}
          </Button>
        ),
        meta: { label: t('Delete') },
      },
    ],
    [t, labels, categories, locale, remove.isPending]
  )
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY : (query.data?.items ?? EMPTY),
    totalCount: query.data?.total ?? 0,
    pagination: { pageIndex: filters.p - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) =>
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
      }),
    getRowId: (row) => String(row.id),
    manualPagination: true,
    enableSorting: false,
    enableRowSelection: true,
  })
  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        paginationInFooter={false}
        showMobileBulkActions
        mobileProps={{ enableRowSelection: true }}
        bulkActions={
          <DataTableBulkActions table={table} entityName={t('Review result')}>
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
        }
        emptyTitle={
          query.isError ? t('Failed to load audit records') : t('No records')
        }
        toolbar={
          <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]'>
            <UserSelector
              value={filters.user_id}
              onChange={(id) => setFilters({ ...filters, p: 1, user_id: id })}
            />
            <NativeSelect
              aria-label={t('Review result')}
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, p: 1, status: event.target.value })
              }
            >
              <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
              {['review', 'insufficient_evidence', 'failed', 'safe'].map(
                (value) => (
                  <NativeSelectOption key={value} value={value}>
                    {labels[value]}
                  </NativeSelectOption>
                )
              )}
            </NativeSelect>
            <Button
              variant='outline'
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t('Refresh')}
            </Button>
            <Button
              variant='destructive'
              disabled={
                query.isFetching || remove.isPending || !query.data?.total
              }
              onClick={() =>
                setDeletion({
                  all: true,
                  job_id: filters.job_id,
                  user_id: filters.user_id,
                  status: filters.status,
                })
              }
            >
              {t('Clear filtered results')}
            </Button>
          </div>
        }
      />
      <ConfirmDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeletion(undefined)
        }}
        title={t('Delete review results')}
        desc={
          deletion?.all
            ? t(
                'Delete all review results matching the selected task, user and status filters. This cannot be undone.'
              )
            : t('Delete the selected review results. This cannot be undone.')
        }
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deletion) remove.mutate(deletion)
        }}
        confirmText={t('Delete')}
      />

      {selected && (
        <AuditFeatureSurface
          open
          onOpenChange={(value) => {
            if (!value) setSelected(undefined)
          }}
          title={t('Review result')}
          contentClassName='sm:max-w-3xl'
        >
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            <UserIdentity userId={selected.user_id} />
            <Badge variant='secondary'>{labels[selected.status]}</Badge>
            <span className='text-muted-foreground text-xs'>
              {selected.model} · #{selected.job_id}
            </span>
          </div>
          <Tabs defaultValue='result'>
            <TabsList className='w-full'>
              <TabsTrigger value='result'>{t('Review result')}</TabsTrigger>
              <TabsTrigger value='human'>
                {t('Evidence and review')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='result' className='space-y-4 pt-3'>
              <Badge variant='outline'>
                {selected.complete
                  ? t('Complete submitted text')
                  : t('Incomplete evidence')}
              </Badge>
              <p className='break-words whitespace-pre-wrap'>
                {selected.reason}
              </p>
              {selected.quote && (
                <blockquote className='bg-muted max-h-64 overflow-y-auto rounded-lg border-l-4 p-4 [overflow-wrap:anywhere] whitespace-pre-wrap'>
                  {selected.quote}
                </blockquote>
              )}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Model results are suggestions, not verified violations. Review the original evidence before making a decision.'
                )}
              </p>
            </TabsContent>
            <TabsContent value='human' className='pt-3'>
              <p className='text-muted-foreground mb-3 text-xs'>
                {t(
                  'Original messages may expire before review results. Create a review case to preserve important evidence.'
                )}
              </p>
              <InputAuditCasePanel auditID={selected.audit_id} />
            </TabsContent>
          </Tabs>
        </AuditFeatureSurface>
      )}
    </>
  )
}
