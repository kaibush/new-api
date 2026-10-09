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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'

import { buildPreviewDocument, type HelpItem } from './config'

export function HelpContent(props: { item: HelpItem }) {
  const { t } = useTranslation()
  const document = useMemo(
    () =>
      props.item.kind === 'html'
        ? buildPreviewDocument(props.item.content)
        : '',
    [props.item.kind, props.item.content]
  )
  if (props.item.kind === 'html') {
    return (
      <iframe
        title={props.item.title}
        srcDoc={document}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        className='h-80 w-full rounded-xl border bg-white sm:h-[65dvh]'
      />
    )
  }
  if (props.item.kind === 'link') {
    return (
      <Button
        nativeButton={false}
        role='link'
        render={
          <a
            href={props.item.content}
            target='_blank'
            rel='noopener noreferrer'
          />
        }
      >
        {t('Open link')}
      </Button>
    )
  }
  return (
    <RichContent
      content={props.item.content}
      mode='markdown'
      className='max-w-none min-w-0 break-words'
    />
  )
}
