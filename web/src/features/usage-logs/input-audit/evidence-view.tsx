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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { InputAuditEvidenceDocument } from './api'

export function InputAuditEvidenceView(props: {
  document: InputAuditEvidenceDocument
  complete: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='space-y-3'>
      <Badge variant='secondary'>
        {props.complete
          ? t('Complete submitted text')
          : t('Incomplete evidence')}
      </Badge>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Evidence contains client-submitted messages. Assistant history is not a verified upstream response.'
        )}
      </p>
      {!props.complete && (
        <Alert>
          <AlertDescription>
            {props.document.source === 'legacy_preview'
              ? t('Historical preview; original context was not retained')
              : t(
                  'This evidence has omitted content, missing context or truncated text. It cannot confirm a violation.'
                )}
          </AlertDescription>
        </Alert>
      )}
      <Accordion defaultValue={['message-0']}>
        {props.document.messages.map((message, index) => (
          <AccordionItem
            key={message.index ?? index}
            value={`message-${index}`}
          >
            <AccordionTrigger>
              {t('Message')} {formatNumber(index + 1, locale)} · {message.role}
            </AccordionTrigger>
            <AccordionContent>
              <p className='max-h-64 overflow-y-auto text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
                {message.text}
              </p>
              <CopyButton value={message.text} size='sm'>
                {t('Copy')}
              </CopyButton>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
