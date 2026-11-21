import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Trophy } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCheckinLeaderboard } from '@/features/checkin/api'
import { CheckinLeaderboardPreview } from '@/features/checkin/components/leaderboard-preview'
import { getCheckinStatus } from '@/features/profile/api'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { statusQueryOptions } from '@/lib/status-query'

const CheckinCalendarCard = lazy(() =>
  import('@/features/profile/components/checkin-calendar-card').then(
    (module) => ({ default: module.CheckinCalendarCard })
  )
)

const Leaderboard = lazy(() =>
  import('@/features/checkin/components/leaderboard').then((module) => ({
    default: module.CheckinLeaderboard,
  }))
)

export function CommunityCheckin(props: { showLeaderboard?: boolean } = {}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { status, loading, error } = useStatus()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const checkin = useQuery({
    queryKey: ['checkin-status', 'current'],
    queryFn: async () => requireServerSuccess(await getCheckinStatus()).data,
    enabled: status?.checkin_enabled === true,
    staleTime: 30000,
    refetchInterval: 30000,
  })
  const leaderboard = useQuery({
    queryKey: ['checkin-leaderboard'],
    queryFn: getCheckinLeaderboard,
    enabled:
      status?.checkin_enabled === true && props.showLeaderboard !== false,
    staleTime: 30000,
  })
  const checked = checkin.data?.stats?.checked_in_today === true
  const todayAward = checkin.data?.stats?.records.find(
    (record) => record.checkin_date === checkin.data?.eligibility?.today
  )?.quota_awarded
  const checkinPrompt = checkin.data
    ? {
        checkedIn: checked,
        minQuota: checkin.data.eligibility?.min_quota,
        maxQuota: checkin.data.eligibility?.max_quota,
        todayAward,
        allowed: checkin.data.eligibility?.allowed,
      }
    : undefined
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
            {props.showLeaderboard !== false && leaderboard.data?.enabled && (
              <div className='space-y-2.5 border-t pt-3'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='flex min-w-0 items-center gap-1.5 text-sm font-medium'>
                    <Trophy
                      className='size-3.5 shrink-0 text-amber-600 dark:text-amber-400'
                      aria-hidden='true'
                    />
                    <span className='truncate'>
                      {t("Today's check-in leaderboard")}
                    </span>
                  </p>
                  {leaderboard.data.my_rank !== undefined && (
                    <Badge
                      variant='secondary'
                      className='h-5 shrink-0 px-1.5 text-[11px] tabular-nums'
                    >
                      #{formatNumber(leaderboard.data.my_rank, locale)}
                    </Badge>
                  )}
                </div>
                <CheckinLeaderboardPreview
                  entries={leaderboard.data.top ?? []}
                  locale={locale}
                  limit={5}
                />
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='w-full'
                  onClick={() => setLeaderboardOpen(true)}
                >
                  {t('View full leaderboard')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      <Dialog
        open={leaderboardOpen}
        onOpenChange={setLeaderboardOpen}
        title={t('Check-in leaderboard')}
        contentClassName='w-[calc(100%-2rem)] sm:max-w-4xl'
      >
        <Suspense fallback={<LoadingState />}>
          {leaderboardOpen && (
            <Leaderboard
              mode='dialog'
              checkinPrompt={checkinPrompt}
              onOpenCheckin={
                checkin.data
                  ? () => {
                      setLeaderboardOpen(false)
                      setOpen(true)
                    }
                  : undefined
              }
            />
          )}
        </Suspense>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Daily Check-in')}
        contentClassName='w-[calc(100%-2rem)] sm:max-w-4xl'
        bodyClassName='flex flex-col gap-4'
      >
        {open && (
          <Suspense fallback={<LoadingState />}>
            <div
              role='region'
              aria-label={t('Check-in reward details')}
              className='flex min-w-0 flex-col gap-4'
            >
              <CheckinCalendarCard
                embedded
                checkinEnabled={status?.checkin_enabled === true}
                turnstileEnabled={
                  !!(status?.turnstile_check && status?.turnstile_site_key)
                }
                turnstileSiteKey={status?.turnstile_site_key || ''}
              />
            </div>
          </Suspense>
        )}
      </Dialog>
    </Card>
  )
}
