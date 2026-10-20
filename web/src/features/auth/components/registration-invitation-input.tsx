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

type RegistrationInvitationInputProps = {
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
}

export function RegistrationInvitationInput({
  value,
  onChange,
  required = false,
  disabled = false,
}: RegistrationInvitationInputProps) {
  const { t } = useTranslation()
  const controlId = useId()
  const invitationMissing = required && value.trim() === ''
  const descriptionId = `${controlId}-description`
  const errorId = `${controlId}-error`
  let describedBy: string | undefined
  if (invitationMissing) {
    describedBy = errorId
  } else if (!required) {
    describedBy = descriptionId
  }

  return (
    <Field
      data-invalid={invitationMissing || undefined}
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
        required={required}
        disabled={disabled}
        aria-invalid={invitationMissing || undefined}
        aria-describedby={describedBy}
        maxLength={128}
        autoComplete='off'
      />
      {invitationMissing ? (
        <FieldError id={errorId}>
          {t('A registration invitation code is required to continue.')}
        </FieldError>
      ) : null}
      {!required && (
        <FieldDescription id={descriptionId}>
          {t(
            'Only required for new accounts. Existing accounts can sign in without a code.'
          )}
        </FieldDescription>
      )}
    </Field>
  )
}
