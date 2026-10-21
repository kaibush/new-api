import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  DataTableView,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getBotFeedback, type BotFeedback } from './api'
import { MessageText } from './message-text'

const emptyRecords: BotFeedback[] = []

export function CommunityBotFeedback() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const records = useQuery({
    queryKey: ['community-bot-feedback', pagination],
    queryFn: () =>
      getBotFeedback(pagination.pageIndex + 1, pagination.pageSize),
    refetchInterval: 15000,
  })
  const columns = useMemo<ColumnDef<BotFeedback>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) =>
          new Date(row.original.created_at * 1000).toLocaleString(locale),
      },
      {
        accessorKey: 'name',
        header: t('User'),
        cell: ({ row }) => (
          <div className='max-w-40 break-words whitespace-normal'>
            {row.original.name}
            <span className='text-muted-foreground block text-xs'>
              #{row.original.user_id}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'text',
        header: t('Mention message'),
        cell: ({ row }) => (
          <div className='max-w-sm min-w-40 break-words whitespace-pre-wrap'>
            <MessageText text={row.original.text} />
            {row.original.filename && (
              <p className='text-muted-foreground'>{row.original.filename}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'reply_text',
        header: t('Bot reply'),
        cell: ({ row }) => (
          <div className='max-w-sm min-w-40 break-words whitespace-pre-wrap'>
            <p className='text-muted-foreground mb-1 text-xs'>
              {row.original.bot_name}
            </p>
            <MessageText text={row.original.reply_text} />
          </div>
        ),
      },
    ],
    [t, locale]
  )
  const { table } = useDataTable({
    data: records.data?.items ?? emptyRecords,
    columns,
    pagination,
    onPaginationChange: setPagination,
    totalCount: records.data?.total ?? 0,
    manualPagination: true,
  })
  if (records.isError) {
    return <ErrorState onRetry={() => void records.refetch()} />
  }
  return (
    <div className='min-w-0 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t('Total mentions: {{total}}', {
            total: formatNumber(records.data?.total ?? 0, locale),
          })}
        </p>
        <Button
          variant='outline'
          size='sm'
          disabled={records.isFetching}
          onClick={() => void records.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      <DataTableView
        table={table}
        isLoading={records.isPending}
        emptyTitle={t('No bot feedback yet')}
      />
      <DataTablePagination table={table} compact />
    </div>
  )
}
