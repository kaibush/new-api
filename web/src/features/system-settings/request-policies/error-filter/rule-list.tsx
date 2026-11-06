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
import { useState } from 'react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { SettingsSwitchField } from '../../components/settings-form-layout'
import { newRule, type ErrorRule, type ErrorFilterConfig } from './lib/schema'
import { RuleDialog } from './rule-dialog'

type Props = {
  disabled?: boolean
}
export function RuleList(props: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<{
    index: number
    rule: ErrorRule
  } | null>(null)
  const form = useFormContext<ErrorFilterConfig>()
  const array = useFieldArray({ control: form.control, name: 'rules' })
  const rules = useWatch({ control: form.control, name: 'rules' })
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'The first matching enabled rule wins. Empty scopes match all requests.'
          )}
        </p>
        <Button
          type='button'
          variant='outline'
          disabled={props.disabled || rules.length >= 100}
          onClick={() => setEditing({ index: rules.length, rule: newRule() })}
        >
          {t('Add error rule')}
        </Button>
      </div>
      {rules.length === 0 && (
        <p className='text-muted-foreground rounded-lg border border-dashed p-4 text-sm'>
          {t('No error rules. Unmatched errors use the fallback below.')}
        </p>
      )}
      <ol className='flex flex-col gap-3' aria-label={t('Error rules')}>
        {array.fields.map((row, index) => {
          const rule = form.getValues(`rules.${index}`)
          if (!rule) return null
          return (
            <li
              key={row.id}
              className='flex min-w-0 flex-col gap-2 rounded-lg border p-3'
            >
              <SettingsSwitchField
                controlId={`error-rule-${index}`}
                label={rule.name}
                checked={rule.enabled}
                disabled={props.disabled}
                onCheckedChange={(enabled) =>
                  form.setValue(`rules.${index}.enabled`, enabled, {
                    shouldDirty: true,
                  })
                }
              />
              <p className='text-muted-foreground line-clamp-2 text-xs break-all whitespace-pre-wrap'>
                {rule.pattern || t('Any error')}
              </p>
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={props.disabled}
                  aria-label={`${t('Edit')}: ${rule.name}`}
                  onClick={() => setEditing({ index, rule })}
                >
                  {t('Edit')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={props.disabled || index === 0}
                  aria-label={`${t('Move up')}: ${rule.name}`}
                  onClick={() => array.move(index, index - 1)}
                >
                  {t('Move up')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={props.disabled || index === rules.length - 1}
                  aria-label={`${t('Move down')}: ${rule.name}`}
                  onClick={() => array.move(index, index + 1)}
                >
                  {t('Move down')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={props.disabled || rules.length >= 100}
                  aria-label={`${t('Duplicate')}: ${rule.name}`}
                  onClick={() =>
                    array.insert(index + 1, {
                      ...rule,
                      name: `${rule.name.slice(0, 100)} (${t('Copy')})`,
                    })
                  }
                >
                  {t('Duplicate')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={props.disabled}
                  aria-label={`${t('Delete')}: ${rule.name}`}
                  onClick={() => array.remove(index)}
                >
                  {t('Delete')}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      {editing && (
        <RuleDialog
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            if (editing.index === rules.length) array.append(rule)
            else array.update(editing.index, rule)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
