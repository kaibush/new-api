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
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { getCheckinUserDetail } from '../api'
import { CheckinGrantStatus } from './grant-status'
import { CheckinRewardDetails } from './reward-details'

const Usage = lazy(() =>
  import('@/features/user-activity/components/user-usage').then((module) => ({
    default: module.UserUsagePanel,
  }))
)

export function CheckinUserDetailDialog(props: {
  userId: number
  onClose: () => void
  initialTab?: 'usage' | 'balance' | 'rewards'
  days?: number
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<string>(props.initialTab ?? 'balance')
  const query = useQuery({
    queryKey: ['checkin-admin', 'detail', props.userId],
    queryFn: () => getCheckinUserDetail(props.userId),
    enabled: tab !== 'usage',
    refetchInterval: tab !== 'usage' ? 30000 : false,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('User details')}
      contentClassName='sm:max-w-4xl'
      bodyClassName='space-y-4'
    >
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className='max-w-full flex-wrap group-data-horizontal/tabs:h-auto'>
          <TabsTrigger value='usage'>{t('User usage')}</TabsTrigger>
          <TabsTrigger value='balance'>{t('Balance')}</TabsTrigger>
          <TabsTrigger value='rewards'>{t('Reward history')}</TabsTrigger>
        </TabsList>
        <TabsContent value='usage' className='pt-4'>
          {tab === 'usage' && (
            <Suspense fallback={<LoadingState />}>
              <Usage userId={props.userId} days={props.days ?? 30} />
            </Suspense>
          )}
        </TabsContent>
        {tab !== 'usage' && query.isPending && <LoadingState />}
        {tab !== 'usage' && query.isError && (
          <ErrorState onRetry={() => void query.refetch()} />
        )}
        <TabsContent value='balance' className='space-y-4 pt-4'>
          {tab === 'balance' && query.data && !query.isError && (
            <>
              <h3 className='font-medium'>
                {query.data.user.display_name || query.data.user.username}
              </h3>
              {query.data.grants && (
                <CheckinGrantStatus
                  grants={query.data.grants}
                  balance={query.data.user.balance}
                />
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value='rewards' className='space-y-4 pt-4'>
          {tab === 'rewards' && query.data && !query.isError && (
            <>
              <CheckinRewardDetails eligibility={query.data.user.eligibility} />
              <h4 className='text-sm font-medium'>
                {t('Recent check-in rewards')}
              </h4>
              {query.data.records.length === 0 && (
                <p className='text-muted-foreground text-sm'>
                  {t('No records')}
                </p>
              )}
              <Accordion>
                {query.data.records.map((record) => (
                  <AccordionItem
                    key={record.checkin_date}
                    value={record.checkin_date}
                  >
                    <AccordionTrigger>
                      {record.checkin_date} · {t('Check-in reward details')} ·{' '}
                      {formatQuotaWithCurrency(record.quota_awarded)}
                    </AccordionTrigger>
                    <AccordionContent>
                      {record.snapshot ? (
                        <CheckinRewardDetails
                          eligibility={record.snapshot.eligibility}
                        />
                      ) : (
                        <p>{t('Historical calculation unavailable')}</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </>
          )}
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
