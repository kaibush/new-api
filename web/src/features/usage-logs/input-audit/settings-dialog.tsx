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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import { updateInputAuditSettings, type InputAuditSettings } from './api'

const schema = z.object({
  enabled: z.boolean(),
  retention_days: z.number().int().min(1).max(90),
  max_records: z.number().int().min(100).max(1000000),
  max_chars: z.number().int().min(256).max(8192),
})

export function InputAuditSettingsDialog(props: {
  settings: InputAuditSettings
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const form = useForm<InputAuditSettings>({
    resolver: zodResolver(schema),
    defaultValues: props.settings,
  })
  const mutation = useMutation({
    mutationFn: updateInputAuditSettings,
    onSuccess: () => {
      toast.success(t('Settings saved successfully'))
      void queryClient.invalidateQueries({ queryKey: ['input-audit-status'] })
      setOpen(false)
    },
  })
  const fields = [
    {
      name: 'retention_days' as const,
      label: t('Days to Retain'),
      min: 1,
      max: 90,
    },
    {
      name: 'max_records' as const,
      label: t('Maximum records'),
      min: 100,
      max: 1000000,
    },
    {
      name: 'max_chars' as const,
      label: t('Stored characters'),
      min: 256,
      max: 8192,
    },
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return
        if (value) form.reset(props.settings)
        setOpen(value)
      }}
      title={t('Input audit settings')}
      trigger={<Button variant='outline'>{t('Settings')}</Button>}
    >
      <form
        aria-label={t('Input audit settings')}
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup>
          <SettingsSwitchField
            controlId='input-audit-enabled'
            checked={form.watch('enabled')}
            onCheckedChange={(value) => form.setValue('enabled', value)}
            label={t('Collect user messages')}
            disabled={mutation.isPending}
          />
          {fields.map((field) => (
            <Field
              key={field.name}
              data-invalid={!!form.formState.errors[field.name]}
            >
              <FieldLabel htmlFor={`input-audit-${field.name}`}>
                {field.label}
              </FieldLabel>
              <Input
                id={`input-audit-${field.name}`}
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
                  {t('Please enter an integer between {{min}} and {{max}}', {
                    min: field.min,
                    max: field.max,
                  })}
                </FieldError>
              )}
            </Field>
          ))}
          <p className='text-muted-foreground text-xs'>
            {t(
              'Identical messages from the same user are merged while retained. Collection is best effort; overloaded queues may drop records.'
            )}
          </p>
          <Button type='submit' disabled={mutation.isPending}>
            {t('Save')}
          </Button>
        </FieldGroup>
      </form>
    </Dialog>
  )
}
