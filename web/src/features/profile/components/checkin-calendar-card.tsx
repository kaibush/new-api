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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flame,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Turnstile } from '@/components/turnstile'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { CheckinGrantStatus } from '@/features/checkin/components/grant-status'
import {
  CheckinConfettiBurst,
  CheckinRewardRevealBanner,
  type CheckinSuccessPayload,
} from '@/features/checkin/components/reward-celebration'
import { CheckinRewardDetails } from '@/features/checkin/components/reward-details'
import {
  computeCheckinStreak,
  evaluateCheckinRoll,
} from '@/features/checkin/lib/leaderboard-utils'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getCheckinStatus, performCheckin } from '../api'
import type { CheckinRecord } from '../types'

interface CheckinCalendarCardProps {
  embedded?: boolean
  checkinEnabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  onCheckinSuccess?: (payload: CheckinSuccessPayload) => void
  onViewLeaderboard?: () => void
  leaderboardActionLabel?: string
}

export function CheckinCalendarCard({
  embedded = false,
  checkinEnabled,
  turnstileEnabled,
  turnstileSiteKey,
  onCheckinSuccess,
  onViewLeaderboard,
  leaderboardActionLabel,
}: CheckinCalendarCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [selectedMonth, setSelectedMonth] = useState<string>()
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false)
  const [turnstileModalVisible, setTurnstileModalVisible] = useState(false)
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [celebration, setCelebration] = useState<CheckinSuccessPayload | null>(
    null
  )
  const [claimedToday, setClaimedToday] = useState<{
    date: string
    quotaAwarded: number
  } | null>(null)
  const [confettiBurstKey, setConfettiBurstKey] = useState(0)

  // Fetch checkin status
  /* eslint-disable @tanstack/query/exhaustive-deps */
  const {
    data: checkinData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['checkin-status', selectedMonth ?? 'current'],
    queryFn: async () => {
      const res = await getCheckinStatus(selectedMonth)
      if (res.success && res.data) {
        return res.data
      }
      throw createServerError(res, t('Failed to fetch checkin status'))
    },
    refetchInterval: 30000,
    staleTime: 30000,
  })
  /* eslint-enable @tanstack/query/exhaustive-deps */

  const checkinRecordsMap = useMemo(() => {
    const map: Record<string, number> = {}
    const records = checkinData?.stats?.records || []
    records.forEach((record: CheckinRecord) => {
      map[record.checkin_date] = record.quota_awarded
    })
    return map
  }, [checkinData?.stats?.records])

  const monthlyQuota = useMemo(() => {
    const records = checkinData?.stats?.records || []
    return records.reduce(
      (sum: number, record: CheckinRecord) => sum + (record.quota_awarded || 0),
      0
    )
  }, [checkinData?.stats?.records])

  const eligibility = checkinData?.eligibility
  const todayString = eligibility?.today || dayjs().format('YYYY-MM-DD')
  const currentMonthStr = selectedMonth ?? todayString.slice(0, 7)
  const currentMonth = useMemo(() => {
    const [year, month] = currentMonthStr.split('-').map(Number)
    return new Date(year, month - 1, 1)
  }, [currentMonthStr])
  const claimedMatchesToday = claimedToday?.date === todayString
  const checkedToday =
    checkinData?.stats?.checked_in_today === true || claimedMatchesToday
  const todayAward =
    checkinRecordsMap[eligibility?.today || todayString] ??
    (claimedMatchesToday ? claimedToday.quotaAwarded : undefined)

  const streakDays = useMemo(() => {
    const dates = (checkinData?.stats?.records || []).map(
      (record: CheckinRecord) => record.checkin_date
    )
    if (claimedMatchesToday || celebration !== null) {
      dates.push(todayString)
    }
    return computeCheckinStreak(dates, todayString)
  }, [
    celebration,
    checkinData?.stats?.records,
    claimedMatchesToday,
    todayString,
  ])

  useEffect(() => {
    if (initialLoaded) return
    if (isLoading) return
    if (!checkinData) return
    setCollapsed(embedded || checkedToday)
    setInitialLoaded(true)
  }, [checkinData, checkedToday, embedded, initialLoaded, isLoading])

  const shouldTriggerTurnstile = useCallback(
    (message?: string) => {
      if (!turnstileEnabled) return false
      if (typeof message !== 'string') return true
      return message.includes('Turnstile')
    },
    [turnstileEnabled]
  )

  const doCheckin = useCallback(
    async (token?: string) => {
      setCheckinLoading(true)
      try {
        const res = await performCheckin(token)
        if (res.success && res.data) {
          const payload: CheckinSuccessPayload = {
            quotaAwarded: res.data.quota_awarded,
            minQuota: eligibility?.min_quota,
            maxQuota: eligibility?.max_quota,
          }
          toast.success(
            `${t('Check-in successful! Received')} ${formatQuotaWithCurrency(res.data.quota_awarded)}`
          )
          setClaimedToday({
            date: todayString,
            quotaAwarded: res.data.quota_awarded,
          })
          setCelebration(payload)
          setConfettiBurstKey((key) => key + 1)
          onCheckinSuccess?.(payload)
          void queryClient.invalidateQueries({ queryKey: ['checkin-status'] })
          void queryClient.invalidateQueries({
            queryKey: ['checkin-leaderboard'],
          })
          void queryClient.invalidateQueries({
            queryKey: ['checkin-analytics'],
          })
          void queryClient.invalidateQueries({ queryKey: ['checkin-balance'] })
          setTurnstileModalVisible(false)
        } else {
          if (!token && shouldTriggerTurnstile(res.message)) {
            if (!turnstileSiteKey) {
              toast.error(t('Turnstile is enabled but site key is empty.'))
              return
            }
            setTurnstileModalVisible(true)
            return
          }
          if (token && shouldTriggerTurnstile(res.message)) {
            setTurnstileWidgetKey((v) => v + 1)
          }
          void refetch()
          handleServerError(res, t('Check-in failed'))
        }
      } catch (error) {
        handleServerError(error, t('Check-in failed'))
      } finally {
        setCheckinLoading(false)
      }
    },
    [
      eligibility?.max_quota,
      eligibility?.min_quota,
      onCheckinSuccess,
      queryClient,
      refetch,
      shouldTriggerTurnstile,
      t,
      todayString,
      turnstileSiteKey,
    ]
  )

  const handlePrevMonth = () => {
    setSelectedMonth(dayjs(currentMonth).subtract(1, 'month').format('YYYY-MM'))
  }

  const handleNextMonth = () => {
    setSelectedMonth(dayjs(currentMonth).add(1, 'month').format('YYYY-MM'))
  }

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay() // 0 = Sunday

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = []

    // Fill leading empty days
    for (let i = 0; i < startDayOfWeek; i++) {
      const d = new Date(year, month, -startDayOfWeek + i + 1)
      days.push({ date: d, isCurrentMonth: false })
    }

    // Fill current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }

    // Fill trailing empty days to complete the grid
    const remaining = 7 - (days.length % 7)
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false })
      }
    }

    return days
  }, [currentMonth])

  const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  if (!checkinEnabled && !checkinData?.grants?.records?.length) {
    return null
  }

  if (isLoading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <div className='p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <Skeleton className='h-10 w-10 rounded-xl' />
              <div className='space-y-2'>
                <Skeleton className='h-5 w-32' />
                <Skeleton className='h-3 w-56' />
              </div>
            </div>
            <Skeleton className='h-9 w-28 rounded-md' />
          </div>
        </div>
      </Card>
    )
  }

  const checkinButtonDisabled = checkinLoading || checkedToday || !checkinData
  let checkinButtonState:
    | 'loading'
    | 'checked'
    | 'unavailable'
    | 'details'
    | 'ready' = 'ready'
  let checkinButtonLabel = t('Check in now')
  let checkinButtonVariant: 'default' | 'outline' = 'default'
  if (checkinLoading) {
    checkinButtonState = 'loading'
    checkinButtonLabel = t('Loading...')
    checkinButtonVariant = 'outline'
  } else if (checkedToday) {
    checkinButtonState = 'checked'
    checkinButtonLabel = t('Checked in')
    checkinButtonVariant = 'outline'
  } else if (!checkinData) {
    checkinButtonState = 'unavailable'
    checkinButtonVariant = 'outline'
  } else if (eligibility?.allowed === false) {
    checkinButtonState = 'details'
    checkinButtonLabel = t('Check-in reward details')
    checkinButtonVariant = 'outline'
  }

  const celebrationRoll = celebration
    ? evaluateCheckinRoll(
        celebration.quotaAwarded,
        celebration.minQuota,
        celebration.maxQuota
      )
    : null
  const confettiIntensity =
    celebrationRoll?.tone === 'jackpot' ? 'jackpot' : 'standard'

  let subtitleText = t('Check in daily to receive random quota rewards')
  if (checkedToday && todayAward !== undefined) {
    const prefix = embedded ? t('Reward') : t('Today')
    subtitleText = `${prefix} +${formatQuotaWithCurrency(todayAward)}`
  }

  return (
    <TooltipProvider delay={100}>
      <CheckinConfettiBurst
        burstKey={confettiBurstKey}
        intensity={confettiIntensity}
      />
      {eligibility && (
        <ConfirmDialog
          open={rewardDialogOpen}
          onOpenChange={setRewardDialogOpen}
          title={t('Check-in reward details')}
          desc={<CheckinRewardDetails eligibility={eligibility} />}
          confirmText={t('Claim this reward')}
          cancelBtnText={t('Not now')}
          disabled={!eligibility.allowed || checkedToday}
          isLoading={checkinLoading}
          handleConfirm={() => {
            setRewardDialogOpen(false)
            void doCheckin()
          }}
        />
      )}
      <Dialog
        open={turnstileModalVisible}
        onOpenChange={(open) => {
          setTurnstileModalVisible(open)
          if (!open) {
            setTurnstileWidgetKey((v) => v + 1)
          }
        }}
        title={t('Security Check')}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        bodyClassName='space-y-4'
      >
        <div className='text-muted-foreground text-sm'>
          {t('Please complete the security check to continue.')}
        </div>
        <div className='flex justify-center py-4'>
          <Turnstile
            key={turnstileWidgetKey}
            siteKey={turnstileSiteKey}
            onVerify={(token) => {
              doCheckin(token)
            }}
            onExpire={() => {
              setTurnstileWidgetKey((v) => v + 1)
            }}
          />
        </div>
      </Dialog>

      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        {/* Header */}
        <div className='border-b p-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
            <Button
              variant='ghost'
              aria-expanded={!collapsed}
              aria-label={t('View check-in records')}
              className='h-auto min-w-0 flex-1 items-start justify-start gap-3 p-0 text-left whitespace-normal'
              onClick={() => setCollapsed((v) => !v)}
            >
              <IconBadge tone='neutral' size='lg' className='sm:size-11'>
                <CalendarDays
                  className='h-4 w-4 sm:h-5 sm:w-5'
                  strokeWidth={2}
                />
              </IconBadge>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5 sm:gap-2'>
                  <h3 className='text-base font-semibold tracking-tight sm:text-lg'>
                    {embedded ? t('Today') : t('Daily Check-in')}
                  </h3>
                  {checkedToday && !embedded && (
                    <Badge variant='secondary'>
                      <Sparkles data-icon='inline-start' aria-hidden='true' />
                      {t('Checked in')}
                    </Badge>
                  )}
                  {streakDays >= 2 && !embedded && (
                    <Badge
                      variant='outline'
                      className='border-orange-500/30 bg-orange-500/10 text-orange-800 tabular-nums dark:text-orange-300'
                    >
                      <Flame
                        data-icon='inline-start'
                        aria-hidden='true'
                        className='size-3 text-orange-500'
                      />
                      {t('{{count}}-day streak', {
                        count: formatNumber(streakDays, locale),
                      })}
                    </Badge>
                  )}
                  <span className='text-muted-foreground inline-flex items-center'>
                    {collapsed ? (
                      <ChevronDown className='h-4 w-4' />
                    ) : (
                      <ChevronUp className='h-4 w-4' />
                    )}
                  </span>
                </div>
                <p className='text-muted-foreground mt-1 line-clamp-2 text-xs sm:text-sm'>
                  {subtitleText}
                </p>
              </div>
            </Button>
            <Button
              key={checkinButtonState}
              type='button'
              variant={checkinButtonVariant}
              onClick={() => setRewardDialogOpen(true)}
              disabled={checkinButtonDisabled}
              size='sm'
              className={cn(
                'min-h-11 w-full shrink-0 transition-colors sm:min-h-9 sm:w-auto',
                checkinButtonDisabled &&
                  'bg-muted text-muted-foreground dark:bg-muted disabled:opacity-100'
              )}
            >
              {checkinButtonState === 'checked' && (
                <Check
                  data-icon='inline-start'
                  aria-hidden='true'
                  className='text-success'
                />
              )}
              {checkinButtonLabel}
            </Button>
          </div>
        </div>

        {celebration && (
          <div className='border-b p-3.5 sm:p-4'>
            <CheckinRewardRevealBanner
              quotaAwarded={celebration.quotaAwarded}
              minQuota={celebration.minQuota}
              maxQuota={celebration.maxQuota}
              streakDays={streakDays}
              actionLabel={
                onViewLeaderboard
                  ? (leaderboardActionLabel ?? t('View full leaderboard'))
                  : undefined
              }
              onAction={onViewLeaderboard}
              onReplayConfetti={() => setConfettiBurstKey((key) => key + 1)}
              onDismiss={() => setCelebration(null)}
            />
          </div>
        )}

        {isError && (
          <div className='px-4 pb-4 sm:px-6'>
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Failed to fetch checkin status')}
              </AlertDescription>
            </Alert>
          </div>
        )}
        {(isError || eligibility?.allowed === false) && (
          <div className='px-4 pb-4 sm:px-6'>
            <Button
              variant='outline'
              size='sm'
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {t('Refresh')}
            </Button>
          </div>
        )}
        {eligibility && (eligibility.limited || eligibility.mode === 2) && (
          <div className='px-4 pb-4 sm:px-6'>
            <Alert className={embedded ? 'border-0 p-0' : undefined}>
              <AlertDescription>
                <CheckinRewardDetails
                  eligibility={eligibility}
                  compact={embedded}
                />
              </AlertDescription>
            </Alert>
          </div>
        )}

        {!collapsed ? (
          <>
            {/* Stats */}
            <div className='grid grid-cols-3 gap-px border-b'>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {checkinData?.stats?.total_checkins || 0}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('Total check-ins')}
                </div>
              </div>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {formatQuotaWithCurrency(monthlyQuota, { digitsLarge: 0 })}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('This month')}
                </div>
              </div>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {formatQuotaWithCurrency(
                    checkinData?.stats?.total_quota || 0,
                    {
                      digitsLarge: 0,
                    }
                  )}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('Total earned')}
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className='p-4 sm:p-6'>
              <div className='space-y-3 sm:space-y-4'>
                {/* Month navigation */}
                <div className='flex items-center justify-between'>
                  <h4 className='text-xs font-semibold sm:text-sm'>
                    {dayjs(currentMonth).format('YYYY-MM')}
                  </h4>
                  <div className='flex items-center gap-0.5 sm:gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 sm:h-8 sm:w-8'
                      onClick={handlePrevMonth}
                    >
                      <ChevronLeft className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 sm:h-8 sm:w-8'
                      onClick={handleNextMonth}
                    >
                      <ChevronRight className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                    </Button>
                  </div>
                </div>

                {/* Calendar grid */}
                <div className='grid grid-cols-7 gap-0.5 sm:gap-1'>
                  {/* Week day headers */}
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className='text-muted-foreground flex h-7 items-center justify-center text-[10px] font-medium sm:h-8 sm:text-xs'
                    >
                      {day}
                    </div>
                  ))}

                  {/* Calendar days */}
                  {calendarDays.map((dayObj) => {
                    const dateStr = `${dayObj.date.getFullYear()}-${String(
                      dayObj.date.getMonth() + 1
                    ).padStart(2, '0')}-${String(
                      dayObj.date.getDate()
                    ).padStart(2, '0')}`
                    const isToday = dateStr === todayString
                    const quotaAwarded = checkinRecordsMap[dateStr]
                    const isCheckedIn = quotaAwarded !== undefined
                    const dayNum = dayObj.date.getDate()
                    const stampedPastDay =
                      !isToday && isCheckedIn && dayObj.isCurrentMonth
                    const stampedToday =
                      isToday && (isCheckedIn || checkedToday)

                    const dayButton = (
                      <Button
                        key={dateStr}
                        variant={isToday ? 'default' : 'ghost'}
                        aria-current={isToday ? 'date' : undefined}
                        disabled={!dayObj.isCurrentMonth}
                        className={cn(
                          'relative flex h-9 w-full flex-col items-center justify-center rounded-lg px-0 text-xs font-medium sm:h-10 sm:text-sm',
                          !dayObj.isCurrentMonth &&
                            'text-muted-foreground/40 cursor-default',
                          stampedPastDay &&
                            'bg-emerald-500/10 font-semibold text-emerald-800 ring-1 ring-emerald-500/20 hover:bg-emerald-500/18 dark:text-emerald-300',
                          stampedToday && 'ring-2 ring-amber-400/60'
                        )}
                      >
                        <span className='tabular-nums'>{dayNum}</span>
                        {stampedPastDay && (
                          <span
                            aria-hidden='true'
                            className='bg-success absolute bottom-0.5 size-1 rounded-full sm:bottom-1'
                          />
                        )}
                      </Button>
                    )

                    if (isCheckedIn && dayObj.isCurrentMonth) {
                      return (
                        <Tooltip key={dateStr}>
                          <TooltipTrigger render={dayButton} />
                          <TooltipContent>
                            <div className='text-xs'>
                              <div className='font-medium'>
                                {t('Checked in')}
                              </div>
                              <div className='text-muted-foreground mt-0.5'>
                                +{formatQuotaWithCurrency(quotaAwarded)}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return dayButton
                  })}
                </div>

                {/* Footer hint */}
                <div className='text-muted-foreground border-t pt-3 text-center text-[11px] sm:pt-4 sm:text-xs'>
                  {t('You can only check in once per day')}
                </div>

                <div className='bg-muted/30 text-muted-foreground rounded-lg border p-3 text-xs'>
                  <ul className='list-disc space-y-1 pl-5'>
                    <li>
                      {t('Check in daily to receive random quota rewards')}
                    </li>
                    <li>
                      {t('Rewards will be added directly to your balance')}
                    </li>
                    <li>{t('Do not repeat check-in; only once per day')}</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </Card>
      {checkinData?.grants &&
        (eligibility?.mode === 2 ||
          Boolean(checkinData.grants.records?.length)) && (
          <CheckinGrantStatus grants={checkinData.grants} />
        )}
    </TooltipProvider>
  )
}
