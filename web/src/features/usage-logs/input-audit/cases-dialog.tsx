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
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  exportInputAuditLabels,
  getInputAuditCases,
  type InputAuditCase,
} from './api'
import { useInputAuditCaseLabels } from './case-labels'
import { InputAuditCasePanel } from './case-panel'
import { AuditFeatureSurface } from './feature-surface'

const EMPTY: InputAuditCase[] = []
export function InputAuditCasesDialog(
  props: { embedded?: boolean; active?: boolean } = {}
) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const labels = useInputAuditCaseLabels()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number>()
  const [filters, setFilters] = useState({
    p: 1,
    page_size: 20,
    status: '',
    user_id: undefined as number | undefined,
  })
  const query = useQuery({
    queryKey: ['input-audit-cases', user?.id, filters],
    queryFn: () => getInputAuditCases(filters),
    enabled:
      (props.embedded || open) &&
      props.active !== false &&
      user?.role === ROLE.SUPER_ADMIN,
    retry: false,
  })
  const download = useMutation({
    mutationFn: async () => {
      const items: unknown[] = []
      // At most 1000 retained cases; keep the download bounded and paginated.
      for (let p = 1; p <= 10; p++) {
        const page = await exportInputAuditLabels(p)
        items.push(...page.items)
        if (p * page.page_size >= page.total_cases) break
      }
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { format_version: 1, source: 'human_review', items },
              null,
              2
            ),
          ],
          { type: 'application/json' }
        )
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'input-audit-labels.json'
      link.click()
      URL.revokeObjectURL(url)
    },
  })
  const columns = useMemo<ColumnDef<InputAuditCase>[]>(
    () => [
      { accessorKey: 'id', header: t('Review case') },
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => <UserIdentity userId={row.original.user_id} />,
      },
      {
        accessorKey: 'status',
        header: t('Decision'),
        cell: ({ row }) =>
          labels.statuses[
            row.original.status as keyof typeof labels.statuses
          ] ?? row.original.status,
      },
      {
        accessorKey: 'updated_at',
        header: t('Updated at'),
        cell: ({ row }) =>
          dayjs.unix(row.original.updated_at).format('YYYY-MM-DD HH:mm'),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setSelected(row.original.id)}
          >
            {t('Review')}
          </Button>
        ),
      },
    ],
    [t, labels.statuses]
  )
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY : (query.data?.items ?? EMPTY),
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
    getRowId: (review) => String(review.id),
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })
  if (user?.role !== ROLE.SUPER_ADMIN) return null
  return (
    <>
      <AuditFeatureSurface
        embedded={props.embedded}
        open={open}
        onOpenChange={setOpen}
        title={t('Review cases')}
        trigger={<Button variant='outline'>{t('Review cases')}</Button>}
        contentClassName='sm:max-w-4xl'
      >
        <DataTablePage
          fixedHeight={false}
          table={table}
          columns={columns}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          paginationInFooter={false}
          emptyTitle={
            query.isError ? t('Failed to load audit records') : t('No records')
          }
          toolbar={
            <div className='flex flex-wrap gap-2'>
              <UserSelector
                value={filters.user_id}
                onChange={(id) => setFilters({ ...filters, p: 1, user_id: id })}
              />
              <NativeSelect
                aria-label={t('Decision')}
                value={filters.status}
                onChange={(event) =>
                  setFilters({ ...filters, p: 1, status: event.target.value })
                }
              >
                <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
                {Object.entries(labels.statuses).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                variant='outline'
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                {t('Export reviewed labels')}
              </Button>
              <Button
                variant='outline'
                disabled={query.isFetching}
                onClick={() => {
                  void query.refetch()
                }}
              >
                {t('Retry')}
              </Button>
              <p className='text-muted-foreground w-full text-xs'>
                {t(
                  'Export includes complete evidence with human confirmed or dismissed labels. Missing categories are unlabeled.'
                )}
              </p>
            </div>
          }
        />
      </AuditFeatureSurface>
      {selected !== undefined && (
        <AuditFeatureSurface
          open
          title={t('Review case')}
          onOpenChange={(value) => {
            if (!value) setSelected(undefined)
          }}
        >
          <InputAuditCasePanel caseID={selected} />
        </AuditFeatureSurface>
      )}
    </>
  )
}
