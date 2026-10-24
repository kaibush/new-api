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
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { getCheckinUserDetail } from '../api'
import { formatCheckinPercent } from '../format'
import { CheckinRewardDetails } from './reward-details'

const Chart = lazy(() =>
  import('./activity-charts').then((module) => ({
    default: module.CheckinActivityChart,
  }))
)

export function CheckinUserDetailDialog(props: {
  userId: number | null
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: ['checkin-admin', 'detail', props.userId],
    queryFn: () => getCheckinUserDetail(props.userId ?? 0),
    enabled: props.userId !== null,
  })
  return (
    <Dialog
      open={props.userId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Check-in reward details')}
      contentClassName='sm:max-w-4xl'
      bodyClassName='space-y-5'
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <h3 className='font-medium'>
            {query.data.user.display_name || query.data.user.username}
          </h3>
          <CheckinRewardDetails eligibility={query.data.user.eligibility} />
          <Suspense fallback={<LoadingState />}>
            <Chart days={query.data.days} />
          </Suspense>
          <h4 className='text-sm font-medium'>
            {t('Recent check-in rewards')}
          </h4>
          <StaticDataTable
            data={query.data.records}
            columns={[
              {
                id: 'date',
                header: t('Date'),
                cell: (record) => record.checkin_date,
              },
              {
                id: 'reward',
                header: t('Reward'),
                cell: (record) => formatQuotaWithCurrency(record.quota_awarded),
              },
              {
                id: 'base',
                header: t('Base reward'),
                cell: (record) =>
                  record.snapshot
                    ? formatQuotaWithCurrency(record.snapshot.base_quota)
                    : '—',
              },
              {
                id: 'percentage',
                header: t('Reward percentage'),
                cell: (record) =>
                  record.snapshot
                    ? formatCheckinPercent(
                        record.snapshot.eligibility.reward_percent,
                        locale
                      )
                    : t('Historical calculation unavailable'),
              },
              {
                id: 'version',
                header: t('Configuration version'),
                cell: (record) =>
                  record.snapshot
                    ? formatNumber(
                        record.snapshot.configuration.version,
                        locale
                      )
                    : '—',
              },
            ]}
          />
          <Accordion>
            {query.data.records
              .filter((record) => record.snapshot)
              .map((record) => (
                <AccordionItem
                  key={record.checkin_date}
                  value={record.checkin_date}
                >
                  <AccordionTrigger>
                    {record.checkin_date} · {t('Check-in reward details')}
                  </AccordionTrigger>
                  <AccordionContent>
                    {record.snapshot && (
                      <CheckinRewardDetails
                        eligibility={record.snapshot.eligibility}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
          </Accordion>
        </>
      )}
    </Dialog>
  )
}
