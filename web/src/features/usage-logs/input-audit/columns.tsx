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
import dayjs from '@/lib/dayjs'

import type { InputAudit } from './api'
import { InputAuditDetailsDialog } from './details-dialog'

export function useInputAuditColumns(): ColumnDef<InputAudit>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Received at gateway'),
        size: 180,
        cell: ({ row }) =>
          dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss'),
        meta: { label: t('Received at gateway'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        size: 130,
        cell: ({ row }) =>
          `${row.original.username} (#${row.original.user_id})`,
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
        size: 380,
        cell: ({ row }) => (
          <TruncatedCell
            className='max-w-96'
            contentClassName='line-clamp-2 whitespace-normal break-words'
          >
            {row.original.content}
          </TruncatedCell>
        ),
        meta: { label: t('User message') },
      },
      {
        accessorKey: 'truncated',
        header: t('Truncated'),
        size: 110,
        cell: ({ row }) => (
          <Badge variant='secondary'>
            {row.original.truncated ? t('Yes') : t('No')}
          </Badge>
        ),
        meta: { label: t('Truncated') },
      },
      {
        id: 'details',
        header: t('Details'),
        size: 90,
        cell: ({ row }) => <InputAuditDetailsDialog entry={row.original} />,
        meta: { label: t('Details') },
      },
    ],
    [t]
  )
}
