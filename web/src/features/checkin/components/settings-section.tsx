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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  getCheckinConfiguration,
  saveCheckinConfiguration,
} from '@/features/checkin/api'
import type { CheckinConfiguration } from '@/features/checkin/types'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'

const limitsSchema = z.object({
  enabled: z.boolean(),
  monthly_cap: z.coerce.number().int().min(0).max(2147483647),
  activity_days: z.coerce.number().int().min(1).max(365),
  minimum_spend: z.coerce.number().int().min(0).max(2147483647),
  reduced_percent: z.coerce.number().int().min(0).max(100),
  new_user_days: z.coerce.number().int().min(0).max(365),
})

const limitFields = [
  {
    name: 'monthly_cap',
    label: 'Monthly check-in reward cap',
    quota: true,
    min: 1,
    max: 2147483647,
  },
  {
    name: 'activity_days',
    label: 'Activity window (days)',
    quota: false,
    min: 1,
    max: 365,
  },
  {
    name: 'minimum_spend',
    label: 'Minimum spending in the activity window',
    quota: true,
    min: 0,
    max: 2147483647,
  },
  {
    name: 'reduced_percent',
    label: 'Minimum reward percentage',
    quota: false,
    min: 0,
    max: 100,
  },
  {
    name: 'new_user_days',
    label: 'New user grace period (days)',
    quota: false,
    min: 0,
    max: 365,
  },
] as const

const schema = z
  .object({
    limits: z.object({
      enabled: z.boolean(),
      monthly_cap: z.coerce.number(),
      activity_days: z.coerce.number(),
      minimum_spend: z.coerce.number(),
      reduced_percent: z.coerce.number(),
      new_user_days: z.coerce.number(),
    }),
    mode: z.number().int().min(1).max(2),
    expiryMinutes: z.coerce.number().int().min(1).max(525600),
    enabled: z.boolean(),
    minQuota: z.coerce.number().int().min(0).max(2147483647),
    maxQuota: z.coerce.number().int().min(0).max(2147483647),
  })
  .superRefine((values, context) => {
    if (values.mode === 2) return
    const result = limitsSchema.safeParse(values.limits)
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: ['limits', ...issue.path] })
      }
    }
  })
  .refine(
    (values) =>
      values.mode === 2 ||
      !values.limits.enabled ||
      values.limits.monthly_cap > 0,
    { path: ['limits', 'monthly_cap'], message: 'Must be greater than 0' }
  )
  .refine((values) => values.maxQuota >= values.minQuota, {
    path: ['maxQuota'],
    message: 'Maximum must be at least the minimum',
  })

type Values = z.infer<typeof schema>

export function CheckinSettingsSection() {
  const query = useQuery({
    queryKey: ['checkin-configuration'],
    queryFn: getCheckinConfiguration,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return <CheckinSettingsForm configuration={query.data} />
}

function CheckinSettingsForm(props: { configuration: CheckinConfiguration }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const config = props.configuration
  const [revision, setRevision] = useState(config.version)
  const updateOption = useMutation({
    mutationFn: (values: Values) =>
      saveCheckinConfiguration(
        {
          mode: values.mode,
          expiry_seconds: values.expiryMinutes * 60,
          enabled: values.enabled,
          min_quota: values.minQuota,
          max_quota: values.maxQuota,
          limits: values.limits,
        },
        revision
      ),
    onSuccess: (saved) => {
      setRevision(saved.version)
      queryClient.setQueryData(['checkin-configuration'], saved)
      for (const queryKey of [
        ['system-options'],
        ['checkin-status'],
        ['checkin-admin'],
        ['status'],
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
      try {
        window.localStorage.removeItem('status')
      } catch {
        /* Storage may be disabled. */
      }
      toast.success(t('Setting updated successfully'))
    },
    onError: (error) => {
      handleServerError(error)
      void queryClient.invalidateQueries({
        queryKey: ['checkin-configuration'],
      })
    },
  })
  const defaultValues = {
    enabled: config.settings.enabled,
    minQuota: config.settings.min_quota,
    maxQuota: config.settings.max_quota,
  }
  const limits = config.settings.limits
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      mode: config.settings.mode || 1,
      expiryMinutes: (config.settings.expiry_seconds || 86400) / 60,
      enabled: defaultValues.enabled,
      limits,
      minQuota: defaultValues.minQuota,
      maxQuota: defaultValues.maxQuota,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')
  const limitsEnabled = form.watch('limits.enabled')
  const mode = form.watch('mode')

  async function onSubmit(values: Values) {
    try {
      await updateOption.mutateAsync(values)
      form.reset(values)
    } catch {
      /* Mutation displays the server error and preserves edits. */
    }
  }

  return (
    <SettingsSection title={t('Check-in Settings')}>
      {revision !== config.version && (
        <div className='space-y-2' role='alert'>
          <p>{t('Check-in settings changed. Refresh before saving again.')}</p>
          <Button
            variant='outline'
            onClick={() => {
              form.reset({
                mode: config.settings.mode || 1,
                expiryMinutes: (config.settings.expiry_seconds || 86400) / 60,
                enabled: config.settings.enabled,
                minQuota: config.settings.min_quota,
                maxQuota: config.settings.max_quota,
                limits: config.settings.limits,
              })
              setRevision(config.version)
            }}
          >
            {t('Reload settings')}
          </Button>
        </div>
      )}
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save check-in settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable check-in feature')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Allow users to check in daily for random quota rewards'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <>
              <FormField
                control={form.control}
                name='mode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Check-in method')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={[
                        { value: 1, label: t('Method 1: Activity rewards') },
                        { value: 2, label: t('Method 2: Expiring rewards') },
                      ]}
                    >
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={1}>
                            {t('Method 1: Activity rewards')}
                          </SelectItem>
                          <SelectItem value={2}>
                            {t('Method 2: Expiring rewards')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {mode === 2 && (
                <FormField
                  control={form.control}
                  name='expiryMinutes'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Reward validity (minutes)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          max={525600}
                          step={1}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          '1–525600 minutes. 1440 minutes equals one day. Each reward expires from its claim time; changes apply to future claims.'
                        )}
                      </FormDescription>
                      <FormDescription>
                        {t(
                          'Daily rewards are independent of activity and monthly caps. Expiring rewards are used first; recharged quota never expires.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <div className='grid gap-6 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='minQuota'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Minimum check-in quota')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          placeholder={t('1000')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Minimum quota amount awarded for check-in')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='maxQuota'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Maximum check-in quota')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          placeholder={t('10000')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Maximum quota amount awarded for check-in')}
                      </FormDescription>
                      <FormMessage>
                        {form.formState.errors.maxQuota?.type === 'custom'
                          ? t('Maximum must be at least the minimum')
                          : undefined}
                      </FormMessage>
                    </FormItem>
                  )}
                />
              </div>
              {mode === 1 && (
                <FormField
                  control={form.control}
                  name='limits.enabled'
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{t('Limit check-in rewards')}</FormLabel>
                        <FormDescription>
                          {t(
                            'Reward percentage follows spending achievement, with the configured minimum as a floor. Registration grace and incomplete history receive full rewards. The monthly cap still applies.'
                          )}
                        </FormDescription>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmitting}
                        />
                      </FormControl>
                    </SettingsSwitchItem>
                  )}
                />
              )}
              {mode === 1 && limitsEnabled && (
                <>
                  <h3 className='text-sm font-medium'>
                    {t('Activity assessment and reward limits')}
                  </h3>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Activity is measured by settled API spending from wallet and subscriptions in the last configured number of days. Refunds are deducted. Recharges, logins and check-ins do not count. At or above the spending threshold, rewards remain normal. All quota inputs use internal quota units; the converted amount is shown below.'
                    )}
                  </p>
                  <div className='grid gap-6 sm:grid-cols-2'>
                    {limitFields.map((item) => (
                      <FormField
                        key={item.name}
                        control={form.control}
                        name={`limits.${item.name}`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t(item.label)}</FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={item.min}
                                max={item.max}
                                step={1}
                                {...field}
                              />
                            </FormControl>
                            {item.quota && (
                              <FormDescription>
                                {formatQuotaWithCurrency(
                                  Number(field.value) || 0
                                )}
                              </FormDescription>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'The grace period starts at registration. Changing its length recalculates each user’s expiry. A zero floor provides no minimum reward. Rewards round down to whole quota units. Monthly rewards reset in the server time zone.'
                    )}
                  </p>
                </>
              )}
            </>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
