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
import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  getModelReviewResults,
  type ModelReviewFilters,
  type ModelReviewResult,
} from './model-review-api'
import { ModelReviewDashboard } from './model-review-dashboard'

const EMPTY: ModelReviewResult[] = []

export function ModelReviewResults(props: { jobID?: number }) {
  const { t, i18n } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const labels = useModelReviewLabels()
  const categories = useInputAuditCaseLabels().categories
  const [filters, setFilters] = useState<ModelReviewFilters>({
    p: 1,
    page_size: 20,
    status: '',
    job_id: props.jobID,
  })
  const [selected, setSelected] = useState<ModelReviewResult>()
  const query = useQuery({
    queryKey: ['model-review-results', userID, filters],
    queryFn: () => getModelReviewResults(filters),
    refetchInterval: 10000,
    retry: false,
  })
  const columns = useMemo<ColumnDef<ModelReviewResult>[]>(
    () => [
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
    ],
    [t, labels, categories, locale]
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
    enableRowSelection: false,
  })
  return (
    <>
      <ModelReviewDashboard
        key={`${props.jobID ?? 'all'}-${filters.user_id ?? 'all'}`}
        jobID={props.jobID}
        userID={filters.user_id}
        onSelectUser={(id) =>
          setFilters({ ...filters, p: 1, user_id: id, status: 'review' })
        }
      />
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        paginationInFooter={false}
        emptyTitle={
          query.isError ? t('Failed to load audit records') : t('No records')
        }
        toolbar={
          <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto]'>
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
          </div>
        }
      />
      {selected && (
        <Dialog
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
        </Dialog>
      )}
    </>
  )
}
