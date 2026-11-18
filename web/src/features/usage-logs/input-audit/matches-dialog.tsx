import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import dayjs from '@/lib/dayjs'
import { useAuthStore } from '@/stores/auth-store'

import { useInputAuditCaseLabels } from './case-labels'
import { AuditFeatureSurface } from './feature-surface'
import { getMatches, type MatchFilters, type MatchRecord } from './match-api'
import { MatchDetail } from './match-detail'

const EMPTY: MatchRecord[] = []

export function MatchesDialog(props: {
  requestID?: string
  embedded?: boolean
  active?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <AuditFeatureSurface
      embedded={props.embedded}
      open={open}
      onOpenChange={setOpen}
      title={t('Interception evidence')}
      contentClassName='sm:max-w-5xl'
      trigger={
        <Button variant='outline' size='sm'>
          {t('Interception evidence')}
        </Button>
      }
    >
      {(props.embedded || open) && (
        <MatchList
          key={props.requestID ?? ''}
          requestID={props.requestID}
          active={props.active}
        />
      )}
    </AuditFeatureSurface>
  )
}

function MatchList(props: { requestID?: string; active?: boolean }) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const labels = useInputAuditCaseLabels().statuses
  const [filters, setFilters] = useState<MatchFilters>({
    p: 1,
    page_size: 10,
    request_id: props.requestID,
  })
  const [keyword, setKeyword] = useState('')
  const [rule, setRule] = useState('')
  const [requestID, setRequestID] = useState(props.requestID ?? '')
  const [selected, setSelected] = useState<number>()
  const query = useQuery({
    queryKey: ['input-audit-matches', userID, filters],
    queryFn: () => getMatches(filters),
    enabled: props.active !== false,
    retry: false,
  })
  const columns = useMemo<ColumnDef<MatchRecord>[]>(
    () => [
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => <UserIdentity userId={row.original.user_id} />,
        meta: { mobileTitle: true, label: t('User') },
      },
      {
        accessorKey: 'rule',
        header: t('Rule'),
        cell: ({ row }) => (
          <span className='[overflow-wrap:anywhere]'>
            {row.original.rule || '—'}
          </span>
        ),
        meta: { label: t('Rule') },
      },
      {
        accessorKey: 'name',
        header: t('Plugin'),
        meta: { label: t('Plugin') },
      },
      {
        accessorKey: 'status',
        header: t('Review result'),
        cell: ({ row }) => (
          <Badge variant='secondary'>{labels[row.original.status]}</Badge>
        ),
        meta: { label: t('Review result') },
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
            onClick={() => setSelected(row.original.id)}
          >
            {t('Details')}
          </Button>
        ),
        meta: { label: t('Details') },
      },
    ],
    [t, labels]
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
      <p className='text-muted-foreground mb-4 text-sm'>
        {t(
          'Search captured match context, including system and tool text. Each rejected request is kept separately.'
        )}
      </p>
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
          <div className='space-y-3'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <UserSelector
                value={filters.user_id}
                onChange={(id) => setFilters({ ...filters, p: 1, user_id: id })}
              />
              <NativeSelect
                aria-label={t('Review result')}
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, p: 1, status: event.target.value })
                }
              >
                <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
                {(
                  [
                    'pending',
                    'dismissed',
                    'confirmed',
                    'insufficient_evidence',
                  ] as const
                ).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {labels[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <form
              className='grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]'
              onSubmit={(event) => {
                event.preventDefault()
                setFilters({
                  ...filters,
                  p: 1,
                  keyword,
                  rule,
                  request_id: requestID,
                })
              }}
            >
              <Input
                className='col-span-2 sm:col-span-1'
                aria-label={t('Match context keyword')}
                placeholder={t('Match context keyword')}
                maxLength={128}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <Button type='submit' disabled={query.isFetching}>
                {t('Search')}
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t('Refresh')}
              </Button>
            </form>
            <Accordion>
              <AccordionItem value='filters'>
                <AccordionTrigger>{t('More filters')}</AccordionTrigger>
                <AccordionContent>
                  <div className='grid gap-2 sm:grid-cols-2'>
                    <Input
                      aria-label={t('Rule')}
                      placeholder={t('Rule')}
                      maxLength={256}
                      value={rule}
                      onChange={(event) => setRule(event.target.value)}
                    />
                    <Input
                      aria-label={t('Request ID')}
                      placeholder={t('Request ID')}
                      maxLength={64}
                      value={requestID}
                      onChange={(event) => setRequestID(event.target.value)}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        }
      />
      {selected !== undefined && (
        <MatchDetail id={selected} onClose={() => setSelected(undefined)} />
      )}
    </>
  )
}
