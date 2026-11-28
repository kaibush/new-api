import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect, type Option } from '@/components/multi-select'
import { Combobox } from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { AccountListField } from './account-list-field'
import { EditorDialog } from './editor-dialog'
import {
  applyResourceRule,
  getResourceRule,
  ruleFormSchema,
  type AccessMode,
  type Policy,
  type ResourceKind,
  type RuleFormValues,
} from './lib/policy'

export function ResourceRuleForm(props: {
  kind: ResourceKind
  names?: string[]
  policy: Policy
  targets: Option[]
  pending: boolean
  onClose: () => void
  onSave: (next: Policy) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const id = useId()
  const fixedNames = props.names ?? []
  const isBatch = fixedNames.length > 1
  const singleName = fixedNames.length === 1 ? fixedNames[0] : undefined

  const initialRule = singleName
    ? getResourceRule(props.policy, props.kind, singleName)
    : null

  const defaultMode: AccessMode =
    initialRule && initialRule.mode !== 'inherit'
      ? initialRule.mode
      : 'all_users'

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      name: singleName ?? '',
      mode: defaultMode,
      allowedGroups: initialRule?.allowedGroups ?? [],
      allowedUsers: initialRule?.allowedUsers ?? [],
      excludedGroups: initialRule?.excludedGroups ?? [],
      excludedUsers: initialRule?.excludedUsers ?? [],
    },
  })

  const mode = useWatch({ control: form.control, name: 'mode' })
  const audienceOptions = Object.keys(props.policy.audiences)
    .sort()
    .map((name) => ({
      value: name,
      label: t('{{name}} (members: {{total}})', {
        name,
        total: formatNumber(props.policy.audiences[name].length, locale),
      }),
    }))

  let title = t('Configure model access')
  if (props.kind === 'groups') {
    title = t('Configure routing group access')
  }
  if (isBatch) {
    title = t('Batch configure access ({{total}})', {
      total: formatNumber(fixedNames.length, locale),
    })
  }

  let modeHint = t(
    'Follows standard channel group and usable group configuration without cross-group overrides.'
  )
  if (mode === 'all_users') {
    modeHint = t(
      'Every logged-in user (except excluded ones) can view and invoke this resource with any regular API key. Unauthenticated guests cannot see it.'
    )
  } else if (mode === 'allowlist') {
    modeHint = t(
      'Only selected permission groups or accounts can view and invoke this resource across regular API keys. Exclusions always take priority.'
    )
  } else if (mode === 'disabled') {
    modeHint = t(
      'Hidden from model lists and blocked from API invocation for all users.'
    )
  }

  const handleValidSubmit = (values: RuleFormValues) => {
    const targetList = fixedNames.length > 0 ? fixedNames : [values.name.trim()]
    if (targetList.length === 0 || !targetList[0]) {
      form.setError('name', { type: 'manual' })
      return
    }
    props.onSave(
      applyResourceRule(props.policy, props.kind, targetList, {
        mode: values.mode,
        allowedGroups: values.allowedGroups,
        allowedUsers: values.allowedUsers,
        excludedGroups: values.excludedGroups,
        excludedUsers: values.excludedUsers,
      })
    )
  }

  return (
    <EditorDialog
      title={title}
      submitLabel={t('Save changes')}
      onClose={props.onClose}
      pending={props.pending}
      onSubmit={form.handleSubmit(handleValidSubmit)}
    >
      {singleName !== undefined && (
        <div className='bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm wrap-anywhere'>
          {singleName}
        </div>
      )}
      {isBatch && (
        <div className='bg-muted/50 max-h-24 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs wrap-anywhere'>
          {fixedNames.join(', ')}
        </div>
      )}
      {fixedNames.length === 0 && (
        <Controller
          name='name'
          control={form.control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor={`${id}-target`}>
                {props.kind === 'models' ? t('Model') : t('Routing group')}
              </FieldLabel>
              <Combobox
                popupClassName='max-sm:[&_[role=option]]:min-h-11'
                id={`${id}-target`}
                options={props.targets}
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
        <FieldLabel htmlFor={`${id}-mode`}>{t('Access mode')}</FieldLabel>
        <NativeSelect
          id={`${id}-mode`}
          className='w-full [&_select]:min-h-11'
          {...form.register('mode')}
        >
          <NativeSelectOption value='all_users'>
            {t('Open to all logged-in users (with optional exclusions)')}
          </NativeSelectOption>
          <NativeSelectOption value='allowlist'>
            {t('Allowlist only (selected permission groups or users)')}
          </NativeSelectOption>
          <NativeSelectOption value='disabled'>
            {t('Hidden from everyone (disabled)')}
          </NativeSelectOption>
          <NativeSelectOption value='inherit'>
            {t('Follow default routing group rules')}
          </NativeSelectOption>
        </NativeSelect>
        <FieldDescription>{modeHint}</FieldDescription>
      </Field>

      {mode === 'allowlist' && (
        <>
          <Controller
            name='allowedGroups'
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor={`${id}-allowed-groups`}>
                  {t('Allowed permission groups')}
                </FieldLabel>
                <MultiSelect
                  popupClassName='max-sm:[&_[role=option]]:min-h-11'
                  id={`${id}-allowed-groups`}
                  className='min-h-11'
                  placeholder={t('Allowed permission groups')}
                  options={audienceOptions}
                  selected={field.value}
                  onChange={field.onChange}
                  maxVisibleChips={2}
                  disabled={props.pending}
                />
                {fieldState.error && (
                  <FieldError>
                    {t(
                      'Select at least one allowed permission group or account, or choose Hidden from everyone.'
                    )}
                  </FieldError>
                )}
              </Field>
            )}
          />
          <Controller
            name='allowedUsers'
            control={form.control}
            render={({ field }) => (
              <AccountListField
                id={`${id}-allowed-users`}
                label={t('Allowed accounts')}
                value={field.value}
                onChange={field.onChange}
                disabled={props.pending}
                description={t(
                  'Grant direct access to specific accounts without creating a permission group.'
                )}
              />
            )}
          />
        </>
      )}

      {(mode === 'all_users' || mode === 'allowlist') && (
        <>
          {audienceOptions.length > 0 && (
            <Controller
              name='excludedGroups'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={`${id}-excluded-groups`}>
                    {t('Excluded permission groups')}
                  </FieldLabel>
                  <MultiSelect
                    popupClassName='max-sm:[&_[role=option]]:min-h-11'
                    id={`${id}-excluded-groups`}
                    className='min-h-11'
                    placeholder={t('Excluded permission groups')}
                    options={audienceOptions}
                    selected={field.value}
                    onChange={field.onChange}
                    maxVisibleChips={2}
                    disabled={props.pending}
                  />
                </Field>
              )}
            />
          )}
          <Controller
            name='excludedUsers'
            control={form.control}
            render={({ field }) => (
              <AccountListField
                id={`${id}-excluded-users`}
                label={t('Excluded accounts')}
                value={field.value}
                onChange={field.onChange}
                disabled={props.pending}
                description={t(
                  'Excluded accounts and groups always take priority over allowlists and default access.'
                )}
              />
            )}
          />
        </>
      )}
    </EditorDialog>
  )
}
