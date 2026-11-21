import { Crown, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  buildTierToneMap,
  extractTierSummaries,
  getEntryDisplayName,
  getRankMedalStyles,
  getTierToneStyles,
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
  const shouldReduce = useReducedMotion()
  const limit = props.limit ?? 5
  const visible = props.entries.slice(0, limit)
  if (visible.length === 0) return null
  const maxQuota = visible.reduce(
    (highest, entry) => Math.max(highest, entry.quota_awarded),
    0
  )
  const tierToneMap = buildTierToneMap(extractTierSummaries(visible))
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
      {keyedEntries.map(({ entry, rank, name, key }, index) => {
        const medal = getRankMedalStyles(rank)
        const tierName = (entry.tier_name || '').trim()
        const tierTone = tierName
          ? (tierToneMap.get(tierName) ?? 'base')
          : 'base'
        const widthPercent =
          maxQuota > 0
            ? Math.max(8, Math.min(100, (entry.quota_awarded * 100) / maxQuota))
            : 0
        let barClass = 'bg-primary/60'
        if (rank === 1) {
          barClass = 'bg-gradient-to-r from-amber-500 to-yellow-400'
        } else if (tierName && tierTone !== 'base') {
          barClass = getTierToneStyles(tierTone).bar
        }

        return (
          <li
            key={key}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors',
              rank === 1
                ? 'border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/4 to-background/80'
                : 'bg-background/75 hover:bg-background'
            )}
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
                {tierName && tierTone === 'jackpot' && (
                  <Sparkles
                    aria-hidden='true'
                    className='size-3 shrink-0 text-amber-500'
                  />
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 font-bold tabular-nums',
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
              {shouldReduce ? (
                <div
                  className={cn('h-full rounded-full', barClass)}
                  style={{ width: `${widthPercent}%` }}
                />
              ) : (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPercent}%` }}
                  transition={{
                    type: 'spring',
                    stiffness: 240,
                    damping: 28,
                    delay: index * 0.04,
                  }}
                  className={cn('h-full rounded-full', barClass)}
                />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
