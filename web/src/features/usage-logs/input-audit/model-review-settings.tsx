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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import {
  saveModelReviewSettings,
  type ModelReviewSettings,
} from './model-review-api'

const schema = z
  .object({
    enabled: z.boolean(),
    automatic: z.boolean(),
    endpoint: z.string().max(2000),
    key_env: z.string().regex(/^INPUT_AUDIT_LLM_[A-Z0-9_]+$|^$/),
    model: z.string().max(200),
    instructions: z.string().max(3000),
    interval_minutes: z.number().int().min(1).max(10080),
    batch_size: z.number().int().min(1).max(1000),
    chunk_chars: z.number().int().min(1000).max(16000),
    timeout_seconds: z.number().int().min(5).max(120),
    request_interval_seconds: z.number().int().min(1).max(60),
    retries: z.number().int().min(0).max(3),
    confidence_threshold: z.number().int().min(0).max(100),
    retention_days: z.number().int().min(1).max(90),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && !value.model.trim())
      {ctx.addIssue({ code: 'custom', path: ['model'], message: 'required' })}
    if (value.enabled || value.endpoint) {
      try {
        const url = new URL(value.endpoint)
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== 'https:' &&
            !(
              url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            ))
        )
          {throw new Error('invalid')}
      } catch {
        ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'invalid' })
      }
    }
  })

export function ModelReviewSettingsForm(props: {
  settings: ModelReviewSettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<ModelReviewSettings>({
    resolver: zodResolver(schema),
    defaultValues: props.settings,
  })
  const mutation = useMutation({
    mutationFn: saveModelReviewSettings,
    onSuccess: () => {
      toast.success(t('Settings saved successfully'))
      void client.invalidateQueries({ queryKey: ['model-review-settings'] })
    },
  })
  const numbers = [
    {
      name: 'batch_size' as const,
      label: t('Messages per review job'),
      min: 1,
      max: 1000,
    },
    {
      name: 'chunk_chars' as const,
      label: t('Characters per model request'),
      min: 1000,
      max: 16000,
    },
    {
      name: 'timeout_seconds' as const,
      label: t('Request timeout (seconds)'),
      min: 5,
      max: 120,
    },
    {
      name: 'request_interval_seconds' as const,
      label: t('Request interval (seconds)'),
      min: 1,
      max: 60,
    },
    { name: 'retries' as const, label: t('Retries'), min: 0, max: 3 },
    {
      name: 'confidence_threshold' as const,
      label: t('Minimum confidence for safe results (%)'),
      min: 0,
      max: 100,
    },
    {
      name: 'retention_days' as const,
      label: t('Result retention days'),
      min: 1,
      max: 90,
    },
  ]
  return (
    <form
      aria-label={t('Model review settings')}
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className='space-y-4'
    >
      <SettingsSwitchField
        controlId='model-review-enabled'
        label={t('Enable model review')}
        checked={form.watch('enabled')}
        onCheckedChange={(value) => form.setValue('enabled', value)}
        disabled={mutation.isPending}
      />
      <Accordion defaultValue={['connection']}>
        <AccordionItem value='connection'>
          <AccordionTrigger>
            {t('Model connection and policy')}
          </AccordionTrigger>
          <AccordionContent className='space-y-4'>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Review sends retained messages to the configured service. Use a trusted chat completions endpoint; credentials stay in the server environment.'
              )}
            </p>
            <div className='grid gap-4 sm:grid-cols-2'>
              {[
                {
                  name: 'endpoint' as const,
                  label: t('Chat completions endpoint'),
                  placeholder: 'https://example.com/v1/chat/completions',
                },
                { name: 'model' as const, label: t('Model'), placeholder: '' },
                {
                  name: 'key_env' as const,
                  label: t('Credential environment variable'),
                  placeholder: 'INPUT_AUDIT_LLM_API_KEY',
                },
              ].map((field) => (
                <Field
                  key={field.name}
                  className={field.name === 'endpoint' ? 'sm:col-span-2' : ''}
                >
                  <FieldLabel htmlFor={`review-${field.name}`}>
                    {field.label}
                  </FieldLabel>
                  <Input
                    id={`review-${field.name}`}
                    placeholder={field.placeholder}
                    disabled={mutation.isPending}
                    aria-invalid={!!form.formState.errors[field.name]}
                    {...form.register(field.name)}
                  />
                  {form.formState.errors[field.name] && (
                    <FieldError>
                      {t('Invalid model review settings')}
                    </FieldError>
                  )}
                </Field>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor='review-policy'>
                {t('Review policy and output language')}
              </FieldLabel>
              <Textarea
                id='review-policy'
                rows={5}
                maxLength={3000}
                disabled={mutation.isPending}
                {...form.register('instructions')}
              />
            </Field>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value='processing'>
          <AccordionTrigger>{t('Processing and limits')}</AccordionTrigger>
          <AccordionContent>
            <p className='text-muted-foreground mb-4 text-xs'>
              {t(
                'Messages are deduplicated during collection. Review uses bounded jobs and overlapping text chunks. Incomplete evidence stays marked for human review.'
              )}
            </p>
            <p className='text-muted-foreground mb-4 text-xs'>{t('Review storage is limited to 1000 jobs and 100000 results. Older records may be removed before the retention period ends.')}</p>
            <div className='grid gap-4 sm:grid-cols-2'>
              {numbers.map((field) => (
                <Field key={field.name}>
                  <FieldLabel htmlFor={`review-${field.name}`}>
                    {field.label}
                  </FieldLabel>
                  <Input
                    id={`review-${field.name}`}
                    type='number'
                    min={field.min}
                    max={field.max}
                    step={1}
                    disabled={mutation.isPending}
                    aria-invalid={!!form.formState.errors[field.name]}
                    {...form.register(field.name, { valueAsNumber: true })}
                  />
                  {form.formState.errors[field.name] && (
                    <FieldError>
                      {t(
                        'Please enter an integer between {{min}} and {{max}}',
                        { min: field.min, max: field.max }
                      )}
                    </FieldError>
                  )}
                </Field>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value='schedule'>
          <AccordionTrigger>{t('Automatic review schedule')}</AccordionTrigger>
          <AccordionContent className='space-y-4'>
            <SettingsSwitchField
              controlId='review-automatic'
              label={t('Run incremental review automatically')}
              checked={form.watch('automatic')}
              onCheckedChange={(value) => form.setValue('automatic', value)}
              disabled={mutation.isPending}
            />
            <Field>
              <FieldLabel htmlFor='review-interval'>
                {t('Review interval (minutes)')}
              </FieldLabel>
              <Input
                id='review-interval'
                type='number'
                min={1}
                max={10080}
                step={1}
                disabled={mutation.isPending}
                {...form.register('interval_minutes', { valueAsNumber: true })}
              />
              {form.formState.errors.interval_minutes && (
                <FieldError>
                  {t('Please enter an integer between {{min}} and {{max}}', {
                    min: 1,
                    max: 10080,
                  })}
                </FieldError>
              )}
            </Field>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Each scheduled job continues through unreviewed retained messages. One job runs at a time across instances. Saved changes apply to new jobs.'
              )}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Invalid model review settings')}
        </p>
      )}
      <div className='bg-background sticky bottom-0 flex justify-end border-t pt-3'>
        <Button type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      </div>
    </form>
  )
}
