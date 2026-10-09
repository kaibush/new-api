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
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getVisitReport, type VisitFilters } from './api'
import { VisitDetails } from './visit-details'
import { VisitRanking } from './visit-ranking'
import { VisitSummary } from './visit-summary'

export function VisitAnalytics() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [days, setDays] = useState(7)
  const [tab, setTab] = useState('overview')
  const [user, setUser] = useState('')
  const [filters, setFilters] = useState<VisitFilters>(() => ({
    start: Math.floor(Date.now() / 1000) - 7 * 86400,
    end: Math.floor(Date.now() / 1000) + 1,
    path: '',
    user_id: 0,
  }))
  const query = useQuery({
    queryKey: ['site-visits', 'report', filters],
    queryFn: () => getVisitReport(filters),
    staleTime: 30_000,
  })
  const data = query.data
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Visit analytics')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Tabs
          value={String(days)}
          onValueChange={(value) => {
            const next = Number(value)
            setDays(next)
            setFilters({
              ...filters,
              start: Math.floor(Date.now() / 1000) - next * 86400,
              end: Math.floor(Date.now() / 1000) + 1,
            })
          }}
        >
          <TabsList>
            {[1, 7, 30, 90].map((day) => (
              <TabsTrigger key={day} value={String(day)}>
                {day === 1
                  ? t('Last 24 hours')
                  : t('Last {{days}} days', { days: day })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-5 p-3 sm:p-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Page visits are retained for 90 days. UV counts signed-in accounts or anonymous browsers. Trends use UTC. Rankings show the top 50.'
            )}
          </p>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={(event) => {
              event.preventDefault()
              setFilters({
                ...filters,
                user_id: Number(user),
                end: Math.floor(Date.now() / 1000) + 1,
              })
            }}
          >
            <div className='space-y-1'>
              <Label htmlFor='visit-user'>{t('User ID')}</Label>
              <Input
                id='visit-user'
                className='w-40'
                type='number'
                min='1'
                step='1'
                value={user}
                onChange={(event) => setUser(event.target.value)}
              />
            </div>
            <Button type='submit' variant='outline'>
              {t('Apply filters')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setUser('')
                setFilters({
                  ...filters,
                  path: '',
                  user_id: 0,
                  start: Math.floor(Date.now() / 1000) - days * 86400,
                  end: Math.floor(Date.now() / 1000) + 1,
                })
              }}
            >
              {t('Reset')}
            </Button>
            {filters.path && (
              <span className='text-sm break-all'>
                {t('Page')}: {filters.path}
              </span>
            )}
          </form>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {data && !query.isError && (
            <>
              <VisitSummary data={data} />
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className='max-w-full overflow-x-auto'>
                  <TabsTrigger value='overview'>{t('Overview')}</TabsTrigger>
                  <TabsTrigger value='audience'>
                    {t('Audience and sources')}
                  </TabsTrigger>
                  <TabsTrigger value='details'>
                    {t('Visit details')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value='overview' className='space-y-4'>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('Visit trends')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data.pv === 0 ? (
                        <EmptyState
                          description={t(
                            'Visits will appear here after users browse the site.'
                          )}
                        />
                      ) : (
                        <ChartContainer
                          className='h-72 w-full'
                          config={{
                            pv: {
                              label: t('Page views (PV)'),
                              color: 'var(--chart-1)',
                            },
                            uv: {
                              label: t('Unique visitors (UV)'),
                              color: 'var(--chart-2)',
                            },
                          }}
                        >
                          <LineChart data={data.trend} accessibilityLayer>
                            <CartesianGrid vertical={false} />
                            <ChartLegend content={<ChartLegendContent />} />
                            <XAxis
                              dataKey='name'
                              tickFormatter={(value: string) => value.slice(5)}
                            />
                            <YAxis
                              tickFormatter={(value: number) =>
                                formatNumber(value, locale)
                              }
                              allowDecimals={false}
                            />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Line
                              dataKey='pv'
                              stroke='var(--color-pv)'
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              dataKey='uv'
                              stroke='var(--color-uv)'
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ChartContainer>
                      )}
                    </CardContent>
                  </Card>
                  <div className='grid gap-4 xl:grid-cols-2'>
                    <VisitRanking
                      title={t('Most visited pages')}
                      data={data.pages}
                      onPage={(path) => setFilters({ ...filters, path })}
                    />
                    <VisitRanking
                      title={t('Visitor ranking')}
                      data={data.user_ranking}
                    />
                  </div>
                </TabsContent>
                <TabsContent
                  value='audience'
                  className='grid gap-4 xl:grid-cols-2'
                >
                  <VisitRanking title={t('Referrers')} data={data.referrers} />
                  <VisitRanking title={t('Browsers')} data={data.browsers} />
                  <VisitRanking
                    title={t('Devices')}
                    data={data.devices.map((row) => ({
                      ...row,
                      name: t(row.name),
                    }))}
                  />
                  <VisitRanking
                    title={t('Operating systems')}
                    data={data.systems}
                  />
                </TabsContent>
                <TabsContent value='details'>
                  <VisitDetails
                    key={JSON.stringify(filters)}
                    filters={filters}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
