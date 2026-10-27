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

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { ActivityAmounts } from '../api'

export function ActivityFundingSummary(props: { amounts: ActivityAmounts }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Spending by funding source')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className='grid grid-cols-3 gap-3'>
          {[
            { label: t('Recharged quota'), value: props.amounts.wallet_quota },
            { label: t('Check-in quota'), value: props.amounts.checkin_quota },
            {
              label: t('Subscription quota'),
              value: props.amounts.subscription_quota,
            },
          ].map((item) => (
            <div key={item.label} role='group' aria-label={item.label}>
              <dt className='text-muted-foreground text-sm'>{item.label}</dt>
              <dd className='text-lg font-semibold tabular-nums'>
                {formatQuotaWithCurrency(item.value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
