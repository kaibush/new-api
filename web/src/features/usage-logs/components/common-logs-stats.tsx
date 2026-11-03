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
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatLogQuota, formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getLogStats, getUserLogStats } from '../api'
import { DEFAULT_LOG_STATS } from '../constants'
import { buildApiParams } from '../lib/utils'
import { useLogsViewScope, useUsageLogsContext } from './usage-logs-provider'

const route = getRouteApi('/_authenticated/usage-logs/$section')

function StatBadge(props: {
  label: string
  value: string | number
  accent: string
  inlineOnMobile?: boolean
}) {
  return (
    <span
      className={cn(
        'flex min-w-0 text-xs sm:inline-flex sm:h-7 sm:flex-row sm:items-center sm:gap-2 sm:rounded-md sm:border sm:border-border/60 sm:bg-muted/25 sm:px-2.5 sm:shadow-xs',
        props.inlineOnMobile
          ? 'flex-row items-center gap-1.5'
          : 'flex-col gap-0.5'
      )}
    >
      <span
        aria-hidden='true'
        className={cn('hidden h-3.5 w-0.5 rounded-full sm:block', props.accent)}
      />
      <span className='text-muted-foreground text-[11px] leading-4 sm:text-xs sm:leading-normal'>
        {props.label}
      </span>
      <span
        className={cn(
          'text-foreground/85 min-w-0 font-mono font-semibold break-all tabular-nums sm:text-xs sm:leading-normal sm:break-normal',
          props.inlineOnMobile ? 'text-xs leading-4' : 'text-sm leading-5'
        )}
      >
        {props.value}
      </span>
    </span>
  )
}

export function CommonLogsStats() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { isAdminView: isAdmin } = useLogsViewScope()
  const searchParams = route.useSearch()
  const { sensitiveVisible } = useUsageLogsContext()

  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['usage-logs-stats', isAdmin, searchParams],
    queryFn: async () => {
      const params = buildApiParams({
        page: 1,
        pageSize: 1,
        searchParams,
        columnFilters: [],
        isAdmin,
      })

      const result = isAdmin
        ? requireServerSuccess(await getLogStats(params))
        : requireServerSuccess(await getUserLogStats(params))

      return result.success
        ? result.data || DEFAULT_LOG_STATS
        : DEFAULT_LOG_STATS
    },
  })

  if (isLoading) {
    return (
      <div
        role='group'
        aria-label={t('Usage')}
        className='grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2'
        aria-busy='true'
      >
        <Skeleton className='h-9 w-full rounded-md sm:h-7 sm:w-[150px]' />
        <Skeleton className='h-9 w-full rounded-md sm:h-7 sm:w-[150px]' />
        <Skeleton className='h-9 w-full rounded-md sm:h-7 sm:w-[150px]' />
        <Skeleton className='h-9 w-full rounded-md sm:h-7 sm:w-[150px]' />
        <div className='col-span-2 flex items-center gap-4 sm:contents'>
          <Skeleton className='h-4 w-16 rounded-md sm:h-7 sm:w-[100px]' />
          <Skeleton className='h-4 w-24 rounded-md sm:h-7 sm:w-[120px]' />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <span className='text-destructive text-xs'>{t('Failed to load')}</span>
    )
  }

  return (
    <div
      role='group'
      aria-label={t('Usage')}
      className='grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2'
    >
      <StatBadge
        label={t('Usage')}
        value={sensitiveVisible ? formatLogQuota(stats?.quota || 0) : '••••'}
        accent='bg-sky-500/70'
      />
      <div
        role='group'
        aria-label={t('Token usage')}
        className='contents sm:flex sm:flex-wrap sm:items-center sm:gap-2'
      >
        <StatBadge
          label={t('Total Tokens')}
          value={formatNumber(stats?.total_tokens ?? 0, locale)}
          accent='bg-primary/70'
        />
        <StatBadge
          label={t('Input Tokens')}
          value={formatNumber(stats?.prompt_tokens ?? 0, locale)}
          accent='bg-primary/50'
        />
        <StatBadge
          label={t('Output Tokens')}
          value={formatNumber(stats?.completion_tokens ?? 0, locale)}
          accent='bg-primary/35'
        />
      </div>
      <div className='col-span-2 flex items-center gap-4 sm:contents'>
        <StatBadge
          label={t('RPM')}
          value={formatNumber(stats?.rpm ?? 0, locale)}
          accent='bg-rose-500/65'
          inlineOnMobile
        />
        <StatBadge
          label={t('TPM')}
          value={formatNumber(stats?.tpm ?? 0, locale)}
          accent='bg-slate-400/70'
          inlineOnMobile
        />
      </div>
    </div>
  )
}
