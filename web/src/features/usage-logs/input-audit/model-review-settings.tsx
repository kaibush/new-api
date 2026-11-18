import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { PasswordInput } from '@/components/password-input'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  useSecureVerification,
  SecureVerificationDialog,
} from '@/features/auth/secure-verification'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import {
  saveModelReviewSettings,
  revealModelReviewKey,
  type ModelReviewSettings,
} from './model-review-api'

const providerEndpoints: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
}

const schema = z
  .object({
    enabled: z.boolean(),
    automatic: z.boolean(),
    endpoint: z.string().max(2000),
    key_env: z.string(),
    api_key: z.string().max(8192).optional(),
    clear_api_key: z.boolean().optional(),
    system_prompt: z.string().max(3000).optional(),
    model: z.string().max(200),
    instructions: z.string().max(3000),
    interval_minutes: z.number().int().min(1).max(10080),
    batch_size: z.number().int().min(1).max(1000),
    concurrency: z.number().int().min(1).max(5),
    chunk_chars: z.number().int().min(1000).max(16000),
    timeout_seconds: z.number().int().min(5).max(120),
    request_interval_seconds: z.number().int().min(1).max(60),
    retries: z.number().int().min(0).max(3),
    confidence_threshold: z.number().int().min(0).max(100),
    retention_days: z.number().int().min(1).max(90),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && !value.model.trim()) {
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'required' })
    }
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
        ) {
          throw new Error('invalid')
        }
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
  const verification = useSecureVerification()
  const credentialRequest = useRef<AbortController | null>(null)
  const cancelVerification = verification.cancel
  useEffect(
    () => () => {
      credentialRequest.current?.abort()
      cancelVerification()
    },
    [cancelVerification]
  )
  const form = useForm<ModelReviewSettings>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...props.settings,
      concurrency: props.settings.concurrency ?? 3,
      api_key: '',
      clear_api_key: false,
      system_prompt:
        props.settings.system_prompt ||
        props.settings.default_system_prompt ||
        '',
    },
  })
  const mutation = useMutation({
    mutationFn: saveModelReviewSettings,
    onSuccess: () => {
      form.setValue('api_key', '')
      form.setValue('clear_api_key', false)
      toast.success(t('Settings saved successfully'))
      void client.invalidateQueries({ queryKey: ['model-review-settings'] })
    },
  })
  const reveal = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async () => {
      const proof = await verification.requestVerification({
        scope: 'input_audit.credentials.read',
        title: t('Verify to view saved credentials'),
      })
      if (!proof) return
      const request = new AbortController()
      credentialRequest.current = request
      try {
        const key = await revealModelReviewKey(
          proof.proof_token,
          request.signal
        )
        if (!request.signal.aborted && !form.getFieldState('api_key').isDirty) {
          form.setValue('api_key', key)
        }
      } finally {
        if (credentialRequest.current === request) {
          credentialRequest.current = null
        }
      }
    },
  })
  const numbers = [
    {
      name: 'concurrency' as const,
      label: t('Concurrent message reviews'),
      min: 1,
      max: 5,
    },
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
    <>
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
                  'Leave the API key blank to keep the saved key. Verify your identity to view and copy it.'
                )}
              </p>
              <Field>
                <FieldLabel htmlFor='review-provider'>
                  {t('Provider')}
                </FieldLabel>
                <NativeSelect
                  id='review-provider'
                  defaultValue={
                    Object.entries(providerEndpoints).find(
                      ([, endpoint]) => endpoint === props.settings.endpoint
                    )?.[0] || 'custom'
                  }
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    const endpoint = providerEndpoints[event.target.value]
                    if (endpoint) {
                      form.setValue('endpoint', endpoint, { shouldDirty: true })
                    }
                  }}
                >
                  <NativeSelectOption value='custom'>
                    {t('Custom')}
                  </NativeSelectOption>
                  <NativeSelectOption value='openai'>OpenAI</NativeSelectOption>
                  <NativeSelectOption value='deepseek'>
                    DeepSeek
                  </NativeSelectOption>
                  <NativeSelectOption value='openrouter'>
                    OpenRouter
                  </NativeSelectOption>
                  <NativeSelectOption value='siliconflow'>
                    SiliconFlow
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <div className='grid gap-4 sm:grid-cols-2'>
                {[
                  {
                    name: 'endpoint' as const,
                    label: t('Chat completions endpoint'),
                    placeholder: 'https://example.com/v1/chat/completions',
                  },
                  {
                    name: 'model' as const,
                    label: t('Model'),
                    placeholder: '',
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
                <FieldLabel htmlFor='review-api-key'>{t('API Key')}</FieldLabel>
                <PasswordInput
                  id='review-api-key'
                  autoComplete='new-password'
                  disabled={mutation.isPending || form.watch('clear_api_key')}
                  placeholder={
                    props.settings.key_configured
                      ? t('Configured')
                      : t('API Key')
                  }
                  {...form.register('api_key')}
                />
              </Field>
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={
                    mutation.isPending ||
                    reveal.isPending ||
                    form.watch('clear_api_key')
                  }
                  onClick={() => reveal.mutate()}
                >
                  {t('Load saved credentials')}
                </Button>
                <CopyButton
                  value={form.watch('api_key') || ''}
                  disabled={!form.watch('api_key')}
                />
              </div>
              <SettingsSwitchField
                controlId='review-clear-key'
                label={t('Remove saved review key')}
                checked={form.watch('clear_api_key') ?? false}
                disabled={mutation.isPending}
                onCheckedChange={(value) =>
                  form.setValue('clear_api_key', value)
                }
              />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value='policy'>
            <AccordionTrigger>{t('Review system prompt')}</AccordionTrigger>
            <AccordionContent className='space-y-4'>
              <Field>
                <FieldLabel htmlFor='review-system-prompt'>
                  {t('Review system prompt')}
                </FieldLabel>
                <Textarea
                  id='review-system-prompt'
                  rows={10}
                  maxLength={3000}
                  disabled={mutation.isPending}
                  {...form.register('system_prompt')}
                />
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Edit the review criteria here. The server always enforces structured output and exact evidence quotes. Empty prompts use the default.'
                  )}
                </p>
                <Button
                  type='button'
                  variant='outline'
                  disabled={mutation.isPending}
                  onClick={() =>
                    form.setValue(
                      'system_prompt',
                      props.settings.default_system_prompt || '',
                      { shouldDirty: true }
                    )
                  }
                >
                  {t('Restore default prompt')}
                </Button>
              </Field>
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
                  'Review up to 5 messages concurrently. The request interval is shared by all workers, text chunks and retries. Rate limits and server errors pause new requests; retries use exponential backoff. Saved changes apply to new jobs.'
                )}
              </p>
              <p className='text-muted-foreground mb-4 text-xs'>
                {t(
                  'Messages are deduplicated during collection. Review uses bounded jobs and overlapping text chunks. Incomplete evidence stays marked for human review.'
                )}
              </p>
              <p className='text-muted-foreground mb-4 text-xs'>
                {t(
                  'Review storage is limited to 1000 jobs and 100000 results. Older records may be removed before the retention period ends.'
                )}
              </p>
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
            <AccordionTrigger>
              {t('Automatic review schedule')}
            </AccordionTrigger>
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
                  {...form.register('interval_minutes', {
                    valueAsNumber: true,
                  })}
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
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}
