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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { buildPreviewDocument, type HelpItem } from './config'

export function HelpContent(props: { item: HelpItem }) {
  const { t } = useTranslation()
  const [view, setView] = useState('preview')
  const mode = props.item.htmlViewMode ?? 'both'
  const activeView = mode === 'both' ? view : mode
  const document = useMemo(
    () =>
      props.item.kind === 'html'
        ? buildPreviewDocument(props.item.content)
        : '',
    [props.item.kind, props.item.content]
  )
  if (props.item.kind === 'html') {
    return (
      <div className='min-w-0 space-y-3'>
        {mode === 'both' && (
          <ToggleGroup
            value={[view]}
            onValueChange={(values) => {
              if (values[0]) setView(values[0])
            }}
            variant='outline'
            size='sm'
            aria-label={t('View mode')}
            className='max-w-full'
          >
            <ToggleGroupItem value='preview'>{t('Preview')}</ToggleGroupItem>
            <ToggleGroupItem value='split'>
              {t('Source and preview')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <div
          className={cn(
            'grid min-w-0 gap-3',
            activeView === 'split' && 'lg:grid-cols-2'
          )}
        >
          <div
            hidden={activeView !== 'split'}
            className='h-80 min-w-0 overflow-auto rounded-xl border sm:h-[65dvh]'
          >
            {activeView === 'split' && (
              <CodeBlock
                code={props.item.content}
                language='html'
                filename={`${props.item.id}.html`}
                title={t('HTML source')}
                showLineNumbers
                showToolbar
                enableCollapse={false}
                className='my-0 rounded-none border-0 shadow-none'
              >
                <CodeBlockCopyButton />
              </CodeBlock>
            )}
          </div>
          <iframe
            title={props.item.title}
            srcDoc={document}
            sandbox='allow-scripts'
            referrerPolicy='no-referrer'
            className='h-80 w-full min-w-0 rounded-xl border bg-white sm:h-[65dvh]'
          />
        </div>
      </div>
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
