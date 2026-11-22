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
  evidence_max_chars: z.number().int().min(1024).max(262144),
  evidence_max_records: z.number().int().min(100).max(1000000),
  evidence_max_bytes: z
    .number()
    .int()
    .min(8 * 1024 * 1024)
    .max(512 * 1024 * 1024),
  case_retention_days: z.number().int().min(1).max(90),
  match_max_chars: z.number().int().min(1024).max(1048576),
  match_max_records: z.number().int().min(100).max(1000000),
  match_max_bytes: z
    .number()
    .int()
    .min(8 * 1024 * 1024)
    .max(512 * 1024 * 1024),
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
      evidence_max_records: 20000,
      evidence_max_bytes: 64 * 1024 * 1024,
      case_retention_days: 30,
      match_max_chars: 131072,
      match_max_records: 2000,
      match_max_bytes: 64 * 1024 * 1024,
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
      name: 'match_max_chars' as const,
      label: t('Interception characters per request'),
      min: 1024,
      max: 1048576,
    },
    {
      name: 'match_max_records' as const,
      label: t('Maximum interception records'),
      min: 100,
      max: 1000000,
    },
    {
      name: 'match_max_bytes' as const,
      label: t('Interception storage limit (bytes)'),
      min: 8 * 1024 * 1024,
      max: 512 * 1024 * 1024,
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
      label: t('Characters per conversation item'),
      min: 1024,
      max: 262144,
    },
    {
      name: 'evidence_max_records' as const,
      label: t('Maximum conversations'),
      min: 100,
      max: 1000000,
    },
    {
      name: 'evidence_max_bytes' as const,
      label: t('Conversation storage limit (bytes)'),
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
            evidence_max_records: 20000,
            evidence_max_bytes: 64 * 1024 * 1024,
            case_retention_days: 30,
            match_max_chars: 131072,
            match_max_records: 2000,
            match_max_bytes: 64 * 1024 * 1024,
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
          <TabsList className='mb-4 grid w-full grid-cols-3'>
            <TabsTrigger value='collection'>
              {t('Collect user messages')}
            </TabsTrigger>
            <TabsTrigger value='evidence'>
              {t('Evidence and review')}
            </TabsTrigger>
            <TabsTrigger value='interception'>
              {t('Interception evidence')}
            </TabsTrigger>
          </TabsList>
          {(['collection', 'evidence', 'interception'] as const).map(
            (group) => (
              <TabsContent key={group} value={group}>
                {group === 'collection' && (
                  <>
                    {' '}
                    <SettingsSwitchField
                      controlId='input-audit-enabled'
                      checked={form.watch('enabled')}
                      onCheckedChange={(value) =>
                        form.setValue('enabled', value)
                      }
                      label={t('Collect user messages')}
                      disabled={mutation.isPending}
                    />
                  </>
                )}
                {group === 'evidence' && (
                  <>
                    {' '}
                    <SettingsSwitchField
                      controlId='input-audit-evidence-enabled'
                      checked={form.watch('evidence_enabled')}
                      onCheckedChange={(value) =>
                        form.setValue('evidence_enabled', value)
                      }
                      label={t('Retain conversation transcripts')}
                      disabled={mutation.isPending}
                    />
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Cases keep immutable evidence for their retention period, up to 1000 cases and 256 MiB including decision history.'
                      )}
                    </p>
                  </>
                )}
                {group === 'interception' && (
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Interception capture requires message and evidence collection to be enabled. The character limit applies to each rejected request. Record and storage limits are shared by all users, independently of ordinary evidence. The same retention days apply. Storage counts compressed context plus a 24 KiB reserve per record; database files and indexes use additional space.'
                    )}
                  </p>
                )}
                <FieldGroup className='mt-4 grid gap-4 sm:grid-cols-2'>
                  {fields
                    .filter((field) => {
                      if (group === 'interception') {
                        return field.name.startsWith('match_')
                      }
                      if (group === 'evidence') {
                        return (
                          field.name.startsWith('evidence_') ||
                          field.name === 'case_retention_days'
                        )
                      }
                      return (
                        !field.name.startsWith('match_') &&
                        !field.name.startsWith('evidence_') &&
                        field.name !== 'case_retention_days'
                      )
                    })
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
                          {...form.register(field.name, {
                            valueAsNumber: true,
                          })}
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
            )
          )}
        </Tabs>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Requests from one conversation share a single transcript; each request only stores the items it added. System prompts are stored once and shared. Long items retain excerpts, and tool calls and results keep up to one eighth of the item limit. Images and other media are not stored. Queue overload may drop evidence.'
          )}
        </p>
        <Button className='mt-4' type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      </form>
    </AuditFeatureSurface>
  )
}
