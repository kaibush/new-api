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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import type {
  UserRankingItem,
  UserUsageMetric,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export function UserRanking(props: {
  data: UserRankingItem[]
  metric: UserUsageMetric
  title: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <StaticDataTable
      className='max-h-[32rem] overflow-y-auto rounded-none border-0'
      containerProps={{
        tabIndex: 0,
        role: 'region',
        'aria-label': props.title,
      }}
      tableProps={{ 'aria-label': props.title, withContainer: false }}
      tableClassName='table-fixed'
      headerRowClassName='bg-card sticky top-0 z-10'
      data={props.data}
      getRowKey={(row) => row.username}
      columns={[
        {
          id: 'rank',
          header: t('Ranking'),
          className: 'w-12 whitespace-normal',
          cellClassName: 'text-muted-foreground',
          cell: (_row, index) => formatNumber(index + 1, locale),
        },
        {
          id: 'user',
          header: t('Username'),
          cell: (row) => (
            <div className='flex min-w-0 items-center gap-2'>
              <span
                aria-hidden='true'
                className='size-2 shrink-0 rounded-full'
                style={{ backgroundColor: row.color }}
              />
              <span className='break-all whitespace-normal'>
                {row.username}
              </span>
            </div>
          ),
        },
        {
          id: 'value',
          header:
            props.metric === 'tokens'
              ? t('Token Usage')
              : t('Consumption Amount'),
          className: 'w-[42%] text-right whitespace-normal',
          cellClassName: 'text-right whitespace-normal break-all tabular-nums',
          truncate: false,
          cell: (row) => row.valueDisplay,
        },
      ]}
    />
  )
}
