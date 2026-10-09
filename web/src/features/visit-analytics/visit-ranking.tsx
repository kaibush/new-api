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
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { VisitBucket } from './api'

export function VisitRanking(props: {
  title: string
  data: VisitBucket[]
  onPage?: (page: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <StaticDataTable
          data={props.data}
          emptyContent={<EmptyState />}
          columns={[
            {
              id: 'name',
              header: t('Name'),
              cell: (row) =>
                props.onPage ? (
                  <Button
                    variant='link'
                    className='max-w-full justify-start truncate p-0'
                    onClick={() => props.onPage?.(row.name)}
                  >
                    {row.name}
                  </Button>
                ) : (
                  <span className='break-all'>
                    {row.name || t('Direct visit')}
                  </span>
                ),
            },
            {
              id: 'pv',
              header: t('Page views (PV)'),
              cell: (row) => formatNumber(row.pv, locale),
            },
            {
              id: 'uv',
              header: t('Unique visitors (UV)'),
              cell: (row) => formatNumber(row.uv, locale),
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}
