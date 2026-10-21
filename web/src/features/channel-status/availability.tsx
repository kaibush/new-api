import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ChannelStatusData } from './api'

export function Availability(props: {
  inventory: ChannelStatusData['inventory']
  error?: string
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const inventory = props.inventory
  const accounts = inventory?.accounts
  const metrics = accounts
    ? ([
        [t('Total'), accounts.total],
        [t('Available'), accounts.available],
        [t('Recovering'), accounts.recovering],
        [t('Needs attention'), accounts.attention],
        [t('Risk accounts'), accounts.risk],
      ] as const)
    : []
  return (
    <section
      aria-label={t('Channel availability')}
      className='flex min-w-0 flex-col gap-4'
    >
      {props.error && (
        <ErrorState description={props.error} onRetry={props.onRetry} />
      )}
      {inventory && (
        <>
          <Badge
            className='max-w-full self-start whitespace-normal'
            variant={inventory.reachable ? 'outline' : 'destructive'}
          >
            {inventory.reachable
              ? t('Current snapshot')
              : t('Upstream is currently unreachable')}
          </Badge>
          {accounts && (
            <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
              {metrics.map(([label, value]) => (
                <Card key={label}>
                  <CardContent className='pt-5'>
                    <p className='text-muted-foreground text-sm'>{label}</p>
                    <p className='mt-1 text-2xl font-semibold tabular-nums'>
                      {formatNumber(value, locale)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className='grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {Object.entries(inventory.providers).map(([provider, counts]) => (
              <Card key={provider} className='min-w-0'>
                <CardHeader>
                  <CardTitle className='wrap-anywhere'>
                    {{
                      grok_build: 'Grok Build',
                      grok_web: 'Grok Web',
                      grok_console: 'Grok Console',
                    }[provider] ?? provider}
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <p className='text-2xl font-semibold tabular-nums'>
                    {formatNumber(counts.capacity, locale)}%
                  </p>
                  <p className='text-muted-foreground text-sm'>
                    {t('Available capacity')}
                  </p>
                  <Progress value={counts.capacity} aria-label={provider} />
                </CardContent>
              </Card>
            ))}
          </div>
          {accounts && (
            <div className='grid gap-4 md:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('Recovery queue')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {accounts.recovery ? (
                    [
                      [t('Cooldown'), accounts.recovery.cooldown],
                      [t('Waiting for reset'), accounts.recovery.waitingReset],
                      [t('Probing'), accounts.recovery.probing],
                    ].map(([label, value]) => (
                      <div className='flex justify-between gap-4' key={label}>
                        <span>{label}</span>
                        <span>{formatNumber(Number(value), locale)}</span>
                      </div>
                    ))
                  ) : (
                    <p>{t('No data')}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('Account issues')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {accounts.issues ? (
                    [
                      [t('Disabled'), accounts.issues.disabled],
                      [
                        t('Reauthentication required'),
                        accounts.issues.reauthRequired,
                      ],
                    ].map(([label, value]) => (
                      <div className='flex justify-between gap-4' key={label}>
                        <span>{label}</span>
                        <span>{formatNumber(Number(value), locale)}</span>
                      </div>
                    ))
                  ) : (
                    <p>{t('No data')}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </section>
  )
}
