import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { createRedPacket, type RedPacket } from './red-packet-api'

const schema = z.object({
  greeting: z
    .string()
    .trim()
    .refine((value) => [...value].length <= 120),
  codes: z
    .string()
    .trim()
    .refine((value) => {
      const codes = value.split(/\s+/)
      return (
        codes.length >= 1 &&
        codes.length <= 100 &&
        new Set(codes).size === codes.length &&
        codes.every((code) => /^[a-zA-Z0-9]{32}$/.test(code))
      )
    }),
})

export function RedPacketCreate(props: {
  onClose: () => void
  onCreated: (packet: RedPacket) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const id = useId()
  const client = useQueryClient()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { greeting: '', codes: '' },
  })
  const codes = form.watch('codes').trim()
  const count = codes ? codes.split(/\s+/).length : 0
  const send = useMutation({
    mutationFn: createRedPacket,
    retry: false,
    gcTime: 0,
    onSuccess: (packet) => {
      form.reset()
      void client.invalidateQueries({ queryKey: ['community-red-packets'] })
      props.onCreated(packet)
    },
    onError: (error) =>
      handleServerError(error, t('Could not send red packet')),
  })
  return (
    <Dialog
      open
      title={t('Send a red packet')}
      description={t('Share a little luck with the community.')}
      contentClassName='sm:max-w-lg'
      onOpenChange={(open) => {
        if (!open && !send.isPending) props.onClose()
      }}
      footer={
        <>
          <Button
            variant='outline'
            disabled={send.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={id}
            disabled={send.isPending || count === 0}
          >
            <Gift data-icon='inline-start' />
            {send.isPending ? t('Sending...') : t('Send a red packet')}
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={form.handleSubmit((values) =>
          send.mutate({
            greeting: values.greeting,
            codes: values.codes.split(/\s+/),
          })
        )}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.greeting}>
            <FieldLabel htmlFor={`${id}-greeting`}>
              {t('Red packet greeting')}
            </FieldLabel>
            <Input
              id={`${id}-greeting`}
              placeholder={t('A little luck for everyone')}
              aria-invalid={!!form.formState.errors.greeting}
              maxLength={240}
              {...form.register('greeting')}
            />
            {form.formState.errors.greeting && (
              <p role='alert' className='text-destructive text-sm'>
                {t('Use at most 120 characters.')}
              </p>
            )}
          </Field>
          <Field data-invalid={!!form.formState.errors.codes}>
            <FieldLabel htmlFor={`${id}-codes`}>
              {t('Redemption codes')}
            </FieldLabel>
            <Textarea
              id={`${id}-codes`}
              rows={6}
              autoComplete='off'
              spellCheck={false}
              placeholder={t('Paste one redemption code per line')}
              aria-invalid={!!form.formState.errors.codes}
              aria-describedby={`${id}-codes-help`}
              {...form.register('codes')}
            />
            <FieldDescription id={`${id}-codes-help`}>
              {t(
                'Use 1 to 100 distinct, unused redemption codes valid for at least 24 hours'
              )}
            </FieldDescription>
            {form.formState.errors.codes && (
              <p role='alert' className='text-destructive text-sm'>
                {t('Enter 1 to 100 unique, 32-character codes.')}
              </p>
            )}
          </Field>
          <p className='bg-muted rounded-lg p-3 text-sm' role='status'>
            {t('{{total}} codes · One per person · Available for 24 hours', {
              total: formatNumber(count, locale),
            })}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Codes are reserved when sent. Recipients redeem them in their wallet. Unclaimed codes can be redeemed normally after 24 hours.'
            )}
          </p>
        </FieldGroup>
      </form>
    </Dialog>
  )
}
