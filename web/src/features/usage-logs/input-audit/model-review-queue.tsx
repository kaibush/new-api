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
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { useModelReviewLabels } from './case-labels'
import { AuditFeatureSurface } from './feature-surface'
import {
  cancelModelReview,
  clearModelReviewQueue,
  deleteModelReviewJobs,
  pauseModelReviewQueue,
  updateModelReviewJob,
  type ModelReviewJob,
} from './model-review-api'

export function ModelReviewQueue(props: {
  jobs: ModelReviewJob[]
  loading: boolean
  paused: boolean
  onSelectJob: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const labels = useModelReviewLabels()
  const modes = useMemo<Record<string, string>>(
    () => ({
      incremental: t('Unreviewed messages'),
      all: t('Re-review retained messages'),
      failed: t('Retry failed reviews'),
    }),
    [t]
  )
  const client = useQueryClient()
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<{
    action: 'clear' | 'delete' | 'stop' | 'history'
    ids: number[]
  }>()
  const [editing, setEditing] = useState<ModelReviewJob>()
  const [mode, setMode] = useState('incremental')
  const [user, setUser] = useState<number>()
  const [concurrency, setConcurrency] = useState(3)
  const [interval, setInterval] = useState(0)
  const pause = useMutation({
    mutationFn: pauseModelReviewQueue,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['model-review-settings'] })
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
    },
  })
  const mutation = useMutation({
    mutationFn: async (values: {
      action: 'clear' | 'delete' | 'stop' | 'history'
      ids: number[]
    }) => {
      if (values.action === 'clear') {
        await clearModelReviewQueue()
        return
      }
      if (values.action === 'history') {
        await deleteModelReviewJobs([], true)
        return
      }
      if (values.action === 'delete') {
        await deleteModelReviewJobs(values.ids)
        return
      }
      for (const id of values.ids) await cancelModelReview(id)
    },
    onSuccess: () => {
      setConfirm(undefined)
      table.resetRowSelection()
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
      void client.invalidateQueries({ queryKey: ['model-review-results'] })
      void client.invalidateQueries({ queryKey: ['model-review-users'] })
      void client.invalidateQueries({ queryKey: ['model-review-settings'] })
    },
  })
  const edit = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Missing review task')
      return updateModelReviewJob(editing.id, {
        mode,
        user_id: user,
        concurrency,
        request_interval_seconds: interval,
      })
    },
    onSuccess: () => {
      setEditing(undefined)
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
    },
  })
  const onSelectJob = props.onSelectJob
  const paused = props.paused
  const columns = useMemo<ColumnDef<ModelReviewJob>[]>(
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
        accessorKey: 'id',
        header: t('Task'),
        cell: ({ row }) => `#${row.original.id}`,
        meta: { mobileTitle: true, label: t('Task') },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => (
          <Badge variant='secondary'>
            {paused && row.original.status === 'running'
              ? t('Paused')
              : labels[row.original.status]}
          </Badge>
        ),
        meta: { label: t('Status') },
      },
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) =>
          row.original.user_id > 0 ? (
            <UserIdentity userId={row.original.user_id} />
          ) : (
            t('All')
          ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'processed',
        header: t('Reviewed messages'),
        cell: ({ row }) => formatNumber(row.original.processed, locale),
        meta: { label: t('Reviewed messages') },
      },
      {
        accessorKey: 'flagged',
        header: t('Needs human review'),
        cell: ({ row }) => formatNumber(row.original.flagged, locale),
        meta: { label: t('Needs human review') },
      },
      {
        accessorKey: 'failed',
        header: t('Failed'),
        cell: ({ row }) => formatNumber(row.original.failed, locale),
        meta: { label: t('Failed') },
      },
      {
        accessorKey: 'mode',
        header: t('Review scope'),
        cell: ({ row }) => modes[row.original.mode],
        meta: { label: t('Review scope') },
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onSelectJob(row.original.id)}
            >
              {t('Results')}
            </Button>
            {row.original.status === 'pending' && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setEditing(row.original)
                  setMode(row.original.mode)
                  setUser(row.original.user_id || undefined)
                  setConcurrency(row.original.concurrency ?? 3)
                  setInterval(row.original.request_interval_seconds ?? 0)
                }}
              >
                {t('Edit')}
              </Button>
            )}
            {['pending', 'running'].includes(row.original.status) && (
              <Button
                variant='outline'
                size='sm'
                disabled={mutation.isPending}
                onClick={() =>
                  setConfirm({ action: 'stop', ids: [row.original.id] })
                }
              >
                {t('Stop task')}
              </Button>
            )}
            <Button
              variant='destructive'
              size='sm'
              disabled={mutation.isPending}
              onClick={() =>
                setConfirm({ action: 'delete', ids: [row.original.id] })
              }
            >
              {t('Delete')}
            </Button>
          </div>
        ),
        meta: { label: t('Actions') },
      },
    ],
    [t, labels, locale, onSelectJob, mutation.isPending, modes, paused]
  )
  const data = useMemo(
    () => props.jobs.filter((job) => !status || job.status === status),
    [props.jobs, status]
  )
  const { table } = useDataTable({
    columns,
    data,
    enableRowSelection: true,
    manualPagination: false,
    enableSorting: false,
    getRowId: (row) => String(row.id),
    initialPagination: { pageIndex: 0, pageSize: 20 },
  })
  const selected = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original.id)
  const queued = props.jobs.filter((job) =>
    ['pending', 'running'].includes(job.status)
  ).length
  const action = confirm?.action ?? 'delete'
  const titles = {
    clear: t('Clear queue'),
    stop: t('Stop task'),
    delete: t('Delete review tasks'),
    history: t('Clear task history'),
  }
  const descriptions = {
    history: t(
      'Delete completed and cancelled tasks and their review results. Active tasks are preserved. This cannot be undone.'
    ),
    clear: t(
      'Pause the queue, stop the running task and cancel all queued tasks. Saved review results are retained.'
    ),
    stop: t(
      'Stop this task. Saved results are retained and unreviewed messages can be processed by a new task.'
    ),
    delete: t(
      'Stop and delete the selected tasks and their review results. This cannot be undone.'
    ),
  }
  return (
    <section aria-label={t('Review task queue')} className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-medium'>
          {t('Review task queue')} · {formatNumber(queued, locale)}
        </h3>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={pause.isPending}
            onClick={() => pause.mutate(!props.paused)}
          >
            {props.paused ? t('Resume queue') : t('Pause queue')}
          </Button>
          <Button
            variant='outline'
            disabled={
              mutation.isPending ||
              !props.jobs.some((job) =>
                ['completed', 'cancelled'].includes(job.status)
              )
            }
            onClick={() => setConfirm({ action: 'history', ids: [] })}
          >
            {t('Clear task history')}
          </Button>
          <Button
            variant='destructive'
            disabled={!queued || mutation.isPending}
            onClick={() => setConfirm({ action: 'clear', ids: [] })}
          >
            {t('Clear queue')}
          </Button>
        </div>
      </div>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={props.loading}
        paginationInFooter={false}
        className='h-auto'
        showMobileBulkActions
        mobileProps={{ enableRowSelection: true }}
        toolbar={
          <NativeSelect
            aria-label={t('Task status')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              table.resetPageIndex()
              table.resetRowSelection()
            }}
          >
            <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
            {['pending', 'running', 'completed', 'cancelled'].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {labels[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
        bulkActions={
          <DataTableBulkActions table={table} entityName={t('Task')}>
            <Button
              variant='destructive'
              disabled={mutation.isPending || selected.length > 100}
              onClick={() => setConfirm({ action: 'delete', ids: selected })}
            >
              {t('Delete selected')}
            </Button>
          </DataTableBulkActions>
        }
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirm(undefined)
        }}
        title={titles[action]}
        desc={descriptions[action]}
        destructive
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (confirm) mutation.mutate(confirm)
        }}
        confirmText={t('Confirm')}
      />
      {editing && (
        <AuditFeatureSurface
          open
          onOpenChange={(open) => {
            if (!open && !edit.isPending) setEditing(undefined)
          }}
          title={t('Edit queued review task')}
        >
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault()
              edit.mutate()
            }}
          >
            <p className='text-muted-foreground text-xs'>
              {t(
                'Only queued tasks can be edited. Saving also uses the current model connection and review policy.'
              )}
            </p>
            <Field>
              <FieldLabel htmlFor='edit-review-mode'>
                {t('Review scope')}
              </FieldLabel>
              <NativeSelect
                id='edit-review-mode'
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                {['incremental', 'all', 'failed'].map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {modes[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='edit-review-user'>
                {t('User (all when empty)')}
              </FieldLabel>
              <UserSelector
                id='edit-review-user'
                value={user}
                onChange={setUser}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='edit-review-concurrency'>
                {t('Concurrent message reviews')}
              </FieldLabel>
              <Input
                id='edit-review-concurrency'
                type='number'
                min={1}
                max={5}
                required
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='edit-review-interval'>
                {t('Request interval (seconds)')}
              </FieldLabel>
              <Input
                id='edit-review-interval'
                type='number'
                min={0}
                max={60}
                required
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
            </Field>
            <Button type='submit' disabled={edit.isPending}>
              {t('Save')}
            </Button>
          </form>
        </AuditFeatureSurface>
      )}
    </section>
  )
}
