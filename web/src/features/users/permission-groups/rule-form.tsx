import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { MultiSelect, type Option } from '@/components/multi-select'
import { Combobox } from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'

import { EditorDialog } from './editor-dialog'
import {
  nameOptions,
  ruleSchema,
  type Policy,
  type ResourceKind,
} from './lib/policy'

export function ResourceRuleForm(props: {
  kind: ResourceKind
  name?: string
  policy: Policy
  targets: Option[]
  pending: boolean
  onClose: () => void
  onSave: (next: Policy) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const rules = props.policy[props.kind]
  const form = useForm<z.infer<typeof ruleSchema>>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      name: props.name ?? '',
      allowed: props.name === undefined ? [] : rules[props.name],
    },
  })
  const title =
    props.kind === 'models'
      ? t('Restricted models')
      : t('Restricted routing groups')
  return (
    <EditorDialog
      title={title}
      submitLabel={t('Save changes')}
      onClose={props.onClose}
      pending={props.pending}
      onSubmit={form.handleSubmit(({ name, allowed }) =>
        props.onSave({
          ...props.policy,
          [props.kind]: { ...rules, [name]: allowed },
        })
      )}
    >
      {props.name !== undefined ? (
        <p className='font-medium wrap-anywhere'>{props.name}</p>
      ) : (
        <Controller
          name='name'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor={`${id}-target`}>{title}</FieldLabel>
              <Combobox
                popupClassName='max-sm:[&_[role=option]]:min-h-11'
                id={`${id}-target`}
                options={props.targets.filter(
                  ({ value }) => !Object.hasOwn(rules, value)
                )}
                value={field.value}
                onValueChange={(value) => field.onChange(value ?? '')}
                disabled={props.pending}
                aria-invalid={!!fieldState.error}
              />
              {fieldState.error && (
                <FieldError>{t('Select a resource.')}</FieldError>
              )}
            </Field>
          )}
        />
      )}
      <Controller
        name='allowed'
        control={form.control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={`${id}-allowed`}>
              {t('Permission groups')}
            </FieldLabel>
            <MultiSelect
              popupClassName='max-sm:[&_[role=option]]:min-h-11'
              id={`${id}-allowed`}
              className='min-h-11'
              placeholder={t('Hidden from everyone')}
              options={nameOptions(Object.keys(props.policy.audiences))}
              selected={field.value}
              onChange={field.onChange}
              maxVisibleChips={2}
              disabled={props.pending}
            />
            <FieldDescription>
              {t('Leave empty to hide this resource from everyone.')}
            </FieldDescription>
          </Field>
        )}
      />
    </EditorDialog>
  )
}
