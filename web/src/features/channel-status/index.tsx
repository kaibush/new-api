import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { auditRate, getChannelStatus } from './api'
import { AuditCard } from './audit-card'

export function ChannelStatus() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [window, setWindow] = useState('24h')
  const query = useQuery({
    queryKey: ['channel-status', window],
    queryFn: ({ signal }) => getChannelStatus(window, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const data = query.data
  const clients = [...(data?.clients ?? [])].sort(
    (a, b) => b.requestCount - a.requestCount
  )
  const maxRequests = Math.max(
    0,
    ...clients.map((client) => client.requestCount)
  )
  const inventory = data?.inventory
  return (
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title>{t('Channel status')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <NativeSelect
          aria-label={t('Time range')}
          value={window}
          onChange={(event) => setWindow(event.target.value)}
        >
          {[1, 3, 6, 24].map((hours) => (
            <NativeSelectOption key={hours} value={`${hours}h`}>
              {t('Last {{count}} hours', { count: hours })}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value='7d'>{t('Last 7 days')}</NativeSelectOption>
        </NativeSelect>
        <Button
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-6 pb-6'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Channel availability and request quality from GrokIQ. Refreshes every minute.'
            )}
          </p>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {data && !data.configured && (
            <EmptyState
              title={t('GrokIQ is not configured')}
              description={t(
                'Ask an administrator to configure GrokIQ in System Settings → Operations.'
              )}
            />
          )}
          {data?.configured && (
            <>
              {data.auditError && (
                <ErrorState
                  title={t('Request audit unavailable')}
                  description={data.auditError}
                  onRetry={() => void query.refetch()}
                />
              )}
              {data.summary && (
                <div>
                  <AuditCard
                    client={data.summary}
                    maxRequests={data.summary.requestCount}
                    summary
                  />
                </div>
              )}
              {data.summary?.requestCount === 0 && (
                <EmptyState title={t('No requests in this time range')} />
              )}
              {data.summary && clients.length === 0 && (
                <EmptyState
                  title={t('No matching client activity')}
                  description={t(
                    'Only identified requests belonging to your account appear here.'
                  )}
                />
              )}
              {clients.length > 0 && (
                <section aria-label={t('Active clients')} className='space-y-3'>
                  <h2 className='text-lg font-semibold'>
                    {t('Active clients')}{' '}
                    <span className='text-muted-foreground text-sm'>
                      {formatNumber(clients.length, locale)}
                    </span>
                  </h2>
                  <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                    {clients.map((client) => (
                      <AuditCard
                        key={client.id || client.name}
                        client={client}
                        maxRequests={maxRequests}
                      />
                    ))}
                  </div>
                </section>
              )}
              <section
                aria-label={t('Channel availability')}
                className='space-y-3'
              >
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <h2 className='text-lg font-semibold'>
                    {t('Channel availability')}
                  </h2>
                  <Badge variant='outline'>{t('Current snapshot')}</Badge>
                </div>
                {data.inventoryError && (
                  <ErrorState
                    description={data.inventoryError}
                    onRetry={() => void query.refetch()}
                  />
                )}
                {inventory && (
                  <>
                    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                      {[
                        { label: t('Total'), value: inventory.total },
                        { label: t('Available'), value: inventory.available },
                        { label: t('Recovering'), value: inventory.recovering },
                        {
                          label: t('Needs attention'),
                          value: inventory.attention,
                        },
                      ].map((item) => (
                        <Card key={item.label}>
                          <CardContent className='pt-5'>
                            <p className='text-muted-foreground text-sm'>
                              {item.label}
                            </p>
                            <p className='mt-1 text-2xl font-semibold tabular-nums'>
                              {formatNumber(item.value, locale)}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {!inventory.reachable && (
                      <p role='status' className='text-destructive text-sm'>
                        {t('Upstream is currently unreachable')}
                      </p>
                    )}
                    <div className='grid gap-4 md:grid-cols-3'>
                      {Object.entries(inventory.providers ?? {}).map(
                        ([provider, counts]) => (
                          <Card key={provider}>
                            <CardHeader>
                              <CardTitle>
                                {(
                                  {
                                    grok_build: 'Grok Build',
                                    grok_web: 'Grok Web',
                                    grok_console: 'Grok Console',
                                  } as Record<string, string>
                                )[provider] ?? provider}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className='space-y-3'>
                              <p>
                                {t('{{available}} / {{total}} available', {
                                  available: formatNumber(
                                    counts.available,
                                    locale
                                  ),
                                  total: formatNumber(counts.total, locale),
                                })}
                              </p>
                              <Progress
                                value={
                                  auditRate(counts.available, counts.total) ?? 0
                                }
                                aria-label={t('Channel availability')}
                              />
                            </CardContent>
                          </Card>
                        )
                      )}
                    </div>
                  </>
                )}
              </section>
              {data.summary && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('How these metrics are calculated')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='text-muted-foreground space-y-3 text-sm'>
                    <p>
                      {t(
                        'Quality pass rate uses the final audit result per request. Confirmed quality evidence counts as passing; unknown results stay in the sample. HTTP 502 and 503 are excluded.'
                      )}
                    </p>
                    <p>
                      {t(
                        'HTTP success rate counts 2xx responses without an error code across all attempts, including retries.'
                      )}
                    </p>
                    <p>
                      {t(
                        'No samples are shown as —. Relative activity compares request counts within the selected window.'
                      )}
                    </p>
                  </CardContent>
                </Card>
              )}
              {data.checkedAt && (
                <p className='text-muted-foreground text-xs'>
                  {t('Last updated')}:{' '}
                  {new Date(data.checkedAt).toLocaleString(locale)}
                </p>
              )}
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
