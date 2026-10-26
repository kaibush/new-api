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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'

import type { CheckinGrantSummary } from '../types'

export function CheckinGrantStatus(props: { grants: CheckinGrantSummary }) {
  const { t } = useTranslation()
  const grants = props.grants
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Expiring check-in quota')}</CardTitle>
        <CardDescription>
          {t(
            'Unused rewards expire automatically. Recharged quota is kept separately and is unaffected.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div>
            <dt className='text-muted-foreground text-sm'>{t('Available')}</dt>
            <dd>{formatQuotaWithCurrency(grants.available)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-sm'>
              {t('Reserved quota')}
            </dt>
            <dd>{formatQuotaWithCurrency(grants.reserved)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-sm'>{t('Used')}</dt>
            <dd>{formatQuotaWithCurrency(grants.used)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-sm'>{t('Expired')}</dt>
            <dd>{formatQuotaWithCurrency(grants.expired)}</dd>
          </div>
        </dl>
        <p className='text-muted-foreground text-sm'>
          {t('Recent expiring rewards (up to 100)')}
        </p>
        <StaticDataTable
          data={grants.records}
          columns={[
            {
              id: 'claimed',
              header: t('Claimed at'),
              cell: (row) =>
                dayjs.unix(row.created_at).format('YYYY-MM-DD HH:mm:ss'),
            },
            {
              id: 'expiry',
              header: t('Expires at'),
              cell: (row) =>
                dayjs.unix(row.expires_at).format('YYYY-MM-DD HH:mm:ss'),
            },
            {
              id: 'reward',
              header: t('Reward'),
              cell: (row) => formatQuotaWithCurrency(row.quota),
            },
            {
              id: 'available',
              header: t('Available'),
              cell: (row) => formatQuotaWithCurrency(row.available),
            },
            {
              id: 'reserved',
              header: t('Reserved quota'),
              cell: (row) => formatQuotaWithCurrency(row.reserved),
            },
            {
              id: 'used',
              header: t('Used'),
              cell: (row) => formatQuotaWithCurrency(row.used),
            },
            {
              id: 'expired',
              header: t('Expired'),
              cell: (row) => formatQuotaWithCurrency(row.expired),
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}
