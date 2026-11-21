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
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, useDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getInputAudits, type InputAudit } from './api'
import { AuditFeatureSurface } from './feature-surface'
import { InputAuditRequestContent } from './request-content'

interface RequestView {
  visitId: number
  entry: InputAudit
  tab: string
  promptHash: string
  relatedPage: number
}

export function InputAuditDetailsDialog(props: { entry: InputAudit }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<RequestView[]>([])
  const nextVisit = useRef(0)
  const current = views.at(-1) ?? {
    visitId: 0,
    entry: props.entry,
    tab: 'evidence',
    promptHash: '',
    relatedPage: 1,
  }
  const requestHeading = useRef<HTMLHeadingElement>(null)
  const user = useAuthStore((state) => state.auth.user)
  const canRead = user?.role === ROLE.SUPER_ADMIN
  useEffect(() => {
    if (open) requestHeading.current?.focus()
  }, [open, current.entry.id])

  function updateView(changes: Partial<Omit<RequestView, 'entry'>>) {
    setViews((previous) =>
      previous.map((view, index) =>
        index === previous.length - 1 ? { ...view, ...changes } : view
      )
    )
  }

  const related = useQuery({
    queryKey: [
      'input-audit-related',
      user?.id,
      current.entry.user_id,
      current.promptHash,
      current.relatedPage,
    ],
    queryFn: () =>
      getInputAudits({
        p: current.relatedPage,
        page_size: 10,
        ...(current.promptHash
          ? { prompt_hash: current.promptHash }
          : { user_id: current.entry.user_id }),
      }),
    enabled: open && canRead,
    retry: false,
  })
  const { table: relatedTable } = useDataTable({
    data: related.data?.items ?? [],
    columns: [],
    totalCount: related.data?.total ?? 0,
    manualPagination: true,
    pagination: { pageIndex: current.relatedPage - 1, pageSize: 10 },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: current.relatedPage - 1, pageSize: 10 })
          : updater
      updateView({ relatedPage: next.pageIndex + 1 })
    },
  })
  return (
    <AuditFeatureSurface
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setViews([
            {
              visitId: ++nextVisit.current,
              entry: props.entry,
              tab: 'evidence',
              promptHash: '',
              relatedPage: 1,
            },
          ])
        }
        setOpen(value)
      }}
      initialFocus={false}
      title={t('Input Audits')}
      trigger={
        <Button size='sm' variant='ghost'>
          {t('Details')}
        </Button>
      }
      bodyClassName='flex flex-col gap-3'
      contentClassName='sm:max-w-3xl'
    >
      {open && (
        <>
          <header className='flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3'>
            {views.length > 1 && (
              <Button
                variant='outline'
                size='sm'
                className='max-w-full shrink-0 self-start'
                onClick={() => setViews((previous) => previous.slice(0, -1))}
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  data-icon='inline-start'
                  aria-hidden='true'
                />
                <span className='truncate'>
                  {t('Back to previous request')}
                </span>
              </Button>
            )}
            <div className='min-w-0 flex-1'>
              <h3
                ref={requestHeading}
                tabIndex={-1}
                aria-label={`${t('Current request')}: ${current.entry.username} (#${current.entry.user_id}) · ${current.entry.request_id}`}
                className='text-sm font-medium outline-none'
              >
                {current.entry.username} (#{current.entry.user_id}) ·{' '}
                {dayjs
                  .unix(current.entry.created_at)
                  .format('YYYY-MM-DD HH:mm:ss')}
              </h3>
              <p className='text-muted-foreground truncate text-xs'>
                {current.entry.model} · {current.entry.request_id}
              </p>
            </div>
          </header>
          {views.map((view, index) => (
            <div
              key={view.visitId}
              hidden={index !== views.length - 1}
              className={cn(
                'min-w-0',
                index === views.length - 1 ? 'flex flex-col gap-3' : 'hidden'
              )}
            >
              <InputAuditRequestContent
                entry={view.entry}
                active={index === views.length - 1}
                tab={view.tab}
                onTabChange={(tab) => updateView({ tab })}
                onPromptHash={(hash) =>
                  updateView({ promptHash: hash, relatedPage: 1 })
                }
              />
            </div>
          ))}
          {canRead && (
            <>
              <Separator />
              <section
                aria-label={t('Related requests')}
                className='flex flex-col gap-2'
              >
                <h3 className='text-sm font-medium'>
                  {current.promptHash
                    ? t('Requests using this prompt')
                    : t('Recent requests from this user')}
                </h3>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Related requests do not prove they belong to the same conversation.'
                  )}
                </p>
                {current.promptHash && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() =>
                      updateView({ promptHash: '', relatedPage: 1 })
                    }
                  >
                    {t('Recent requests from this user')}
                  </Button>
                )}
                {related.isPending && <LoadingState />}
                {related.isError && (
                  <ErrorState onRetry={() => void related.refetch()} />
                )}
                {related.data?.items.length === 0 && (
                  <EmptyState className='min-h-24' />
                )}
                <ul className='flex flex-col gap-2'>
                  {related.data?.items
                    .filter((entry) => entry.id !== current.entry.id)
                    .map((entry) => (
                      <li
                        key={entry.id}
                        className='flex items-center justify-between gap-3 text-xs'
                      >
                        <div className='min-w-0 flex-1'>
                          <p className='text-muted-foreground'>
                            #{entry.user_id} ·{' '}
                            {dayjs
                              .unix(entry.created_at)
                              .format('MM-DD HH:mm:ss')}{' '}
                            · {entry.model}
                          </p>
                          <p className='truncate'>{entry.content}</p>
                        </div>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => {
                            const visitId = ++nextVisit.current
                            setViews((previous) => [
                              ...previous,
                              { ...current, entry, visitId },
                            ])
                          }}
                        >
                          {t('Details')}
                        </Button>
                      </li>
                    ))}
                </ul>
                {related.data && (
                  <DataTablePagination table={relatedTable} compact />
                )}
              </section>
            </>
          )}
        </>
      )}
    </AuditFeatureSurface>
  )
}
