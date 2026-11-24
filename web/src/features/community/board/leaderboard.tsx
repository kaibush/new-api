import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Award, Sparkles, Trophy } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { getCheckinLeaderboard } from '@/features/checkin/api'
import { CheckinLeaderboardPreview } from '@/features/checkin/components/leaderboard-preview'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { BoardBlock } from './schema'

const Leaderboard = lazy(() =>
  import('@/features/checkin/components/leaderboard').then((m) => ({
    default: m.CheckinLeaderboard,
  }))
)
export function BoardLeaderboard(props: { block?: BoardBlock }) {
  const { t, i18n } = useTranslation()
  const { status } = useStatus()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['checkin-leaderboard'],
    queryFn: getCheckinLeaderboard,
    enabled: status?.checkin_enabled === true,
    staleTime: 30000,
  })
  if (!status?.checkin_enabled || query.data?.enabled === false) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const tab = props.block?.leaderboard_tab || 'today'
  let entries = query.data?.top ?? []
  let title = t("Today's check-in leaderboard")
  let HeaderIcon = Trophy
  if (tab === 'highlights' && query.data?.recent_highlights !== undefined) {
    entries = query.data.recent_highlights
    title = t('Recent jackpots')
    HeaderIcon = Sparkles
  }
  if (tab === 'total') {
    entries = query.data?.recent_totals ?? []
    title = t('Recent total rewards')
    HeaderIcon = Award
  }
  return (
    <Card size='sm'>
      <CardHeader>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='flex min-w-0 items-center gap-1.5'>
            <HeaderIcon
              className='size-4 shrink-0 text-amber-600 dark:text-amber-400'
              aria-hidden='true'
            />
            <span className='truncate'>{props.block?.title || title}</span>
          </CardTitle>
          {tab === 'today' && query.data?.today_checkins !== undefined && (
            <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
              {t('{{count}} checked in', {
                count: formatNumber(query.data.today_checkins, locale),
              })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {query.isPending && <LoadingState size='sm' />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {!query.isPending && !query.isError && entries.length > 0 && (
          <CheckinLeaderboardPreview
            entries={entries}
            locale={locale}
            limit={props.block?.leaderboard_limit || 5}
          />
        )}
        {!query.isPending && !query.isError && entries.length === 0 && (
          <EmptyState title={t('No check-ins yet')} className='min-h-0 py-3' />
        )}
        {props.block?.leaderboard_route ? (
          <Button
            size='sm'
            variant='outline'
            className='w-full'
            render={<Link to='/checkin-leaderboard' />}
          >
            {t('View full leaderboard')}
          </Button>
        ) : (
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='w-full'
            onClick={() => setOpen(true)}
          >
            {t('View full leaderboard')}
          </Button>
        )}
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Check-in leaderboard')}
        contentClassName='w-[calc(100%-2rem)] sm:max-w-4xl'
      >
        {open && (
          <Suspense fallback={<LoadingState />}>
            <Leaderboard mode='dialog' initialTab={tab} />
          </Suspense>
        )}
      </Dialog>
    </Card>
  )
}
