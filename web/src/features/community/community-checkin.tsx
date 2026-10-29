import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCheckinStatus } from '@/features/profile/api'
import { useStatus } from '@/hooks/use-status'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { requireServerSuccess } from '@/lib/server-error-message'
import { statusQueryOptions } from '@/lib/status-query'

const CheckinCalendarCard = lazy(() =>
  import('@/features/profile/components/checkin-calendar-card').then(
    (module) => ({ default: module.CheckinCalendarCard })
  )
)

export function CommunityCheckin() {
  const { t } = useTranslation()
  const { status, loading, error } = useStatus()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const month = dayjs().format('YYYY-MM')
  const checkin = useQuery({
    queryKey: ['checkin-status', month],
    queryFn: async () =>
      requireServerSuccess(await getCheckinStatus(month)).data,
    enabled: status?.checkin_enabled === true,
    staleTime: 30000,
    refetchInterval: 30000,
  })
  const checked = checkin.data?.stats?.checked_in_today === true
  const todayAward = checkin.data?.stats?.records.find(
    (record) => record.checkin_date === checkin.data?.eligibility?.today
  )?.quota_awarded
  let label = t('Open check-in')
  if (checked) label = t('View check-in records')
  else if (checkin.data?.eligibility?.allowed === false) {
    label = t('Check-in reward details')
  }

  // Match the existing profile's availability setting; no second reward flow.
  if (!loading && !error && status?.checkin_enabled !== true) return null
  if (checkin.data?.enabled === false) return null
  return (
    <Card
      size='sm'
      data-card-hover='false'
      className='bg-muted/40 gap-2 ring-0'
      role='region'
      aria-label={t('Daily Check-in')}
    >
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <CalendarCheck className='text-primary size-4' aria-hidden='true' />
          {t('Daily Check-in')}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {(loading || checkin.isLoading) && <LoadingState size='sm' />}
        {(error || checkin.isError) && (
          <ErrorState
            className='min-h-0 py-2'
            onRetry={() => {
              if (error) {
                void client.refetchQueries({
                  queryKey: statusQueryOptions.queryKey,
                })
              } else void checkin.refetch()
            }}
          />
        )}
        {!loading && !error && !checkin.isLoading && !checkin.isError && (
          <>
            <p className='text-muted-foreground text-xs' role='status'>
              {checked
                ? t('Checked in')
                : t('Check in daily to receive random quota rewards')}
              {checked && todayAward !== undefined && (
                <span className='text-foreground ml-2 font-medium'>
                  +{formatQuotaWithCurrency(todayAward)}
                </span>
              )}
            </p>
            <Button
              variant={checked ? 'outline' : 'default'}
              size='sm'
              className='w-full'
              onClick={() => setOpen(true)}
              disabled={!checkin.data}
            >
              {label}
            </Button>
          </>
        )}
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Daily Check-in')}
        contentClassName='sm:max-w-2xl'
      >
        {open && (
          <Suspense fallback={<LoadingState />}>
            <CheckinCalendarCard
              checkinEnabled={status?.checkin_enabled === true}
              turnstileEnabled={
                !!(status?.turnstile_check && status?.turnstile_site_key)
              }
              turnstileSiteKey={status?.turnstile_site_key || ''}
            />
          </Suspense>
        )}
      </Dialog>
    </Card>
  )
}
