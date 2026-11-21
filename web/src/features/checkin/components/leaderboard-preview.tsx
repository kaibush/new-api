import { Crown } from 'lucide-react'

import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  getEntryDisplayName,
  getRankMedalStyles,
} from '../lib/leaderboard-utils'
import type { CheckinLeaderboardEntry } from '../types'

interface CheckinLeaderboardPreviewProps {
  entries: CheckinLeaderboardEntry[]
  locale?: string
  limit?: number
}

export function CheckinLeaderboardPreview(
  props: CheckinLeaderboardPreviewProps
) {
  const limit = props.limit ?? 5
  const visible = props.entries.slice(0, limit)
  if (visible.length === 0) return null
  const maxQuota = visible.reduce(
    (highest, entry) => Math.max(highest, entry.quota_awarded),
    0
  )
  const seenKeys = new Map<string, number>()
  const keyedEntries = visible.map((entry, idx) => {
    const rank = entry.rank || idx + 1
    const name = getEntryDisplayName(entry)
    const baseKey = `${rank}-${entry.checkin_date || ''}-${name}-${entry.quota_awarded}`
    const count = (seenKeys.get(baseKey) ?? 0) + 1
    seenKeys.set(baseKey, count)
    return { entry, rank, name, key: `${baseKey}-${count}` }
  })

  return (
    <ol className='flex flex-col gap-1.5'>
      {keyedEntries.map(({ entry, rank, name, key }) => {
        const medal = getRankMedalStyles(rank)
        const widthPercent =
          maxQuota > 0
            ? Math.max(8, Math.min(100, (entry.quota_awarded * 100) / maxQuota))
            : 0

        return (
          <li
            key={key}
            className='bg-background/70 flex flex-col gap-1 rounded-lg border px-2.5 py-1.5'
          >
            <div className='flex items-center justify-between gap-2 text-xs'>
              <div className='flex min-w-0 items-center gap-2'>
                {medal ? (
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
                      medal.badge
                    )}
                  >
                    {rank === 1 ? (
                      <Crown className='size-3' aria-hidden='true' />
                    ) : (
                      formatNumber(rank, props.locale)
                    )}
                    {rank === 1 && (
                      <span className='sr-only'>
                        {formatNumber(rank, props.locale)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className='text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center text-[11px] font-medium tabular-nums'>
                    {formatNumber(rank, props.locale)}
                  </span>
                )}
                <span className='truncate font-medium' title={name}>
                  {name}
                </span>
              </div>
              <span
                className={cn(
                  'shrink-0 font-semibold tabular-nums',
                  rank === 1 && medal?.amount
                )}
              >
                {formatQuotaWithCurrency(entry.quota_awarded)}
              </span>
            </div>
            <div
              aria-hidden='true'
              className='bg-muted/80 h-1 w-full overflow-hidden rounded-full'
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  rank === 1 ? 'bg-amber-500/80' : 'bg-primary/55'
                )}
                style={{ width: `${widthPercent}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
