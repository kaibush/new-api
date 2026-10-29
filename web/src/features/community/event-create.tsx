import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createCommunityEvent, type CommunityEvent } from './event-api'

const schema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .refine((value) => [...value].length <= 80),
    description: z
      .string()
      .trim()
      .refine((value) => [...value].length <= 2000),
    kind: z.enum(['event', 'red_packet']),
    starts_at: z.date(),
    ends_at: z.date(),
  })
  .refine(
    (value) =>
      value.starts_at.getTime() > Date.now() &&
      value.starts_at.getTime() <= Date.now() + 366 * 86400000 &&
      value.ends_at > value.starts_at &&
      value.ends_at.getTime() <= Date.now() + 397 * 86400000
  )

export function EventCreate(props: {
  onClose: () => void
  onCreated: (event: CommunityEvent) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const client = useQueryClient()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      kind: 'event',
      starts_at: new Date(Math.ceil(Date.now() / 3600000) * 3600000),
      ends_at: new Date((Math.ceil(Date.now() / 3600000) + 1) * 3600000),
    },
  })
  const publish = useMutation({
    mutationFn: createCommunityEvent,
    retry: false,
    onSuccess: (event) => {
      void client.invalidateQueries({ queryKey: ['community-events'] })
      props.onCreated(event)
    },
    onError: (error) => handleServerError(error, t('Could not publish event')),
  })
  return (
    <Dialog
      open
      title={t('Publish event')}
      description={t(
        'Announce an event in the conversation and community board.'
      )}
      contentClassName='sm:max-w-lg'
      onOpenChange={(open) => {
        if (!open && !publish.isPending) props.onClose()
      }}
      footer={
        <>
          <Button
            variant='outline'
            disabled={publish.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={id} disabled={publish.isPending}>
            {publish.isPending ? t('Publishing...') : t('Publish event')}
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={form.handleSubmit((values) =>
          publish.mutate({
            ...values,
            starts_at: Math.floor(values.starts_at.getTime() / 1000),
            ends_at: Math.floor(values.ends_at.getTime() / 1000),
          })
        )}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.title}>
            <FieldLabel htmlFor={`${id}-title`}>{t('Event title')}</FieldLabel>
            <Input
              id={`${id}-title`}
              maxLength={80}
              aria-invalid={!!form.formState.errors.title}
              {...form.register('title')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-kind`}>{t('Event type')}</FieldLabel>
            <NativeSelect id={`${id}-kind`} {...form.register('kind')}>
              <NativeSelectOption value='event'>
                {t('Community event')}
              </NativeSelectOption>
              <NativeSelectOption value='red_packet'>
                {t('Red packet preview')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-starts`}>{t('Starts at')}</FieldLabel>
            <Controller
              control={form.control}
              name='starts_at'
              render={({ field }) => (
                <DateTimePicker
                  id={`${id}-starts`}
                  label={t('Starts at')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-ends`}>{t('Ends at')}</FieldLabel>
            <Controller
              control={form.control}
              name='ends_at'
              render={({ field }) => (
                <DateTimePicker
                  id={`${id}-ends`}
                  label={t('Ends at')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Schedule within the next year. Times use your local time zone.'
            )}
          </p>
          <Field data-invalid={!!form.formState.errors.description}>
            <FieldLabel htmlFor={`${id}-description`}>
              {t('Event details')}
            </FieldLabel>
            <Textarea
              id={`${id}-description`}
              rows={4}
              maxLength={2000}
              aria-invalid={!!form.formState.errors.description}
              {...form.register('description')}
            />
          </Field>
          {form.watch('kind') === 'red_packet' && (
            <p className='bg-muted rounded-lg p-3 text-sm'>
              {t(
                'This is a preview. An administrator sends the red packet when the event starts.'
              )}
            </p>
          )}
          {Object.keys(form.formState.errors).length > 0 && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Enter a title, an event type, and a future time range')}
            </p>
          )}
        </FieldGroup>
      </form>
    </Dialog>
  )
}
