import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { AccountListField } from './account-list-field'
import { EditorDialog } from './editor-dialog'
import {
  nameOptions,
  changeResourceRule,
  excludedAccounts,
  restrictedResources,
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
  const hasAllowlist =
    props.name !== undefined && Object.hasOwn(rules, props.name)
  const restricted = restrictedResources(props.policy, props.kind)
  const form = useForm<z.infer<typeof ruleSchema>>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      name: props.name ?? '',
      scope: props.name === undefined || hasAllowlist ? 'groups' : 'eligible',
      allowed:
        props.name !== undefined && hasAllowlist ? rules[props.name] : [],
      excluded:
        props.name === undefined
          ? []
          : excludedAccounts(props.policy, props.kind, props.name),
    },
  })
  const scope = useWatch({ control: form.control, name: 'scope' })
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
      onSubmit={form.handleSubmit(({ name, scope, allowed, excluded }) =>
        props.onSave(
          changeResourceRule(props.policy, props.kind, name, {
            allowed: scope === 'groups' ? allowed : undefined,
            excluded,
          })
        )
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
                  ({ value }) => !restricted.has(value)
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
      <Field>
        <FieldLabel htmlFor={`${id}-scope`}>{t('Visibility scope')}</FieldLabel>
        <NativeSelect
          id={`${id}-scope`}
          className='w-full [&_select]:min-h-11'
          {...form.register('scope')}
        >
          <NativeSelectOption value='groups'>
            {t('Only selected permission groups')}
          </NativeSelectOption>
          <NativeSelectOption value='eligible'>
            {t('Visible by default, except excluded accounts')}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      {scope === 'groups' && (
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
      )}
      <Controller
        name='excluded'
        control={form.control}
        render={({ field, fieldState }) => (
          <AccountListField
            id={`${id}-excluded`}
            label={t('Excluded accounts')}
            value={field.value}
            onChange={field.onChange}
            disabled={props.pending}
            description={t(
              'Exclusions override group access. With an exclusion list, guests cannot see this resource either.'
            )}
            error={
              fieldState.error &&
              t(
                'Select at least one account to exclude, or remove the rule to restore normal visibility.'
              )
            }
          />
        )}
      />
    </EditorDialog>
  )
}
