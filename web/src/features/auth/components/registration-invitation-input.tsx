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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type RegistrationInvitationInputProps = {
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  invalid?: boolean
  hint?: boolean
}

export function RegistrationInvitationInput({
  value,
  onChange,
  required = false,
  disabled = false,
  invalid = false,
  hint = false,
}: RegistrationInvitationInputProps) {
  const { t } = useTranslation()
  const controlId = useId()
  const descriptionId = `${controlId}-description`
  const errorId = `${controlId}-error`
  let describedBy: string | undefined
  if (invalid) {
    describedBy = errorId
  } else if (hint) {
    describedBy = descriptionId
  }

  return (
    <Field
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel htmlFor={controlId} required={required}>
        {t('Registration invitation code')}
      </FieldLabel>
      <Input
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('Enter your registration invitation code')}
        aria-required={required || undefined}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={128}
        autoComplete='off'
        className={cn(
          required &&
            !invalid &&
            'border-primary focus-visible:border-primary focus-visible:ring-primary/30'
        )}
      />
      {invalid ? (
        <FieldError id={errorId}>
          {t(
            'A valid registration invitation code is required to create an account'
          )}
        </FieldError>
      ) : null}
      {hint && !invalid ? (
        <FieldDescription id={descriptionId}>
          {t(
            'Only required for new accounts. Existing accounts can sign in without a code.'
          )}
        </FieldDescription>
      ) : null}
    </Field>
  )
}
