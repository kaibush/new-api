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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getDatabaseStorage } from '../api'
import type {
  DatabaseCleanupTarget,
  DatabaseStorage,
  DatabaseTableStorage,
} from '../types'
import { DatabaseCleanupDialog } from './database-cleanup-dialog'

export function DatabaseMaintenancePanel() {
  const { t } = useTranslation()
  const [target, setTarget] = useState<DatabaseCleanupTarget | null>(null)
  const storage = useQuery({
    queryKey: ['system-info', 'database'],
    queryFn: getDatabaseStorage,
    staleTime: 60_000,
    retry: false,
  })

  return (
    <TitledCard
      title={t('Database maintenance')}
      description={t(
        'Storage used by the connected databases and their tables.'
      )}
      action={
        <Button
          variant='outline'
          size='sm'
          disabled={storage.isFetching}
          onClick={() => void storage.refetch()}
        >
          {t('Refresh database storage')}
        </Button>
      }
    >
      <div className='space-y-4' aria-busy={storage.isFetching}>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Only request/error logs and visit statistics can be cleaned here. Accounts, balances, orders, funding records and security audits are preserved.'
          )}
        </p>
        {storage.isLoading && <Skeleton className='h-36 w-full' />}
        {storage.isError && (
          <ErrorState
            title={t('Could not load database storage.')}
            description={t(storage.error.message)}
            onRetry={() => void storage.refetch()}
          />
        )}
        {!storage.isError &&
          storage.data?.map((database) => (
            <DatabaseStorageTable
              key={database.scope}
              database={database}
              onCleanup={setTarget}
            />
          ))}
        <p className='text-muted-foreground text-xs'>
          {t(
            'Sizes include table data and indexes, not backups or server logs. Row counts are estimates; unavailable details show —.'
          )}
        </p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Cleanup runs in small batches. Deleted space can be reused by the database; disk files may not shrink immediately.'
          )}
        </p>
        <div className='space-y-2 border-t pt-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Edit business data through its management pages to preserve related records.'
            )}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              role='link'
              variant='outline'
              size='sm'
              render={<Link to='/users' />}
            >
              {t('Users')}
            </Button>
            <Button
              role='link'
              variant='outline'
              size='sm'
              render={<Link to='/channels' />}
            >
              {t('Channels')}
            </Button>
            <Button
              role='link'
              variant='outline'
              size='sm'
              render={<Link to='/redemption-codes' />}
            >
              {t('Redemption Codes')}
            </Button>
          </div>
        </div>
      </div>
      {target && (
        <DatabaseCleanupDialog
          key={target}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </TitledCard>
  )
}

function DatabaseStorageTable(props: {
  database: DatabaseStorage
  onCleanup: (target: DatabaseCleanupTarget) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const database = props.database
  const columns: StaticDataTableColumn<DatabaseTableStorage>[] = [
    {
      id: 'name',
      header: t('Table'),
      cell: (table) => table.name,
      truncate: true,
    },
    {
      id: 'bytes',
      header: t('Total (MiB)'),
      cell: (table) =>
        table.bytes === null
          ? '—'
          : formatNumber(table.bytes / 1024 ** 2, locale),
    },
    {
      id: 'data',
      header: t('Data (MiB)'),
      cell: (table) =>
        table.data_bytes === null
          ? '—'
          : formatNumber(table.data_bytes / 1024 ** 2, locale),
    },
    {
      id: 'indexes',
      header: t('Indexes (MiB)'),
      cell: (table) =>
        table.index_bytes === null
          ? '—'
          : formatNumber(table.index_bytes / 1024 ** 2, locale),
    },
    {
      id: 'rows',
      header: t('Estimated rows'),
      cell: (table) =>
        table.estimated_rows === null
          ? '—'
          : formatNumber(table.estimated_rows, locale),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (table) =>
        table.cleanup_target ? (
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              if (table.cleanup_target) props.onCleanup(table.cleanup_target)
            }}
            aria-label={t('Clean history in {{table}}', { table: table.name })}
          >
            {t('Clean history')}
          </Button>
        ) : (
          <span className='text-muted-foreground'>{t('View only')}</span>
        ),
    },
  ]

  return (
    <section className='min-w-0 space-y-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='min-w-0 text-sm font-medium break-all'>
          {database.scope === 'primary'
            ? t('Primary database')
            : t('Log database')}
          {' · '}
          {database.name}
          {' · '}
          {database.engine}
        </h3>
        {database.available && (
          <span className='text-sm font-semibold tabular-nums'>
            {formatNumber(database.bytes / 1024 ** 2, locale)} MiB
          </span>
        )}
      </div>
      {database.available ? (
        <StaticDataTable
          className='max-h-96 overflow-auto'
          tableClassName='min-w-[720px]'
          tableProps={{ withContainer: false }}
          columns={columns}
          data={database.tables}
          getRowKey={(table) => table.name}
          emptyContent={t('No tables found.')}
          containerProps={{
            role: 'region',
            'aria-label': t('Database tables'),
            tabIndex: 0,
          }}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Storage inspection and cleanup are unavailable for this database engine.'
          )}
        </p>
      )}
    </section>
  )
}
