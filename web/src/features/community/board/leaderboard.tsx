import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { getCheckinLeaderboard } from '@/features/checkin/api'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
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
  if (tab === 'highlights' && query.data?.recent_highlights !== undefined) {
    entries = query.data.recent_highlights
    title = t('Recent jackpots')
  }
  if (tab === 'total') {
    entries = query.data?.recent_totals ?? []
    title = t('Recent total rewards')
  }
  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>{props.block?.title || title}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {query.isPending && <LoadingState size='sm' />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {entries.slice(0, props.block?.leaderboard_limit || 5).map((entry) => (
          <div key={entry.rank} className='flex justify-between gap-2 text-xs'>
            <span className='truncate'>
              {formatNumber(entry.rank, locale)}.{' '}
              {entry.display_name || entry.username}
            </span>
            <span className='shrink-0'>
              {formatQuotaWithCurrency(entry.quota_awarded)}
            </span>
          </div>
        ))}
        {!query.isPending && !query.isError && entries.length === 0 && (
          <EmptyState title={t('No check-ins yet')} className='min-h-0 py-3' />
        )}
        {props.block?.leaderboard_route ? (
          <Button
            size='sm'
            variant='outline'
            render={<Link to='/checkin-leaderboard' />}
          >
            {t('View full leaderboard')}
          </Button>
        ) : (
          <Button
            type='button'
            size='sm'
            variant='outline'
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
        contentClassName='sm:max-w-3xl'
      >
        {open && (
          <Suspense fallback={<LoadingState />}>
            <Leaderboard />
          </Suspense>
        )}
      </Dialog>
    </Card>
  )
}
