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
import { ArrowRightLeft, Radio, Terminal } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import {
  WORKBENCH_PROTOCOLS,
  buildWorkbenchSnippet,
  type ProtocolId,
  type SdkClientId,
  type WorkbenchProtocolSpec,
} from '../../constants'

interface ProtocolWorkbenchProps {
  className?: string
  baseUrl: string
  selectedProtocolId: ProtocolId
  onProtocolChange: (id: ProtocolId) => void
}

const ACCENT_STYLES: Record<
  WorkbenchProtocolSpec['accent'],
  { bar: string; badge: string }
> = {
  jade: {
    bar: 'bg-[var(--tidal-jade)]',
    badge:
      'border-[var(--tidal-jade)]/30 bg-[var(--tidal-jade-soft)] text-sky-800 dark:text-sky-200',
  },
  gold: {
    bar: 'bg-[var(--tidal-gold)]',
    badge:
      'border-[var(--tidal-gold)]/30 bg-[var(--tidal-gold-soft)] text-amber-800 dark:text-amber-200',
  },
  coral: {
    bar: 'bg-[var(--tidal-coral)]',
    badge:
      'border-[var(--tidal-coral)]/30 bg-[var(--tidal-coral-soft)] text-rose-700 dark:text-rose-300',
  },
  indigo: {
    bar: 'bg-[var(--tidal-indigo)]',
    badge:
      'border-[var(--tidal-indigo)]/30 bg-[var(--tidal-indigo-soft)] text-indigo-700 dark:text-indigo-300',
  },
}

const STRING_LITERAL_RE = /"[^"]*"|'[^']*'/g

function isGatewayHighlightLine(line: string): boolean {
  return (
    line.includes('baseURL') ||
    line.includes('base_url') ||
    line.includes('baseUrl') ||
    line.trimStart().startsWith('curl ')
  )
}

function tokenizeStrings(input: string, lineId: string): ReactNode {
  const parts: ReactNode[] = []
  let cursor = 0
  const matches = [...input.matchAll(STRING_LITERAL_RE)]

  for (const match of matches) {
    const start = match.index ?? 0
    if (start > cursor) {
      parts.push(
        <span key={`${lineId}-p-${cursor}`} className='text-foreground/75'>
          {input.slice(cursor, start)}
        </span>
      )
    }

    const token = match[0]
    const trailing = input.slice(start + token.length).trimStart()
    const isJsonKey = trailing.startsWith(':')

    parts.push(
      <span
        key={`${lineId}-t-${start}`}
        className={
          isJsonKey
            ? 'text-sky-700 dark:text-sky-300'
            : 'text-amber-700 dark:text-amber-300'
        }
      >
        {token}
      </span>
    )

    cursor = start + token.length
  }

  if (cursor < input.length) {
    parts.push(
      <span key={`${lineId}-tail`} className='text-foreground/75'>
        {input.slice(cursor)}
      </span>
    )
  }

  return parts
}

function renderHighlightedLine(line: string, lineId: string): ReactNode {
  if (!line.trim()) {
    return '\u00A0'
  }

  const trimmed = line.trimStart()
  if (
    trimmed.startsWith('import ') ||
    trimmed.startsWith('from ') ||
    trimmed.startsWith('const ')
  ) {
    const spaceIdx = line.indexOf(' ')
    const keyword = spaceIdx > 0 ? line.slice(0, spaceIdx) : line
    const rest = spaceIdx > 0 ? line.slice(spaceIdx) : ''
    return (
      <>
        <span className='font-medium text-[var(--tidal-coral)]'>{keyword}</span>
        {tokenizeStrings(rest, lineId)}
      </>
    )
  }

  if (trimmed.startsWith('curl ')) {
    return (
      <>
        <span className='font-medium text-sky-700 dark:text-sky-300'>curl</span>
        <span className='text-foreground/95 font-medium'>{line.slice(4)}</span>
      </>
    )
  }

  if (trimmed.startsWith('-H ') || trimmed.startsWith('-d ')) {
    const leadingSpaces = line.length - trimmed.length
    return (
      <>
        <span>{line.slice(0, leadingSpaces)}</span>
        <span className='font-medium text-[var(--tidal-indigo)]'>
          {trimmed.slice(0, 2)}
        </span>
        {tokenizeStrings(trimmed.slice(2), lineId)}
      </>
    )
  }

  return tokenizeStrings(line, lineId)
}

export function ProtocolWorkbench(props: ProtocolWorkbenchProps) {
  const { t } = useTranslation()
  const [client, setClient] = useState<SdkClientId>('curl')

  const activeProtocol =
    WORKBENCH_PROTOCOLS.find((item) => item.id === props.selectedProtocolId) ??
    WORKBENCH_PROTOCOLS[0]

  const codeSnippet = useMemo(
    () => buildWorkbenchSnippet(activeProtocol, client, props.baseUrl),
    [activeProtocol, client, props.baseUrl]
  )

  const codeLines = useMemo(() => codeSnippet.split('\n'), [codeSnippet])

  return (
    <section
      id='protocols'
      aria-labelledby='protocol-workbench-heading'
      className={cn(
        'tidal-hairline-border relative border-t py-20 lg:py-28',
        props.className
      )}
    >
      <div className='mx-auto max-w-7xl px-6 sm:px-8'>
        <AnimateInView
          animation='fade-up'
          className='mb-12 flex flex-col justify-between gap-6 lg:mb-14 lg:flex-row lg:items-end'
        >
          <div className='max-w-2xl'>
            <p className='text-muted-foreground mb-4 font-mono text-[11px] font-medium tracking-[0.2em] uppercase'>
              <span className='text-[var(--tidal-jade)]'>02</span>
              <span className='mx-2 opacity-40'>//</span>
              {t('One connection. More free time.')}
            </p>
            <h2
              id='protocol-workbench-heading'
              className='text-3xl leading-[1.15] font-semibold tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]'
            >
              <span className='block'>
                {t('Swap one URL, finish in three seconds.')}
              </span>
              <span className='tidal-serif tidal-loaf-headline mt-1 block font-normal italic'>
                {t('Spend the rest of the afternoon unwinding.')}
              </span>
            </h2>
          </div>

          <p className='text-muted-foreground max-w-md text-sm leading-6 text-balance lg:text-right'>
            {t(
              'Keep your native OpenAI, Anthropic, or Gemini SDK untouched. Headers, SSE streams, tool calls, and token usage flow straight through.'
            )}
          </p>
        </AnimateInView>

        <div className='grid items-start gap-6 lg:grid-cols-12 lg:gap-8'>
          {/* Left 4 Cols: Protocol Selector Cards */}
          <div className='space-y-2.5 lg:col-span-4'>
            {WORKBENCH_PROTOCOLS.map((protocol) => {
              const active = protocol.id === activeProtocol.id
              const style = ACCENT_STYLES[protocol.accent]

              return (
                <button
                  key={protocol.id}
                  type='button'
                  aria-pressed={active}
                  onClick={() => props.onProtocolChange(protocol.id)}
                  className={cn(
                    'group relative flex w-full cursor-pointer flex-col rounded-xl border p-4 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'tidal-surface border-foreground/20 shadow-sm'
                      : 'border-border/60 bg-background/45 hover:border-border hover:bg-background/85'
                  )}
                >
                  <span
                    aria-hidden='true'
                    className={cn(
                      'absolute inset-y-3 left-0 w-[3px] rounded-r-full transition-opacity duration-200',
                      style.bar,
                      active ? 'opacity-100' : 'opacity-0'
                    )}
                  />

                  <div className='flex items-center justify-between gap-2 pl-1.5'>
                    <span className='text-sm font-semibold tracking-tight'>
                      {t(protocol.nameKey)}
                    </span>
                    <Badge
                      variant='outline'
                      className={cn(
                        'h-5 rounded-md font-mono text-[10px] tracking-wider',
                        active ? style.badge : 'text-muted-foreground'
                      )}
                    >
                      {protocol.badge}
                    </Badge>
                  </div>

                  <code className='text-muted-foreground mt-1.5 truncate pl-1.5 font-mono text-[11px]'>
                    {protocol.method} {protocol.endpoint}
                  </code>

                  <p className='text-muted-foreground/90 mt-2 pl-1.5 text-xs leading-5'>
                    {t(protocol.summaryKey)}
                  </p>
                </button>
              )
            })}

            <div className='tidal-hairline-border bg-muted/25 flex items-start gap-3 rounded-xl border p-3.5 text-xs'>
              <ArrowRightLeft
                aria-hidden='true'
                className='mt-0.5 size-4 shrink-0 text-[var(--tidal-jade)]'
              />
              <div>
                <div className='font-medium'>
                  {t('Cross-Protocol Auto Translation')}
                </div>
                <p className='text-muted-foreground mt-0.5 leading-5'>
                  {t(activeProtocol.bridgeNoteKey)}
                </p>
              </div>
            </div>
          </div>

          {/* Right 8 Cols: Sea-Glass Code Workbench */}
          <div className='tidal-aquarium-chassis flex flex-col overflow-hidden rounded-2xl lg:col-span-8'>
            <div className='tidal-hairline-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5'>
              <div className='flex min-w-0 items-center gap-2.5'>
                <Terminal
                  aria-hidden='true'
                  className='text-muted-foreground size-4 shrink-0'
                />
                <Badge
                  variant='outline'
                  className='border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-teal-300'
                >
                  {activeProtocol.method}
                </Badge>
                <code className='text-foreground/90 truncate font-mono text-xs font-medium'>
                  {activeProtocol.endpoint}
                </code>
              </div>

              <div className='flex items-center gap-2'>
                <Tabs
                  value={client}
                  onValueChange={(value) => setClient(value as SdkClientId)}
                >
                  <TabsList className='h-8 rounded-lg'>
                    <TabsTrigger
                      value='curl'
                      className='px-2.5 font-mono text-xs'
                    >
                      cURL
                    </TabsTrigger>
                    <TabsTrigger
                      value='typescript'
                      className='px-2.5 font-mono text-xs'
                    >
                      TypeScript
                    </TabsTrigger>
                    <TabsTrigger
                      value='python'
                      className='px-2.5 font-mono text-xs'
                    >
                      Python
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <CopyButton
                  value={codeSnippet}
                  variant='outline'
                  size='sm'
                  className='h-8 rounded-lg px-2.5 font-mono text-xs'
                  iconClassName='size-3.5'
                  tooltip={t('Copy request snippet')}
                  successTooltip={t('Copied!')}
                />
              </div>
            </div>

            <div className='tidal-hairline-border grid flex-1 grid-rows-[auto_auto] divide-y'>
              <div className='p-4 sm:p-5'>
                <div className='text-muted-foreground mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.16em] uppercase'>
                  <span>{t('Request')}</span>
                  <span className='text-foreground/65'>
                    {activeProtocol.modelSample}
                  </span>
                </div>
                <pre className='-mx-2 overflow-x-auto font-mono text-[12px] leading-6 sm:text-[13px]'>
                  <code className='block w-max min-w-full'>
                    {codeLines.map((line, lineNumber) => {
                      const stableKey = `${activeProtocol.id}-${client}-L${lineNumber + 1}`
                      const highlighted = isGatewayHighlightLine(line)
                      return (
                        <div
                          key={stableKey}
                          className={cn(
                            'flex gap-4 rounded-sm px-2',
                            highlighted &&
                              'border-l-2 border-[var(--tidal-jade)] bg-[var(--tidal-jade-soft)]'
                          )}
                        >
                          <span
                            aria-hidden='true'
                            className={cn(
                              'w-4 shrink-0 text-right tabular-nums select-none',
                              highlighted
                                ? 'font-medium text-[var(--tidal-jade)]'
                                : 'text-muted-foreground/40'
                            )}
                          >
                            {lineNumber + 1}
                          </span>
                          <span className='min-w-0 whitespace-pre'>
                            {renderHighlightedLine(line, stableKey)}
                          </span>
                        </div>
                      )
                    })}
                  </code>
                </pre>
              </div>

              <div className='bg-muted/20 p-4 sm:p-5 dark:bg-white/[0.015]'>
                <div className='mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-[0.16em] uppercase'>
                  <span className='text-muted-foreground'>{t('Response')}</span>
                  <span className='inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300'>
                    <Radio aria-hidden='true' className='size-3' />
                    200 OK · {t(activeProtocol.usageSummaryKey)}
                  </span>
                </div>
                <pre className='overflow-x-auto font-mono text-[12px] leading-6 sm:text-[13px]'>
                  <code>
                    {activeProtocol.responseLines.map((line, lineNumber) => {
                      const stableKey = `${activeProtocol.id}-resp-L${lineNumber + 1}`
                      return (
                        <div key={stableKey} className='whitespace-pre'>
                          {tokenizeStrings(line, stableKey)}
                        </div>
                      )
                    })}
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
