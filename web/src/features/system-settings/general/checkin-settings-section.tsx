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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { Switch } from '@/components/ui/switch'
import { formatQuotaWithCurrency } from '@/lib/currency'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const limitsSchema = z.object({
  enabled: z.boolean(),
  gift_cap: z.coerce.number().int().min(1).max(2147483647),
  monthly_cap: z.coerce.number().int().min(1).max(2147483647),
  activity_days: z.coerce.number().int().min(1).max(365),
  minimum_spend: z.coerce.number().int().min(0).max(2147483647),
  reduced_percent: z.coerce.number().int().min(0).max(100),
  new_user_days: z.coerce.number().int().min(0).max(365),
})

const limitFields = [
  {
    name: 'gift_cap',
    label: 'Unspent check-in reward cap',
    quota: true,
    min: 1,
    max: 2147483647,
  },
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
    label: 'Low-activity reward percentage',
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
    limits: limitsSchema,
    enabled: z.boolean(),
    minQuota: z.coerce.number().int().min(0).max(2147483647),
    maxQuota: z.coerce.number().int().min(0).max(2147483647),
  })
  .refine((values) => values.maxQuota >= values.minQuota, {
    path: ['maxQuota'],
    message: 'Maximum must be at least the minimum',
  })

type Values = z.infer<typeof schema>

export function CheckinSettingsSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
    limits: string
    minQuota: number
    maxQuota: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  let parsedLimits: unknown
  try {
    parsedLimits = JSON.parse(defaultValues.limits)
  } catch {
    parsedLimits = null
  }
  const limitsResult = limitsSchema.safeParse(parsedLimits)
  const limits = limitsResult.success
    ? limitsResult.data
    : {
        enabled: false,
        gift_cap: 500000,
        monthly_cap: 300000,
        activity_days: 30,
        minimum_spend: 50000,
        reduced_percent: 20,
        new_user_days: 7,
      }
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      limits,
      minQuota: defaultValues.minQuota,
      maxQuota: defaultValues.maxQuota,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')
  const limitsEnabled = form.watch('limits.enabled')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if (values.enabled !== defaultValues.enabled) {
      updates.push({
        key: 'checkin_setting.enabled',
        value: String(values.enabled),
      })
    }

    if (values.minQuota !== defaultValues.minQuota) {
      updates.push({
        key: 'checkin_setting.min_quota',
        value: String(values.minQuota),
      })
    }

    if (values.maxQuota !== defaultValues.maxQuota) {
      updates.push({
        key: 'checkin_setting.max_quota',
        value: String(values.maxQuota),
      })
    }

    if (JSON.stringify(values.limits) !== JSON.stringify(limits)) {
      updates.push({
        key: 'checkin_setting.limits',
        value: JSON.stringify(values.limits),
      })
    }
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  return (
    <SettingsSection title={t('Check-in Settings')}>
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
              <FormField
                control={form.control}
                name='limits.enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Limit check-in rewards')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Purchased and legacy balances do not affect check-in limits. Only newly tracked check-in rewards count toward the gift cap.'
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
              {limitsEnabled && (
                <>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Settled wallet and subscription spending counts as activity. Gifts are used first for wallet spending. Incomplete history gets an observation window; monthly limits still apply. All quota inputs use internal quota units.'
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
                      'A reward percentage of 0 pauses rewards for low activity. Monthly rewards reset on the first day of each month in the server time zone.'
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
