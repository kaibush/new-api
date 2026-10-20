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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import {
  DataTablePagination,
  StaticDataTable,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { SettingsSection } from '../components/settings-section'
import {
  generateRegistrationInvitations,
  revokeRegistrationInvitation,
  searchRegistrationInvitations,
  type RegistrationInvitation,
} from './registration-invitations-api'

const generationSchema = z.object({
  count: z.number().int().min(1).max(100),
  days: z.number().int().min(1).max(365),
})
const queryKey = ['registration-invitations']

export function RegistrationInvitationsSection() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [revokeTarget, setRevokeTarget] =
    useState<RegistrationInvitation | null>(null)
  const form = useForm<z.infer<typeof generationSchema>>({
    resolver: zodResolver(generationSchema),
    defaultValues: { count: 10, days: 30 },
    mode: 'onChange',
  })
  const list = useQuery({
    queryKey: [...queryKey, pagination.pageIndex, search],
    queryFn: () =>
      searchRegistrationInvitations(pagination.pageIndex + 1, search),
    gcTime: 0,
  })
  const generate = useMutation({
    mutationFn: generateRegistrationInvitations,
    gcTime: 0,
    onSuccess: (data) => {
      setCodes((previous) => [...previous, ...data])
      generate.reset()
      void client.invalidateQueries({ queryKey })
    },
  })
  const revoke = useMutation({
    mutationFn: revokeRegistrationInvitation,
    onSuccess: () => {
      setRevokeTarget(null)
      void client.invalidateQueries({ queryKey })
    },
  })
  const { table } = useDataTable({
    data: list.data?.items ?? [],
    columns: [],
    totalCount: list.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
  })

  return (
    <SettingsSection title={t('Registration invitations')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Each code registers one account. Existing users can log in without a code.'
        )}
      </p>
      <form onSubmit={form.handleSubmit((values) => generate.mutate(values))}>
        <FieldGroup className='sm:flex-row sm:items-end'>
          <Field data-invalid={!!form.formState.errors.count}>
            <FieldLabel htmlFor='invitation-count'>
              {t('Number of codes')}
            </FieldLabel>
            <Input
              id='invitation-count'
              type='number'
              min={1}
              max={100}
              aria-invalid={!!form.formState.errors.count}
              {...form.register('count', { valueAsNumber: true })}
            />
            <FieldDescription>
              {t('Generate 1–100 codes at a time')}
            </FieldDescription>
          </Field>
          <Field data-invalid={!!form.formState.errors.days}>
            <FieldLabel htmlFor='invitation-days'>
              {t('Validity (days)')}
            </FieldLabel>
            <Input
              id='invitation-days'
              type='number'
              min={1}
              max={365}
              aria-invalid={!!form.formState.errors.days}
              {...form.register('days', { valueAsNumber: true })}
            />
            <FieldDescription>{t('Valid for 1–365 days')}</FieldDescription>
          </Field>
          <Button
            type='submit'
            disabled={generate.isPending || !form.formState.isValid}
          >
            {t('Generate invitation codes')}
          </Button>
        </FieldGroup>
      </form>
      {codes.length > 0 && (
        <Field>
          <FieldLabel htmlFor='generated-invitations'>
            {t('Generated invitation codes')}
          </FieldLabel>
          <Textarea
            id='generated-invitations'
            readOnly
            value={codes.join('\n')}
            rows={6}
          />
          <FieldDescription>
            {t(
              'Copy these codes now. Full codes are shown only once; records display a prefix. Search with a full code to find its user.'
            )}
          </FieldDescription>
          <div className='flex gap-2'>
            <CopyButton
              value={codes.join('\n')}
              size='sm'
              variant='outline'
              aria-label={t('Copy invitation codes')}
            >
              {t('Copy invitation codes')}
            </CopyButton>
            <Button variant='ghost' onClick={() => setCodes([])}>
              {t('Clear')}
            </Button>
          </div>
        </Field>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(searchInput.trim())
          setPagination({ pageIndex: 0, pageSize: 20 })
        }}
      >
        <Field>
          <FieldLabel htmlFor='invitation-search'>
            {t('Find by invitation code')}
          </FieldLabel>
          <div className='flex gap-2'>
            <Input
              id='invitation-search'
              value={searchInput}
              maxLength={128}
              autoComplete='off'
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <Button type='submit' variant='outline'>
              {t('Search')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => void list.refetch()}
            >
              {t('Refresh')}
            </Button>
          </div>
        </Field>
      </form>
      {list.isLoading && <LoadingState />}
      {list.isError && <ErrorState onRetry={() => void list.refetch()} />}
      {list.isSuccess && (
        <>
          <StaticDataTable
            data={list.data.items}
            getRowKey={(row) => row.id}
            emptyContent={t('No registration invitations found')}
            columns={[
              {
                id: 'code',
                header: t('Registration invitation code'),
                cell: (row) => `${row.code_prefix}…`,
              },
              {
                id: 'status',
                header: t('Status'),
                cell: (row) => {
                  if (row.used_user_id) return t('Used')
                  if (row.revoked_at) return t('Disabled')
                  if (row.expires_at <= Date.now() / 1000) return t('Expired')
                  return t('Unused')
                },
              },
              {
                id: 'user',
                header: t('Used by'),
                cell: (row) =>
                  row.used_user_id
                    ? `${row.username} (#${formatNumber(row.used_user_id, locale)})`
                    : '—',
              },
              {
                id: 'used',
                header: t('Used at'),
                cell: (row) =>
                  row.used_at
                    ? new Date(row.used_at * 1000).toLocaleString(locale)
                    : '—',
              },
              {
                id: 'expires',
                header: t('Expires at'),
                cell: (row) =>
                  new Date(row.expires_at * 1000).toLocaleString(locale),
              },
              {
                id: 'actions',
                header: t('Actions'),
                cell: (row) => (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={
                      !!row.used_user_id ||
                      !!row.revoked_at ||
                      row.expires_at <= Date.now() / 1000 ||
                      revoke.isPending
                    }
                    onClick={() => setRevokeTarget(row)}
                  >
                    {t('Disable')}
                  </Button>
                ),
              },
            ]}
          />
          <DataTablePagination table={table} compact />
        </>
      )}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={t('Disable invitation code')}
        desc={t('This code will no longer allow registration.')}
        confirmText={t('Disable')}
        isLoading={revoke.isPending}
        handleConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.id)
        }}
      />
    </SettingsSection>
  )
}
