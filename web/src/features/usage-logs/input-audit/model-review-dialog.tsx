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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserSelector } from '@/components/user-selector'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { useModelReviewLabels } from './case-labels'
import {
  getModelReviewJobs,
  getModelReviewSummary,
  getModelReviewSettings,
  startModelReview,
} from './model-review-api'
import { ModelReviewDashboard } from './model-review-dashboard'
import { ModelReviewQueue } from './model-review-queue'
import { ModelReviewResults } from './model-review-results'
import { ModelReviewSettingsForm } from './model-review-settings'

export function ModelReviewDialog() {
  const { t, i18n } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const labels = useModelReviewLabels()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('overview')
  const [mode, setMode] = useState('incremental')
  const [scope, setScope] = useState<number>()
  const [selectedJob, setSelectedJob] = useState<number>()
  const [selectedUser, setSelectedUser] = useState<number>()
  const client = useQueryClient()
  const settings = useQuery({
    queryKey: ['model-review-settings', userID],
    queryFn: getModelReviewSettings,
    enabled: open,
    retry: false,
  })
  const jobs = useQuery({
    queryKey: ['model-review-jobs', userID],
    queryFn: getModelReviewJobs,
    enabled: open,
    refetchInterval: open ? 5000 : false,
    retry: false,
  })
  const summary = useQuery({
    queryKey: ['model-review-summary', userID],
    queryFn: getModelReviewSummary,
    enabled: open,
    refetchInterval: open ? 10000 : false,
    retry: false,
  })
  const start = useMutation({
    mutationFn: startModelReview,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['model-review-jobs'] })
    },
  })
  const active = jobs.data?.find((job) => job.status === 'running')
  const latest = jobs.data?.[0]
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Model review')}
      trigger={<Button variant='outline'>{t('Model review')}</Button>}
      contentClassName='sm:max-w-5xl'
      contentHeight='min(76dvh, 800px)'
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className='min-w-0'
      >
        <TabsList className='bg-background sticky top-0 z-10 grid w-full grid-cols-2 border sm:grid-cols-4'>
          <TabsTrigger value='overview'>{t('Review task queue')}</TabsTrigger>
          <TabsTrigger value='dashboard'>
            {t('User review dashboard')}
          </TabsTrigger>
          <TabsTrigger value='results'>{t('Results')}</TabsTrigger>
          <TabsTrigger value='settings'>{t('Settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value='overview' className='space-y-4 pt-3'>
          {jobs.isError || settings.isError ? (
            <ErrorState
              onRetry={() => {
                void jobs.refetch()
                void settings.refetch()
              }}
            />
          ) : (
            <>
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                {[
                  {
                    label: t('Status'),
                    value: active ? labels[active.status] : t('Idle'),
                  },
                  {
                    label: t('Unreviewed messages'),
                    value: summary.isError
                      ? '—'
                      : formatNumber(summary.data?.unreviewed ?? 0, locale),
                  },
                  {
                    label: t('Needs human review'),
                    value: formatNumber(latest?.flagged ?? 0, locale),
                  },
                  {
                    label: t('Failed'),
                    value: formatNumber(latest?.failed ?? 0, locale),
                  },
                ].map((item) => (
                  <Card key={item.label} className='gap-2 py-3'>
                    <CardHeader className='px-3'>
                      <CardTitle className='text-muted-foreground text-xs font-normal'>
                        {item.label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='px-3 text-lg font-semibold'>
                      {item.value}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>{t('Start review')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    <Field>
                      <FieldLabel htmlFor='review-mode'>
                        {t('Review scope')}
                      </FieldLabel>
                      <NativeSelect
                        id='review-mode'
                        value={mode}
                        onChange={(event) => setMode(event.target.value)}
                      >
                        <NativeSelectOption value='incremental'>
                          {t('Unreviewed messages')}
                        </NativeSelectOption>
                        <NativeSelectOption value='all'>
                          {t('Re-review retained messages')}
                        </NativeSelectOption>
                        <NativeSelectOption value='failed'>
                          {t('Retry failed reviews')}
                        </NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='review-user'>
                        {t('User (all when empty)')}
                      </FieldLabel>
                      <UserSelector
                        id='review-user'
                        value={scope}
                        onChange={setScope}
                      />
                    </Field>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Start once to review all retained messages in the selected scope. A bounded queue feeds concurrent workers automatically, and each result is saved immediately. Failed reviews can be retried separately.'
                    )}
                  </p>
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <Badge variant='secondary'>
                      {settings.data?.automatic
                        ? t('Automatic review enabled')
                        : t('Manual review')}
                    </Badge>
                    <Button
                      disabled={
                        !settings.data?.enabled ||
                        jobs.isPending ||
                        start.isPending
                      }
                      onClick={() => start.mutate({ mode, user_id: scope })}
                    >
                      {t('Start review')}
                    </Button>
                  </div>
                  {!settings.data?.enabled && (
                    <Button variant='link' onClick={() => setTab('settings')}>
                      {t('Configure and enable model review first')}
                    </Button>
                  )}
                </CardContent>
              </Card>
              <ModelReviewQueue
                jobs={jobs.data ?? []}
                loading={jobs.isPending}
                paused={settings.data?.paused ?? false}
                onSelectJob={(id) => {
                  setSelectedJob(id)
                  setSelectedUser(undefined)
                  setTab('results')
                }}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value='dashboard' className='pt-3'>
          {tab === 'dashboard' && (
            <ModelReviewDashboard
              onSelectUser={(id) => {
                setSelectedUser(id)
                setSelectedJob(undefined)
                setTab('results')
              }}
            />
          )}
        </TabsContent>
        <TabsContent value='results' className='pt-3'>
          {(selectedJob || selectedUser) && (
            <div className='mb-3 flex items-center justify-between'>
              <Badge variant='outline'>#{selectedJob ?? selectedUser}</Badge>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  setSelectedJob(undefined)
                  setSelectedUser(undefined)
                }}
              >
                {t('All results')}
              </Button>
            </div>
          )}
          {tab === 'results' && (
            <ModelReviewResults
              key={`${selectedJob ?? 'all'}-${selectedUser ?? 'all'}`}
              jobID={selectedJob}
              userID={selectedUser}
              status={selectedUser ? 'review' : undefined}
            />
          )}
        </TabsContent>
        <TabsContent value='settings' className='pt-3'>
          {settings.isPending && <LoadingState />}
          {settings.isError && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {settings.data && (
            <ModelReviewSettingsForm settings={settings.data} />
          )}
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
