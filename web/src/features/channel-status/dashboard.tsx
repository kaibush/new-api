import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import { getStatusDashboard } from './api'
import type { Health, Usage } from './dashboard-types'
import { HealthDashboard } from './health-dashboard'
import { UsageDashboard } from './usage-dashboard'

export default function Dashboard(props: { dataset: 'health' | 'usage' }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const [period, setPeriod] = useState('24h')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })
  const query = useQuery({
    queryKey: [
      'channel-status',
      user?.id,
      user?.username,
      user?.role,
      props.dataset,
      period,
      range,
    ],
    queryFn: ({ signal }) =>
      getStatusDashboard<Health | Usage>(
        props.dataset,
        { period, ...range },
        signal
      ),
    enabled: period !== 'custom' || Boolean(range.start && range.end),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const data = query.data
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        {props.dataset !== 'health' && (
          <NativeSelect
            aria-label={t('Statistics period')}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {['24h', '7d', '30d', '90d'].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value === '24h'
                  ? t('Last 24 hours')
                  : t('Last {{days}} days', { days: Number.parseInt(value) })}
              </NativeSelectOption>
            ))}
            {props.dataset === 'usage' && (
              <NativeSelectOption value='custom'>
                {t('Custom')}
              </NativeSelectOption>
            )}
          </NativeSelect>
        )}
        <Button
          variant='outline'
          disabled={query.isFetching || !query.isEnabled}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
        <span className='text-muted-foreground text-xs'>
          {t('Statistics timezone: Asia/Shanghai')}
        </span>
      </div>
      {period === 'custom' && (
        <form
          className='flex flex-wrap items-end gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            setRange({
              start: new Date(`${start}+08:00`).toISOString(),
              end: new Date(`${end}+08:00`).toISOString(),
            })
          }}
        >
          <div>
            <Label htmlFor='status-start'>{t('Start time')}</Label>
            <Input
              id='status-start'
              type='datetime-local'
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor='status-end'>{t('End time')}</Label>
            <Input
              id='status-end'
              type='datetime-local'
              required
              min={start}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
          <Button type='submit'>{t('Apply filters')}</Button>
        </form>
      )}
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {data && !query.isError && (
        <>
          {props.dataset === 'health' && (
            <HealthDashboard data={data as Health} />
          )}
          {props.dataset === 'usage' && <UsageDashboard data={data as Usage} />}
          {data.generatedAt && (
            <p className='text-muted-foreground text-xs'>
              {t('Last updated')}:{' '}
              {new Date(data.generatedAt).toLocaleString(locale)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
