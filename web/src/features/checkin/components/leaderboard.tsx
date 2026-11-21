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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { getCheckinLeaderboard } from '../api'
import { formatCheckinPercent } from '../format'

export function CheckinLeaderboard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [tab, setTab] = useState('today')
  const query = useQuery({
    queryKey: ['checkin-leaderboard'],
    queryFn: getCheckinLeaderboard,
    staleTime: 15000,
    refetchInterval: 30000,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const board = query.data
  if (!board.enabled) {
    return (
      <EmptyState title={t('Leaderboard is disabled')} className='min-h-40' />
    )
  }
  const hasHighlights = board.recent_highlights !== undefined
  const activeTab = !hasHighlights && tab === 'highlights' ? 'today' : tab
  let entries = board.top ?? []
  if (activeTab === 'highlights') entries = board.recent_highlights ?? []
  if (activeTab === 'total') entries = board.recent_totals ?? []
  return (
    <section className='space-y-5' aria-label={t('Check-in leaderboard')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {board.today} · {board.timezone} ·{' '}
          {t('Last {{count}} days', { count: board.retention_days ?? 30 })}
        </p>
        <Button
          size='sm'
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      {board.my_rank !== undefined && (
        <div className='bg-primary/10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4'>
          <div>
            <p className='text-sm'>{t('My daily rank')}</p>
            <p className='mt-1 text-2xl font-semibold'>
              #{formatNumber(board.my_rank, locale)}
            </p>
          </div>
          <div className='text-right'>
            <p className='font-semibold'>
              {formatQuotaWithCurrency(board.my_quota ?? 0)}
            </p>
            <p className='text-muted-foreground text-sm'>
              {t('Ahead of {{percent}} of users', {
                percent: formatCheckinPercent(
                  (board.surpassed_bps ?? 0) / 100,
                  locale
                ),
              })}
            </p>
          </div>
        </div>
      )}
      <Tabs value={activeTab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className='max-w-full flex-wrap group-data-horizontal/tabs:h-auto'>
          <TabsTrigger value='today'>{t('Today’s lucky winners')}</TabsTrigger>
          {hasHighlights && (
            <TabsTrigger value='highlights'>{t('Recent jackpots')}</TabsTrigger>
          )}
          <TabsTrigger value='total'>{t('Recent total rewards')}</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className='space-y-4 pt-3'>
          {entries.length === 0 ? (
            <EmptyState
              title={t('No check-ins yet')}
              description={t('Check in today and try your luck.')}
              className='min-h-48'
            />
          ) : (
            <>
              <div className='grid gap-3 sm:grid-cols-3'>
                {entries.slice(0, 3).map((entry, index) => (
                  <Card
                    key={entry.rank}
                    className={
                      index === 0
                        ? 'border-amber-400/50 bg-amber-500/10'
                        : 'bg-muted/30'
                    }
                  >
                    <CardContent className='space-y-2 pt-5 text-center'>
                      <p className='text-muted-foreground text-sm'>
                        #{formatNumber(index + 1, locale)}
                      </p>
                      <p className='truncate font-semibold'>
                        {entry.display_name || entry.username}
                      </p>
                      <p className='text-xl font-bold'>
                        {formatQuotaWithCurrency(entry.quota_awarded)}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {entry.tier_name}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <ol className='divide-y rounded-lg border'>
                {entries.map((entry, index) => (
                  <li
                    key={entry.rank}
                    className='flex items-center justify-between gap-3 px-4 py-3'
                  >
                    <div className='flex min-w-0 items-center gap-3'>
                      <span className='text-muted-foreground w-6 text-sm tabular-nums'>
                        {formatNumber(index + 1, locale)}
                      </span>
                      <div className='min-w-0'>
                        <p className='truncate text-sm font-medium'>
                          {entry.display_name || entry.username}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {entry.checkin_date} {entry.tier_name}
                        </p>
                      </div>
                    </div>
                    <span className='shrink-0 text-sm font-semibold tabular-nums'>
                      {formatQuotaWithCurrency(entry.quota_awarded)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}
