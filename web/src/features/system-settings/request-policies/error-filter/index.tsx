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
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { SettingsCard } from '../../components/settings-card'
import { SettingsSwitchField } from '../../components/settings-form-layout'
import { SettingsPageFormActions } from '../../components/settings-page-context'
import { errorFilterQueryKey, getErrorFilter, saveErrorFilter } from './api'
import { ConfigJsonDialog } from './json-dialog'
import { createConfigSchema, type ErrorFilterConfig } from './lib/schema'
import { ErrorPreview } from './preview'
import { RuleList } from './rule-list'

export function ErrorFilterSection() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: errorFilterQueryKey,
    queryFn: getErrorFilter,
    staleTime: Infinity,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) {
    return (
      <ErrorState
        title={t('Failed to load settings')}
        onRetry={() => void query.refetch()}
      />
    )
  }
  return <ErrorFilterEditor config={query.data} />
}

function ErrorFilterEditor(props: { config: ErrorFilterConfig }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const schema = useMemo(() => createConfigSchema(t), [t])
  const form = useForm<ErrorFilterConfig>({
    resolver: zodResolver(schema),
    defaultValues: props.config,
  })
  const values = form.watch()
  const { dirtyFields } = form.formState
  const [jsonOpen, setJsonOpen] = useState(false)
  useEffect(() => {
    form.reset(props.config, { keepDirtyValues: true })
  }, [props.config, form])
  const mutation = useMutation({
    mutationFn: saveErrorFilter,
    onSuccess: (config) => {
      form.reset(config)
      client.setQueryData(errorFilterQueryKey, config)
      void client.invalidateQueries({ queryKey: ['system-options'] })
      toast.success(t('Settings saved'))
    },
    onError: (error) => handleServerError(error),
  })
  const submit = form.handleSubmit((config) => mutation.mutate(config))
  return (
    <div className='flex min-w-0 flex-col gap-5'>
      <Form {...form}>
        <SettingsPageFormActions
          onSave={submit}
          onReset={() => form.reset(props.config)}
          isSaving={mutation.isPending}
          isSaveDisabled={!form.formState.isDirty}
        />
        <fieldset
          disabled={mutation.isPending}
          className='flex min-w-0 flex-col gap-5'
        >
          <SettingsCard
            title={t('Error masking')}
            description={t(
              'Customize client errors from HTTP relay responses and SSE events. User error logs follow the same rules; administrators retain the original diagnostic message.'
            )}
          >
            <div className='flex flex-col gap-4'>
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <SettingsSwitchField
                    controlId='error-filter-enabled'
                    label={t('Enable error masking')}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <FormField
                control={form.control}
                name='strip_details'
                render={({ field }) => (
                  <SettingsSwitchField
                    controlId='error-filter-details'
                    label={t('Remove extra error details')}
                    description={t(
                      'For replaced errors, remove extra fields and normalize unknown type/code values. Turning this off can keep upstream details in other fields.'
                    )}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <FormField
                control={form.control}
                name='remove_headers'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Response headers to remove')}</FormLabel>
                    <FormControl>
                      <Textarea
                        value={field.value.join('\n')}
                        onChange={(event) =>
                          field.onChange(event.target.value.split('\n'))
                        }
                        onBlur={() =>
                          field.onChange(
                            field.value
                              .map((value) => value.trim())
                              .filter(Boolean)
                          )
                        }
                        placeholder='X-Magpie-*'
                        rows={3}
                      />
                    </FormControl>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'One name per line. A trailing * matches a prefix. Applied to all HTTP relay responses when enabled; protocol headers are protected.'
                      )}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type='button'
                variant='outline'
                onClick={() => setJsonOpen(true)}
              >
                {t('Edit configuration JSON')}
              </Button>
            </div>
          </SettingsCard>
          <SettingsCard title={t('Error rules')}>
            <RuleList disabled={mutation.isPending} />
          </SettingsCard>
          <SettingsCard title={t('Unmatched errors')}>
            <div className='flex flex-col gap-4'>
              <FormField
                control={form.control}
                name='fallback'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Fallback action')}</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <NativeSelectOption value='preserve'>
                          {t('Keep existing response')}
                        </NativeSelectOption>
                        <NativeSelectOption value='replace'>
                          {t('Replace entire message')}
                        </NativeSelectOption>
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {values.fallback === 'replace' && (
                <FormField
                  control={form.control}
                  name='fallback_message'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Fallback message')}</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </SettingsCard>
        </fieldset>
        {Object.keys(dirtyFields).length > 0 &&
          !schema.safeParse(values).success && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Correct the invalid settings before saving.')}
            </p>
          )}
        {mutation.isError && (
          <p role='alert' className='text-destructive text-sm'>
            {mutation.error.message}
          </p>
        )}
      </Form>
      <SettingsCard title={t('Error preview')}>
        <ErrorPreview config={values} />
      </SettingsCard>
      {jsonOpen && (
        <ConfigJsonDialog
          config={values}
          onClose={() => setJsonOpen(false)}
          onApply={(config) => {
            form.reset(config, { keepDefaultValues: true })
            setJsonOpen(false)
          }}
        />
      )}
    </div>
  )
}
