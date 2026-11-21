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
import { CalendarCheck, Sparkles } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getCheckinStatus } from '@/features/profile/api'
import { useStatus } from '@/hooks/use-status'
import { requireServerSuccess } from '@/lib/server-error-message'

import { CheckinLeaderboard } from './leaderboard'
import type { LeaderboardCheckinPrompt } from './leaderboard-my-rank'

const CheckinCalendarCard = lazy(() =>
  import('@/features/profile/components/checkin-calendar-card').then(
    (module) => ({ default: module.CheckinCalendarCard })
  )
)

export function CheckinLeaderboardPage() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [justClaimed, setJustClaimed] = useState(false)
  const [locateSignal, setLocateSignal] = useState(0)
  const checkinEnabled = status?.checkin_enabled === true

  const checkin = useQuery({
    queryKey: ['checkin-status', 'current'],
    queryFn: async () => requireServerSuccess(await getCheckinStatus()).data,
    enabled: checkinEnabled,
    staleTime: 30000,
  })

  const checkinAvailable = checkinEnabled && checkin.data?.enabled !== false
  const checkedIn = checkin.data?.stats?.checked_in_today === true
  const todayAward = checkin.data?.stats?.records.find(
    (record) => record.checkin_date === checkin.data?.eligibility?.today
  )?.quota_awarded

  const checkinPrompt: LeaderboardCheckinPrompt | undefined =
    checkinAvailable && checkin.data
      ? {
          checkedIn,
          minQuota: checkin.data.eligibility?.min_quota,
          maxQuota: checkin.data.eligibility?.max_quota,
          todayAward,
          allowed: checkin.data.eligibility?.allowed,
        }
      : undefined

  let actionLabel = t('Check in now')
  if (checkedIn) actionLabel = t('View check-in records')
  else if (checkin.data?.eligibility?.allowed === false) {
    actionLabel = t('Check-in reward details')
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Check-in leaderboard')}
        </SectionPageLayout.Title>
        {checkinAvailable && checkin.data && (
          <SectionPageLayout.Actions>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setCheckinOpen(true)}
            >
              {checkedIn ? (
                <CalendarCheck data-icon='inline-start' aria-hidden='true' />
              ) : (
                <Sparkles data-icon='inline-start' aria-hidden='true' />
              )}
              {actionLabel}
            </Button>
          </SectionPageLayout.Actions>
        )}
        <SectionPageLayout.Content>
          <div className='mx-auto w-full max-w-5xl pb-6'>
            <CheckinLeaderboard
              mode='page'
              checkinPrompt={checkinPrompt}
              justClaimed={justClaimed}
              locateSignal={locateSignal}
              onOpenCheckin={
                checkinAvailable ? () => setCheckinOpen(true) : undefined
              }
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <Dialog
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
        title={t('Daily Check-in')}
        contentClassName='w-[calc(100%-2rem)] sm:max-w-4xl'
        bodyClassName='flex flex-col gap-4'
      >
        {checkinOpen && (
          <Suspense fallback={<LoadingState />}>
            <div
              role='region'
              aria-label={t('Check-in reward details')}
              className='flex min-w-0 flex-col gap-4'
            >
              <CheckinCalendarCard
                embedded
                checkinEnabled={checkinEnabled}
                turnstileEnabled={
                  !!(status?.turnstile_check && status?.turnstile_site_key)
                }
                turnstileSiteKey={status?.turnstile_site_key || ''}
                leaderboardActionLabel={t('See my rank')}
                onCheckinSuccess={() => setJustClaimed(true)}
                onViewLeaderboard={() => {
                  setCheckinOpen(false)
                  setLocateSignal((count) => count + 1)
                }}
              />
            </div>
          </Suspense>
        )}
      </Dialog>
    </>
  )
}
