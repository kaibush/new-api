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
import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { previewErrorFilter } from './api'
import { createConfigSchema, type ErrorFilterConfig } from './lib/schema'

const sampleSchema = z.object({
  message: z.string().max(1 << 20),
  body: z.string().max(1 << 20),
  status: z.number().int().min(100).max(599),
  channel_id: z.number().int().min(0),
  model: z.string(),
  type: z.string(),
  code: z.string(),
  request_id: z.string(),
})
type SampleForm = z.infer<typeof sampleSchema>
export function ErrorPreview(props: { config: ErrorFilterConfig }) {
  const { t } = useTranslation()
  const form = useForm<SampleForm>({
    resolver: zodResolver(sampleSchema),
    defaultValues: {
      message: '',
      body: '',
      status: 413,
      channel_id: 0,
      model: '',
      type: '',
      code: '',
      request_id: 'preview',
    },
  })
  const mutation = useMutation({
    mutationFn: (sample: SampleForm) =>
      previewErrorFilter(
        createConfigSchema(t).parse(props.config),
        sample,
        sample.body
      ),
    onError: (error) => handleServerError(error),
  })
  const sample = useWatch({ control: form.control })
  const { reset } = mutation
  useEffect(() => reset(), [props.config, sample, reset])
  const fields = [
    ['status', t('HTTP status')],
    ['channel_id', t('Channel ID')],
    ['model', t('Model')],
    ['type', t('Error type')],
    ['code', t('Error code')],
    ['request_id', t('Request ID')],
  ] as const
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((sample) => mutation.mutate(sample))}
        className='flex flex-col gap-4'
      >
        <p className='text-muted-foreground text-sm'>
          {t(
            'Preview uses the current draft, including its enable switch. Nothing is saved or sent upstream.'
          )}
        </p>
        <FormField
          control={form.control}
          name='message'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Sample upstream message')}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={4} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {fields.map(([name, label]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type={
                        name === 'status' || name === 'channel_id'
                          ? 'number'
                          : 'text'
                      }
                      onChange={(event) =>
                        field.onChange(
                          name === 'status' || name === 'channel_id'
                            ? Number(event.target.value)
                            : event.target.value
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name='body'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Sample error response (optional)')}</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  placeholder='{"error":{"message":"..."}}'
                />
              </FormControl>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'When provided, the response supplies the message, type and code for matching.'
                )}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' variant='outline' disabled={mutation.isPending}>
          {t('Preview error')}
        </Button>
        {mutation.isError && (
          <p role='alert' className='text-destructive text-sm'>
            {mutation.error.message}
          </p>
        )}
        {mutation.data && (
          <div role='status' className='flex flex-col gap-2'>
            <p className='text-sm'>
              {t('Matched rule')}: {mutation.data.result.rule || t('Fallback')}{' '}
              · {mutation.data.result.action}
            </p>
            <pre
              aria-label={t('Client response preview')}
              className='bg-muted max-h-80 overflow-auto rounded-lg p-3 text-xs break-all whitespace-pre-wrap'
            >
              {mutation.data.body}
            </pre>
          </div>
        )}
      </form>
    </Form>
  )
}
