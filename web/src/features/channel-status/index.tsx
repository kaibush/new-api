import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getChannelStatus } from './api'
import { AuditCard } from './audit-card'
import { Availability } from './availability'

const Dashboard = lazy(() => import('./dashboard'))

export function ChannelStatus() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const [tab, setTab] = useState('availability')
  const [window, setWindow] = useState('24h')
  const query = useQuery({
    queryKey: ['channel-status', user?.id, user?.username, user?.role, window],
    queryFn: ({ signal }) => getChannelStatus(window, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const data = query.data
  const updatedAt =
    tab === 'availability'
      ? data?.inventory?.updatedAt || data?.checkedAt
      : data?.checkedAt
  const clients = [...(data?.clients ?? [])].sort(
    (a, b) => b.requestCount - a.requestCount
  )
  const maxRequests = Math.max(
    0,
    ...clients.map((client) => client.requestCount)
  )
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
        <div className='mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 pb-6'>
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
              <Tabs
                className='min-w-0 gap-4'
                value={tab}
                onValueChange={(value) => setTab(String(value))}
              >
                <TabsList
                  aria-label={t('Channel status')}
                  className='max-w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto [&>[role=tab]]:h-auto [&>[role=tab]]:min-h-9 [&>[role=tab]]:max-w-full [&>[role=tab]]:flex-none [&>[role=tab]]:px-3 [&>[role=tab]]:whitespace-normal'
                >
                  <TabsTrigger value='availability'>
                    {t('Channel availability')}
                  </TabsTrigger>
                  <TabsTrigger value='health'>
                    {t('Request health')}
                  </TabsTrigger>
                  <TabsTrigger value='usage'>
                    {t('Usage statistics')}
                  </TabsTrigger>
                  <TabsTrigger value='clients'>
                    {t('Active clients')}
                  </TabsTrigger>
                  <TabsTrigger value='metrics'>
                    {t('How these metrics are calculated')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value='clients' className='min-w-0 space-y-4'>
                  {data.summary && clients.length === 0 && (
                    <EmptyState
                      title={t('No matching client activity')}
                      description={t(
                        'Only identified requests belonging to your account appear here.'
                      )}
                    />
                  )}
                  {clients.length > 0 && (
                    <section
                      aria-label={t('Active clients')}
                      className='space-y-3'
                    >
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
                </TabsContent>
                <TabsContent value='availability' className='min-w-0'>
                  <Availability
                    inventory={data.inventory}
                    error={data.inventoryError}
                    onRetry={() => void query.refetch()}
                  />
                </TabsContent>
                {['health', 'usage'].map((name) => (
                  <TabsContent key={name} value={name} className='min-w-0'>
                    {tab === name && (
                      <Suspense fallback={<LoadingState />}>
                        <Dashboard dataset={name as 'health' | 'usage'} />
                      </Suspense>
                    )}
                  </TabsContent>
                ))}
                <TabsContent value='metrics' className='min-w-0'>
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
                </TabsContent>
              </Tabs>
              {updatedAt && tab !== 'health' && tab !== 'usage' && (
                <p className='text-muted-foreground text-xs'>
                  {t('Last updated')}:{' '}
                  <time dateTime={updatedAt}>
                    {new Date(updatedAt).toLocaleString(locale)}
                  </time>
                </p>
              )}
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
