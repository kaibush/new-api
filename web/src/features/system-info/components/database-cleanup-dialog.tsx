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

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { previewDatabaseCleanup, startDatabaseCleanup } from '../api'
import type { DatabaseCleanupTarget } from '../types'

const retentionSchema = z.object({
  retention_days: z.number().int().min(1).max(3650),
})

export function DatabaseCleanupDialog(props: {
  target: DatabaseCleanupTarget
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const form = useForm<z.infer<typeof retentionSchema>>({
    resolver: zodResolver(retentionSchema),
    defaultValues: { retention_days: 30 },
  })
  const preview = useMutation({
    mutationFn: previewDatabaseCleanup,
    onError: (error) =>
      handleServerError(error, undefined, {
        title: t(getServerErrorMessage(error)),
      }),
  })
  const cleanup = useMutation({
    mutationFn: startDatabaseCleanup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-info'] })
      toast.success(t('Cleanup queued. Follow its progress in System Tasks.'))
      props.onClose()
    },
    onError: (error) =>
      handleServerError(error, undefined, {
        title: t(getServerErrorMessage(error)),
      }),
  })
  const busy = preview.isPending || cleanup.isPending
  const snapshot = preview.data
  const targetLabel =
    props.target === 'request_logs'
      ? t('Request and error logs')
      : t('Visit statistics')

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose()
      }}
      title={t('Clean historical data')}
      desc={t('Only {{target}} will be deleted. This cannot be undone.', {
        target: targetLabel,
      })}
      destructive
      isLoading={busy}
      disabled={!snapshot || snapshot.count === 0}
      confirmText={t('Start cleanup')}
      handleConfirm={() => {
        if (snapshot && snapshot.count > 0 && !busy) cleanup.mutate(snapshot)
      }}
    >
      <form
        noValidate
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => {
          if (busy) return
          preview.reset()
          preview.mutate({
            target: props.target,
            retention_days: values.retention_days,
          })
        })}
      >
        <Field data-invalid={Boolean(form.formState.errors.retention_days)}>
          <FieldLabel htmlFor='database-retention'>
            {t('Keep recent data (days)')}
          </FieldLabel>
          <Input
            id='database-retention'
            type='number'
            min={1}
            max={3650}
            step={1}
            disabled={busy}
            aria-invalid={Boolean(form.formState.errors.retention_days)}
            {...form.register('retention_days', {
              valueAsNumber: true,
              onChange: () => preview.reset(),
            })}
          />
          {form.formState.errors.retention_days && (
            <FieldError>
              {t('Retention must be between 1 and 3650 days.')}
            </FieldError>
          )}
        </Field>
        <Button type='submit' variant='outline' disabled={busy}>
          {t('Preview cleanup')}
        </Button>
      </form>
      <div aria-live='polite' className='text-sm'>
        {preview.isPending && t('Counting eligible records...')}
        {snapshot &&
          t('Records to delete: {{total}}', {
            total: formatNumber(snapshot.count, locale),
          })}
        {snapshot && (
          <p className='text-muted-foreground mt-1'>
            {t('Before {{date}}', {
              date: new Date(snapshot.before * 1000).toLocaleString(locale),
            })}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
