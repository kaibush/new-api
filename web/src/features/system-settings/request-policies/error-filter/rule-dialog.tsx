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
import { useMemo } from 'react'
import { useForm, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import { SettingsSwitchField } from '../../components/settings-form-layout'
import {
  createRuleFormSchema,
  type ErrorRule,
  type RuleFormValues,
} from './lib/schema'

type Props = {
  rule: ErrorRule
  onSave: (rule: ErrorRule) => void
  onClose: () => void
}
export function RuleDialog(props: Props) {
  const { t } = useTranslation()
  const schema = useMemo(() => createRuleFormSchema(t), [t])
  const { channels, ...defaults } = props.rule
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...defaults, channels_text: channels.join(', ') },
  })
  const values = useWatch({ control: form.control })
  const submit = form.handleSubmit(({ channels_text, ...rule }) => {
    props.onSave({
      ...rule,
      channels: channels_text.trim()
        ? channels_text.split(',').map(Number)
        : [],
    })
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Edit error rule')}
      description={t(
        'The first matching enabled rule wins. Empty scopes match all requests.'
      )}
      footer={
        <>
          <Button variant='outline' onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={submit}>{t('Apply rule')}</Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <RuleText name='name' label={t('Rule name')} />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchField
                controlId='rule-enabled'
                label={t('Enable rule')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <div className='grid gap-4 sm:grid-cols-2'>
            <RuleSelect
              name='field'
              label={t('Match field')}
              options={[
                ['message', t('Message')],
                ['type', t('Error type')],
                ['code', t('Error code')],
              ]}
            />
            <RuleSelect
              name='match'
              label={t('Match mode')}
              options={[
                ['contains', t('Contains')],
                ['exact', t('Exact match')],
                ['regex', t('Regular expression')],
                ['any', t('Any error')],
              ]}
            />
          </div>
          {values.match !== 'any' && (
            <RuleText name='pattern' label={t('Match pattern')} multiline />
          )}
          <FormField
            control={form.control}
            name='case_sensitive'
            render={({ field }) => (
              <SettingsSwitchField
                controlId='rule-case'
                label={t('Case sensitive')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <RuleSelect
            name='action'
            label={t('Error action')}
            options={[
              ['replace', t('Replace entire message')],
              ['redact', t('Replace matching text')],
              ['preserve', t('Keep existing response')],
            ]}
          />
          {values.action !== 'preserve' && (
            <>
              <RuleText
                name='replacement'
                label={t('Replacement message')}
                multiline
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Messages support {status} and {request_id}. Regex partial replacements support $1 and ${name}. Use RE2 syntax; lookaround and backreferences are not supported.'
                )}
              </p>
              <div className='grid gap-4 sm:grid-cols-2'>
                <OutputOverride
                  name='output_type'
                  label={t('Override error type')}
                />
                <OutputOverride
                  name='output_code'
                  label={t('Override error code')}
                />
              </div>
            </>
          )}
          <div className='grid gap-4 sm:grid-cols-2'>
            <RuleText
              name='statuses'
              label={t('HTTP statuses')}
              placeholder='413, 429, 500-599'
            />
            <RuleText
              name='channels_text'
              label={t('Channel IDs')}
              placeholder='1, 2, 3'
            />
          </div>
          <RuleText
            name='model_pattern'
            label={t('Model pattern (RE2)')}
            placeholder='^deepseek-'
          />
        </form>
      </Form>
    </Dialog>
  )
}

type TextName =
  | 'name'
  | 'pattern'
  | 'replacement'
  | 'statuses'
  | 'channels_text'
  | 'model_pattern'
function RuleText(props: {
  name: TextName
  label: string
  placeholder?: string
  multiline?: boolean
}) {
  const form = useFormContext<RuleFormValues>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            {props.multiline ? (
              <Textarea {...field} rows={3} />
            ) : (
              <Input {...field} placeholder={props.placeholder} />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
function RuleSelect(props: {
  name: 'field' | 'match' | 'action'
  label: string
  options: [string, string][]
}) {
  const form = useFormContext<RuleFormValues>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            <NativeSelect {...field}>
              {props.options.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
function OutputOverride(props: {
  name: 'output_type' | 'output_code'
  label: string
}) {
  const form = useFormContext<RuleFormValues>()
  const { t } = useTranslation()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <SettingsSwitchField
            controlId={props.name}
            label={props.label}
            checked={field.value !== undefined}
            onCheckedChange={(checked) =>
              field.onChange(checked ? '' : undefined)
            }
          />
          {field.value !== undefined && (
            <FormControl>
              <Input
                {...field}
                aria-label={props.label}
                placeholder={t('Empty clears the value')}
              />
            </FormControl>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
