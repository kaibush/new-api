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

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import { updateInputAuditSettings, type InputAuditSettings } from './api'
import { AuditFeatureSurface } from './feature-surface'

const schema = z.object({
  enabled: z.boolean(),
  retention_days: z.number().int().min(1).max(90),
  max_records: z.number().int().min(100).max(1000000),
  max_chars: z.number().int().min(256).max(8192),
  evidence_enabled: z.boolean(),
  evidence_max_chars: z.number().int().min(1024).max(65536),
  evidence_max_records: z.number().int().min(100).max(10000),
  evidence_max_bytes: z
    .number()
    .int()
    .min(8 * 1024 * 1024)
    .max(512 * 1024 * 1024),
  case_retention_days: z.number().int().min(1).max(90),
})

export function InputAuditSettingsDialog(props: {
  embedded?: boolean
  settings: InputAuditSettings
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      evidence_enabled: true,
      evidence_max_chars: 32768,
      evidence_max_records: 1000,
      evidence_max_bytes: 64 * 1024 * 1024,
      case_retention_days: 30,
      ...props.settings,
    },
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
    {
      name: 'evidence_max_chars' as const,
      label: t('Evidence characters per request'),
      min: 1024,
      max: 65536,
    },
    {
      name: 'evidence_max_records' as const,
      label: t('Maximum evidence records'),
      min: 100,
      max: 10000,
    },
    {
      name: 'evidence_max_bytes' as const,
      label: t('Evidence storage limit (bytes)'),
      min: 8 * 1024 * 1024,
      max: 512 * 1024 * 1024,
    },
    {
      name: 'case_retention_days' as const,
      label: t('Case retention days'),
      min: 1,
      max: 90,
    },
  ]
  return (
    <AuditFeatureSurface
      embedded={props.embedded}
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return
        if (value) {
          form.reset({
            evidence_enabled: true,
            evidence_max_chars: 32768,
            evidence_max_records: 1000,
            evidence_max_bytes: 64 * 1024 * 1024,
            case_retention_days: 30,
            ...props.settings,
          })
        }
        setOpen(value)
      }}
      title={t('Input audit settings')}
      contentClassName='sm:max-w-3xl'
      trigger={<Button variant='outline'>{t('Settings')}</Button>}
    >
      <form
        aria-label={t('Input audit settings')}
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <Tabs defaultValue='collection'>
          <TabsList className='mb-4 grid w-full grid-cols-2'>
            <TabsTrigger value='collection'>
              {t('Collect user messages')}
            </TabsTrigger>
            <TabsTrigger value='evidence'>
              {t('Evidence and review')}
            </TabsTrigger>
          </TabsList>
          {(['collection', 'evidence'] as const).map((group) => (
            <TabsContent key={group} value={group}>
              {group === 'collection' ? (
                <>
                  {' '}
                  <SettingsSwitchField
                    controlId='input-audit-enabled'
                    checked={form.watch('enabled')}
                    onCheckedChange={(value) => form.setValue('enabled', value)}
                    label={t('Collect user messages')}
                    disabled={mutation.isPending}
                  />
                </>
              ) : (
                <>
                  {' '}
                  <SettingsSwitchField
                    controlId='input-audit-evidence-enabled'
                    checked={form.watch('evidence_enabled')}
                    onCheckedChange={(value) =>
                      form.setValue('evidence_enabled', value)
                    }
                    label={t('Retain submitted text evidence')}
                    disabled={mutation.isPending}
                  />
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Also captures the decisive filter match: up to 300 characters on each side and 256 matched characters. Interception records use the same retention period and a separate budget capped by the evidence limits.'
                    )}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Cases keep immutable evidence for their retention period, up to 1000 cases and 256 MiB including decision history.'
                    )}
                  </p>
                </>
              )}
              <FieldGroup className='mt-4 grid gap-4 sm:grid-cols-2'>
                {fields
                  .filter((_, index) =>
                    group === 'collection' ? index < 3 : index >= 3
                  )
                  .map((field) => (
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
                          {t(
                            'Please enter an integer between {{min}} and {{max}}',
                            {
                              min: field.min,
                              max: field.max,
                            }
                          )}
                        </FieldError>
                      )}
                    </Field>
                  ))}
              </FieldGroup>
            </TabsContent>
          ))}
        </Tabs>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Identical messages from the same user are merged while retained. Collection is best effort; overloaded queues may drop records.'
          )}
        </p>
        <Button className='mt-4' type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      </form>
    </AuditFeatureSurface>
  )
}
