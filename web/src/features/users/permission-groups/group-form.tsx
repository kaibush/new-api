import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect, type Option } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'

import { EditorDialog } from './editor-dialog'
import {
  changeGroup,
  groupResources,
  groupSchema,
  resourceKinds,
  type GroupForm,
  type Policy,
  type ResourceKind,
} from './lib/policy'

export function PermissionGroupForm(props: {
  policy: Policy
  name?: string
  targets: Record<ResourceKind, Option[]>
  pending: boolean
  onClose: () => void
  onSave: (next: Policy) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const editing = props.name !== undefined
  const form = useForm<GroupForm>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: props.name ?? '',
      members:
        props.name !== undefined ? props.policy.audiences[props.name] : [],
      models: groupResources(props.policy.models, props.name),
      groups: groupResources(props.policy.groups, props.name),
    },
  })
  const nameError = form.formState.errors.name
  return (
    <EditorDialog
      title={editing ? t('Edit permission group') : t('New permission group')}
      pending={props.pending}
      onClose={props.onClose}
      submitLabel={editing ? t('Save changes') : t('Create')}
      onSubmit={form.handleSubmit((group) => {
        if (
          group.name !== props.name &&
          Object.hasOwn(props.policy.audiences, group.name)
        ) {
          form.setError('name', { type: 'duplicate' }, { shouldFocus: true })
          return
        }
        props.onSave(changeGroup(props.policy, props.name, group))
      })}
    >
      <Field data-invalid={!!nameError}>
        <FieldLabel htmlFor={`${id}-name`}>{t('Group name')}</FieldLabel>
        <Input
          id={`${id}-name`}
          className='min-h-11'
          required
          aria-invalid={!!nameError}
          aria-describedby={nameError ? `${id}-error` : undefined}
          {...form.register('name')}
        />
        {nameError && (
          <FieldError id={`${id}-error`}>
            {nameError.type === 'duplicate'
              ? t('A permission group with this name already exists.')
              : t('Enter a group name.')}
          </FieldError>
        )}
      </Field>
      <Controller
        name='members'
        control={form.control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={`${id}-members`}>
              {t('Group members')}
            </FieldLabel>
            <UserSelector
              popupClassName='max-sm:[&_[role=option]]:min-h-11'
              id={`${id}-members`}
              disabled={props.pending}
              onChange={(userId) => {
                if (userId && !field.value.includes(userId)) {
                  field.onChange([...field.value, userId])
                }
              }}
            />
            {field.value.length > 0 && (
              <ul className='divide-y rounded-md border px-2'>
                {field.value.map((userId) => (
                  <li
                    key={userId}
                    className='flex min-w-0 items-center justify-between gap-2'
                  >
                    <UserIdentity userId={userId} />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-11 shrink-0'
                      aria-label={t('Remove user #{{id}}', { id: userId })}
                      onClick={() =>
                        field.onChange(
                          field.value.filter((member) => member !== userId)
                        )
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}
      />
      {resourceKinds.map((kind) => {
        const label =
          kind === 'models'
            ? t('Restricted models')
            : t('Restricted routing groups')
        return (
          <Controller
            key={kind}
            name={kind}
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${id}-${kind}`}>{label}</FieldLabel>
                <MultiSelect
                  popupClassName='max-sm:[&_[role=option]]:min-h-11'
                  id={`${id}-${kind}`}
                  placeholder={label}
                  className='min-h-11'
                  maxVisibleChips={2}
                  selected={field.value}
                  options={props.targets[kind]}
                  onChange={field.onChange}
                  disabled={props.pending}
                />
              </Field>
            )}
          />
        )
      })}
      <FieldDescription>
        {t(
          'Selected resources are visible only to their allowed permission groups. Removing the last group keeps the resource hidden.'
        )}
      </FieldDescription>
    </EditorDialog>
  )
}
