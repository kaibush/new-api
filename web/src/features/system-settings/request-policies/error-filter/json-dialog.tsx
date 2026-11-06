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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { Button } from '@/components/ui/button'

import { createConfigSchema, type ErrorFilterConfig } from './lib/schema'

type Props = {
  config: ErrorFilterConfig
  onApply: (config: ErrorFilterConfig) => void
  onClose: () => void
}
export function ConfigJsonDialog(props: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() =>
    JSON.stringify(props.config, null, 2)
  )
  const [error, setError] = useState('')
  const apply = () => {
    try {
      const parsed = createConfigSchema(t).safeParse(JSON.parse(draft))
      if (!parsed.success) {
        setError(
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('\n')
        )
        return
      }
      props.onApply(parsed.data)
    } catch {
      setError(t('Invalid JSON'))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Error filter JSON')}
      description={t(
        'Edit or copy the complete configuration. Applying updates the draft; save settings to activate it.'
      )}
      footer={
        <>
          <Button variant='outline' onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={apply}>{t('Apply configuration')}</Button>
        </>
      }
    >
      <JsonCodeEditor
        value={draft}
        onChange={setDraft}
        ariaLabel={t('Error filter JSON')}
        heightClassName='h-96'
      />
      {error && (
        <p
          role='alert'
          className='text-destructive text-sm whitespace-pre-wrap'
        >
          {error}
        </p>
      )}
    </Dialog>
  )
}
