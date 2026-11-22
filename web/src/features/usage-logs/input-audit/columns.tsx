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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { UserIdentity } from '@/components/user-identity'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import type { InputAudit } from './api'
import { InputAuditDetailsDialog } from './details-dialog'
import { HighlightedText } from './highlight'
import { keywordExcerpt } from './keyword'

export function useInputAuditColumns(
  onDelete?: (entry: InputAudit) => void,
  keyword?: string
): ColumnDef<InputAudit>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return useMemo(
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
        id: 'last_at',
        header: t('Last request'),
        size: 170,
        cell: ({ row }) =>
          dayjs
            .unix(row.original.last_at || row.original.created_at)
            .format('YYYY-MM-DD HH:mm:ss'),
        meta: { label: t('Last request'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        size: 130,
        cell: ({ row }) => (
          <UserIdentity
            userId={row.original.user_id}
            username={row.original.username}
          />
        ),
        meta: { label: t('Username') },
      },
      {
        accessorKey: 'model',
        header: t('Model'),
        size: 160,
        meta: { label: t('Model') },
      },
      {
        accessorKey: 'content',
        header: t('User message'),
        size: 420,
        cell: ({ row }) => {
          // What the agent did for this message, read from its conversation.
          const activity = row.original.activity
          return (
            <div className='flex max-w-[28rem] flex-col gap-1'>
              <TruncatedCell
                contentClassName='line-clamp-2 whitespace-normal break-words'
                tooltipContent={
                  <HighlightedText
                    text={row.original.content}
                    query={keyword}
                  />
                }
              >
                <HighlightedText
                  text={keywordExcerpt(row.original.content, keyword)}
                  query={keyword}
                />
              </TruncatedCell>
              {activity && activity.tool_calls > 0 && (
                <div className='text-muted-foreground flex flex-wrap items-center gap-1 text-xs'>
                  <span>
                    {t('Tool calls: {{count}}', {
                      count: `${formatNumber(activity.tool_calls, locale)}${activity.more ? '+' : ''}`,
                    })}
                  </span>
                  {activity.tools.map((tool) => (
                    <Badge key={tool} variant='outline' className='font-mono'>
                      {tool}
                    </Badge>
                  ))}
                </div>
              )}
              {activity?.reply && (
                <TruncatedCell
                  contentClassName='text-muted-foreground line-clamp-1 whitespace-normal break-words text-xs'
                  tooltipContent={
                    <HighlightedText text={activity.reply} query={keyword} />
                  }
                >
                  <span className='font-medium'>{t('Assistant')}: </span>
                  <HighlightedText text={activity.reply} query={keyword} />
                </TruncatedCell>
              )}
            </div>
          )
        },
        meta: { label: t('User message') },
      },
      {
        id: 'requests',
        header: t('Requests'),
        size: 150,
        cell: ({ row }) => {
          const count = row.original.request_count ?? 1
          const first = row.original.first_at || row.original.created_at
          const last = row.original.last_at || row.original.created_at
          return (
            <div className='flex flex-col items-start gap-0.5'>
              <Badge variant={count > 1 ? 'default' : 'secondary'}>
                ×{formatNumber(count, locale)}
              </Badge>
              {count > 1 && (
                <span className='text-muted-foreground text-xs'>
                  {dayjs.unix(first).format('HH:mm:ss')} –{' '}
                  {dayjs.unix(last).format('HH:mm:ss')}
                </span>
              )}
            </div>
          )
        },
        meta: { label: t('Requests') },
      },
      {
        id: 'details',
        header: t('Details'),
        size: 90,
        cell: ({ row }) => (
          <InputAuditDetailsDialog entry={row.original} keyword={keyword} />
        ),
        meta: { label: t('Details') },
      },
      {
        id: 'delete',
        header: t('Delete'),
        size: 90,
        cell: ({ row }) =>
          onDelete ? (
            <Button
              variant='destructive'
              size='sm'
              onClick={() => onDelete(row.original)}
            >
              {t('Delete')}
            </Button>
          ) : null,
        meta: { label: t('Delete') },
      },
    ],
    [t, locale, onDelete, keyword]
  )
}
