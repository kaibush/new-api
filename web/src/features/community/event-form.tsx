import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createCommunityEvent,
  updateCommunityEvent,
  type CommunityEvent,
  type CommunityEventInput,
} from './event-api'
import {
  communityEventFormSchema,
  type CommunityEventFormValues,
} from './lib/event-form'

export function EventForm(props: {
  event?: CommunityEvent
  onClose: () => void
  onSaved: (event: CommunityEvent) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const client = useQueryClient()
  const editing = !!props.event
  const started = !!props.event && props.event.starts_at * 1000 <= Date.now()
  const form = useForm<CommunityEventFormValues>({
    resolver: zodResolver(
      communityEventFormSchema(
        props.event?.starts_at ? props.event.starts_at * 1000 : undefined
      )
    ),
    defaultValues: props.event
      ? {
          title: props.event.title,
          description: props.event.description,
          kind: props.event.kind,
          starts_at: new Date(props.event.starts_at * 1000),
          ends_at: new Date(props.event.ends_at * 1000),
        }
      : {
          title: '',
          description: '',
          kind: 'event',
          starts_at: new Date(Math.ceil(Date.now() / 3600000) * 3600000),
          ends_at: new Date((Math.ceil(Date.now() / 3600000) + 1) * 3600000),
        },
  })
  const save = useMutation({
    mutationFn: (input: CommunityEventInput) =>
      props.event
        ? updateCommunityEvent(props.event.id, input)
        : createCommunityEvent(input),
    retry: false,
    onSuccess: async (event) => {
      await client.cancelQueries({ queryKey: ['community-event', event.id] })
      client.setQueryData(['community-event', event.id], event)
      void client.invalidateQueries({ queryKey: ['community-events'] })
      void client.invalidateQueries({ queryKey: ['community-history'] })
      if (editing) toast.success(t('Event updated'))
      props.onSaved(event)
    },
    onError: (error) =>
      handleServerError(
        error,
        editing ? t('Could not update event') : t('Could not publish event')
      ),
  })
  const submitLabel = editing ? t('Save changes') : t('Publish event')
  const pendingLabel = editing ? t('Saving...') : t('Publishing...')
  return (
    <Dialog
      open
      title={editing ? t('Edit event') : t('Publish event')}
      description={
        editing
          ? t('Update this event and its existing chat announcement.')
          : t('Announce an event in the conversation and community board.')
      }
      contentClassName='sm:max-w-lg'
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
      footer={
        <>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={id} disabled={save.isPending}>
            {save.isPending ? pendingLabel : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={form.handleSubmit((values) =>
          save.mutate({
            ...values,
            starts_at: Math.floor(values.starts_at.getTime() / 1000),
            ends_at: Math.floor(values.ends_at.getTime() / 1000),
          })
        )}
      >
        <fieldset disabled={save.isPending}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.title}>
              <FieldLabel htmlFor={`${id}-title`}>
                {t('Event title')}
              </FieldLabel>
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
              <fieldset disabled={started}>
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
              </fieldset>
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
              {started
                ? t(
                    'An ongoing event keeps its original start time. Its end time must be in the future.'
                  )
                : t('Times use your local time zone.')}
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
                {editing
                  ? t('Enter a title, an event type, and a valid time range')
                  : t('Enter a title, an event type, and a future time range')}
              </p>
            )}
          </FieldGroup>
        </fieldset>
      </form>
    </Dialog>
  )
}
