import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'

export function AccountListField(props: {
  id: string
  label: string
  description?: string
  error?: string
  value: number[]
  disabled: boolean
  onChange: (users: number[]) => void
}) {
  const { t } = useTranslation()
  return (
    <Field data-invalid={!!props.error}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <UserSelector
        multiple
        value={props.value}
        id={props.id}
        popupClassName='flex flex-col max-sm:[&_[role=option]]:min-h-9'
        aria-label={props.label}
        disabled={props.disabled}
        aria-invalid={!!props.error}
        onChange={props.onChange}
      />
      {props.error && <FieldError>{props.error}</FieldError>}
      {props.value.length > 0 && (
        <ul className='divide-y rounded-lg border px-2.5'>
          {props.value.map((userId) => (
            <li
              key={userId}
              className='flex min-w-0 items-center justify-between gap-2 py-1'
            >
              <UserIdentity userId={userId} />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='text-muted-foreground hover:text-destructive shrink-0'
                disabled={props.disabled}
                aria-label={t('Remove user #{{id}}', { id: userId })}
                onClick={() =>
                  props.onChange(
                    props.value.filter((member) => member !== userId)
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {props.description && (
        <FieldDescription>{props.description}</FieldDescription>
      )}
    </Field>
  )
}
