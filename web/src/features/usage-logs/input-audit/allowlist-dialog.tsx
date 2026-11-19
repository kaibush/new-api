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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import {
  listRequestPluginInstances,
  listRequestPluginOptions,
} from '@/features/task-plugins/api'
import dayjs from '@/lib/dayjs'
import { useAuthStore } from '@/stores/auth-store'

import {
  getInputAuditAllowlist,
  getInputAuditAllowlistHistory,
  updateInputAuditAllowlist,
  type InputAuditAllowlistEntry,
} from './api'
import { AuditFeatureSurface } from './feature-surface'

const schema = z.object({
  user_id: z.number().int().positive().safe(),
  reason: z.string().trim().min(1).max(500),
  instances: z.array(z.string()).min(1).max(32),
  expires_at: z.string().refine((value) => {
    const timestamp = new Date(value).getTime()
    return (
      Number.isFinite(timestamp) &&
      timestamp > Date.now() &&
      timestamp <= Date.now() + 365 * 86400000
    )
  }),
})

type Values = z.infer<typeof schema>

export function InputAuditAllowlistDialog(props: {
  embedded?: boolean
  active?: boolean
  collectionEnabled: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('entries')
  const [revoke, setRevoke] = useState<InputAuditAllowlistEntry>()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const queryClient = useQueryClient()
  const key = ['input-audit-allowlist', userID]
  const policy = useQuery({
    queryKey: key,
    queryFn: getInputAuditAllowlist,
    enabled: (props.embedded || open) && props.active !== false,
    retry: false,
  })
  const history = useQuery({
    queryKey: ['input-audit-allowlist-history', userID],
    queryFn: getInputAuditAllowlistHistory,
    enabled: (props.embedded || open) && props.active !== false,
    retry: false,
  })
  const instances = useQuery({
    queryKey: ['input-audit-filter-instances', userID],
    queryFn: async () => {
      const [instances, plugins] = await Promise.all([
        listRequestPluginInstances(),
        listRequestPluginOptions(),
      ])
      const eligiblePlugins = new Set(
        plugins
          .filter((plugin) => plugin.supportsUserAllowlist === true)
          .map((plugin) => plugin.key)
      )
      return instances.filter((instance) =>
        eligiblePlugins.has(instance.plugin)
      )
    },
    enabled: (props.embedded || open) && props.active !== false,
    retry: false,
  })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      user_id: undefined,
      reason: '',
      instances: [],
      expires_at: dayjs().add(7, 'day').format('YYYY-MM-DDTHH:mm'),
    },
  })
  const mutation = useMutation({
    mutationFn: updateInputAuditAllowlist,
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated)
      void queryClient.invalidateQueries({
        queryKey: ['input-audit-allowlist-history', userID],
      })
      setRevoke(undefined)
      setTab('entries')
      form.reset({
        user_id: undefined,
        reason: '',
        instances: [],
        expires_at: dayjs().add(7, 'day').format('YYYY-MM-DDTHH:mm'),
      })
    },
  })
  const options = (instances.data ?? []).map((instance) => ({
    value: instance.id,
    label: instance.name,
  }))
  return (
    <>
      <AuditFeatureSurface
        embedded={props.embedded}
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value)
        }}
        title={t('User allowlist')}
        contentClassName='sm:max-w-3xl'
        contentHeight='min(72dvh, 720px)'
        trigger={<Button variant='outline'>{t('User allowlist')}</Button>}
      >
        <p className='text-muted-foreground mb-4 text-sm'>
          {t(
            'Allowlisted users remain audited and bypass only the selected content filtering instances. Other request controls still apply.'
          )}
        </p>
        <p className='text-muted-foreground mb-4 text-xs'>
          {t(
            'Allowlist changes apply to new requests. Other gateway nodes refresh within 60 seconds.'
          )}
        </p>
        {!props.collectionEnabled && (
          <Alert className='mb-4'>
            <AlertDescription>
              {t('Enable input auditing before adding allowlist entries')}
            </AlertDescription>
          </Alert>
        )}
        {(policy.isError || instances.isError) && (
          <Alert variant='destructive' className='mb-4'>
            <AlertDescription>
              {t('Failed to load audit records')}{' '}
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  void policy.refetch()
                  void instances.refetch()
                }}
              >
                {t('Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='entries'>{t('User allowlist')}</TabsTrigger>
            <TabsTrigger value='edit'>{t('Edit')}</TabsTrigger>
            <TabsTrigger value='history'>{t('Allowlist history')}</TabsTrigger>
          </TabsList>
          <TabsContent value='edit' className='pt-4'>
            <form
              aria-label={t('User allowlist')}
              onSubmit={form.handleSubmit((values) => {
                if (
                  !policy.data ||
                  !props.collectionEnabled ||
                  instances.isError
                ) {
                  return
                }
                const previous = policy.data.entries.find(
                  (entry) => entry.user_id === values.user_id
                )
                mutation.mutate({
                  version: policy.data.version,
                  entries: [
                    ...policy.data.entries.filter(
                      (entry) =>
                        entry.user_id !== values.user_id &&
                        entry.expires_at > Date.now() / 1000
                    ),
                    {
                      ...previous,
                      id: previous?.id ?? '',
                      ...values,
                      expires_at: Math.floor(
                        new Date(values.expires_at).getTime() / 1000
                      ),
                    },
                  ],
                })
              })}
            >
              <FieldGroup className='grid gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='allowlist-user'>{t('User')}</FieldLabel>
                  <UserSelector
                    id='allowlist-user'
                    value={form.watch('user_id')}
                    onChange={(id) =>
                      form.setValue('user_id', id ?? 0, {
                        shouldValidate: true,
                      })
                    }
                    disabled={mutation.isPending}
                    aria-invalid={!!form.formState.errors.user_id}
                  />
                  {form.formState.errors.user_id && (
                    <FieldError>{t('Invalid user ID')}</FieldError>
                  )}
                </Field>
                <Field className='sm:col-span-2'>
                  <FieldLabel htmlFor='allowlist-reason'>
                    {t('Reason')}
                  </FieldLabel>
                  <Textarea
                    id='allowlist-reason'
                    maxLength={500}
                    disabled={mutation.isPending}
                    {...form.register('reason')}
                  />
                  {form.formState.errors.reason && (
                    <FieldError>{t('A reason is required')}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor='allowlist-instances'>
                    {t('Content filtering instances')}
                  </FieldLabel>
                  <MultiSelect
                    id='allowlist-instances'
                    placeholder={t('Content filtering instances')}
                    options={options}
                    selected={form.watch('instances')}
                    onChange={(value) =>
                      form.setValue('instances', value, {
                        shouldValidate: true,
                      })
                    }
                    disabled={
                      mutation.isPending ||
                      instances.isPending ||
                      instances.isError
                    }
                  />
                  {form.formState.errors.instances && (
                    <FieldError>
                      {t('Select at least one content filtering instance')}
                    </FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor='allowlist-expiry'>
                    {t('Expires at')}
                  </FieldLabel>
                  <Input
                    id='allowlist-expiry'
                    type='datetime-local'
                    disabled={mutation.isPending}
                    {...form.register('expires_at')}
                  />
                  {form.formState.errors.expires_at && (
                    <FieldError>
                      {t('Choose an expiry within the next 365 days')}
                    </FieldError>
                  )}
                </Field>
                <Button
                  type='submit'
                  disabled={
                    mutation.isPending ||
                    !policy.data ||
                    policy.isError ||
                    instances.isError ||
                    !props.collectionEnabled
                  }
                >
                  {t('Add to allowlist')}
                </Button>
              </FieldGroup>
            </form>
          </TabsContent>
          <TabsContent value='entries' className='pt-3'>
            <div className='flex justify-end'>
              <Button
                onClick={() => {
                  form.reset()
                  setTab('edit')
                }}
              >
                {t('Add to allowlist')}
              </Button>
            </div>
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {policy.data?.entries.map((entry) => (
                <div
                  key={entry.id || entry.user_id}
                  className='space-y-2 rounded-lg border p-3'
                >
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span>
                      <UserIdentity userId={entry.user_id} />
                    </span>
                    <Badge variant='secondary'>
                      {entry.expires_at > Date.now() / 1000
                        ? t('Active')
                        : t('Expired')}
                    </Badge>
                  </div>
                  <p className='text-sm break-words whitespace-pre-wrap'>
                    {entry.reason}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {entry.instances
                      .map(
                        (id) =>
                          options.find((option) => option.value === id)
                            ?.label ?? id
                      )
                      .join(', ')}{' '}
                    ·{' '}
                    {dayjs.unix(entry.expires_at).format('YYYY-MM-DD HH:mm:ss')}
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={mutation.isPending}
                      onClick={() => {
                        setTab('edit')
                        form.reset({
                          ...entry,
                          expires_at: dayjs
                            .unix(entry.expires_at)
                            .format('YYYY-MM-DDTHH:mm'),
                        })
                      }}
                    >
                      {t('Edit')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={mutation.isPending}
                      onClick={() => setRevoke(entry)}
                    >
                      {t('Revoke')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value='history'>
            <section
              aria-label={t('Allowlist history')}
              className='mt-4 space-y-2'
            >
              <h3>{t('Allowlist history')}</h3>
              {history.isError && (
                <Button
                  variant='outline'
                  onClick={() => {
                    void history.refetch()
                  }}
                >
                  {t('Retry')}
                </Button>
              )}
              {history.data?.map((revision) => (
                <article
                  key={revision.policy.version}
                  className='rounded-lg border p-2 text-xs'
                >
                  <p>
                    {t('Allowlist policy version')}: {revision.policy.version} ·{' '}
                    {dayjs
                      .unix(revision.created_at)
                      .format('YYYY-MM-DD HH:mm:ss')}
                  </p>
                  {revision.policy.entries.map((entry) => (
                    <p key={entry.id}>
                      <UserIdentity userId={entry.user_id} /> · {entry.reason} ·{' '}
                      <UserIdentity userId={entry.updated_by ?? 0} /> ·{' '}
                      {dayjs.unix(entry.expires_at).format('YYYY-MM-DD HH:mm')}{' '}
                      · {entry.instances.join(', ')}
                    </p>
                  ))}
                </article>
              ))}
            </section>
          </TabsContent>
        </Tabs>
      </AuditFeatureSurface>
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(value) => {
          if (!value && !mutation.isPending) setRevoke(undefined)
        }}
        title={t('Revoke allowlist exemption')}
        desc={t(
          'Content filtering will apply to this user on new requests. Audit records are retained.'
        )}
        confirmText={t('Revoke')}
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (policy.data && revoke) {
            mutation.mutate({
              version: policy.data.version,
              entries: policy.data.entries.filter(
                (entry) =>
                  entry.id !== revoke.id && entry.expires_at > Date.now() / 1000
              ),
            })
          }
        }}
      />
    </>
  )
}
