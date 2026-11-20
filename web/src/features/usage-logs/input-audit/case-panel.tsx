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

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { UserIdentity } from '@/components/user-identity'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  createInputAuditCase,
  decideInputAuditCase,
  getInputAuditCase,
  getInputAuditCases,
} from './api'
import { useInputAuditCaseLabels } from './case-labels'
import { InputAuditEvidenceView } from './evidence-view'

const creationSchema = z.object({ reason: z.string().trim().min(1).max(500) })
const decisionSchema = z.object({
  status: z.enum([
    'pending',
    'insufficient_evidence',
    'confirmed',
    'dismissed',
    'appeal_review',
  ]),
  category: z.enum([
    'fraud',
    'cyber_abuse',
    'sexual',
    'dangerous_materials',
    'self_harm',
    'prompt_injection',
    'other',
  ]),
  reason: z.string().trim().min(1).max(2000),
  message_index: z.number().int().min(0),
  quote: z.string().max(4096),
})
type DecisionValues = z.infer<typeof decisionSchema>

export function InputAuditCasePanel(props: {
  auditID?: number
  caseID?: number
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const existing = useQuery({
    queryKey: ['input-audit-case-for-audit', user?.id, props.auditID],
    queryFn: () =>
      getInputAuditCases({ audit_id: props.auditID, page_size: 1 }),
    enabled:
      user?.role === ROLE.SUPER_ADMIN &&
      props.auditID !== undefined &&
      props.caseID === undefined,
    retry: false,
  })
  const creation = useForm<z.infer<typeof creationSchema>>({
    resolver: zodResolver(creationSchema),
    defaultValues: { reason: '' },
  })
  const create = useMutation({
    mutationFn: createInputAuditCase,
    onSuccess: (review) => {
      queryClient.setQueryData(
        ['input-audit-case-for-audit', user?.id, props.auditID],
        { items: [review], total: 1 }
      )
      void queryClient.invalidateQueries({
        queryKey: ['input-audit-cases', user?.id],
      })
    },
  })
  if (user?.role !== ROLE.SUPER_ADMIN) return null
  const caseID = props.caseID ?? existing.data?.items[0]?.id
  if (caseID !== undefined) {
    return <InputAuditCaseReview key={caseID} caseID={caseID} />
  }
  if (existing.isPending) return <LoadingState />
  if (existing.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void existing.refetch()
        }}
      />
    )
  }
  return (
    <form
      aria-label={t('Create review case')}
      onSubmit={creation.handleSubmit((values) => {
        if (props.auditID !== undefined) {
          create.mutate({ audit_id: props.auditID, reason: values.reason })
        }
      })}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='audit-case-create-reason'>
            {t('Review reason')}
          </FieldLabel>
          <Textarea
            id='audit-case-create-reason'
            maxLength={500}
            disabled={create.isPending}
            {...creation.register('reason')}
          />
          {creation.formState.errors.reason && (
            <FieldError>{t('A review reason is required')}</FieldError>
          )}
        </Field>
        <Button type='submit' disabled={create.isPending}>
          {t('Create review case')}
        </Button>
      </FieldGroup>
    </form>
  )
}

function InputAuditCaseReview(props: { caseID: number }) {
  const { t } = useTranslation()
  const labels = useInputAuditCaseLabels()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const queryClient = useQueryClient()
  const key = ['input-audit-case', userID, props.caseID]
  const query = useQuery({
    queryKey: key,
    queryFn: () => getInputAuditCase(props.caseID),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const [version, setVersion] = useState<number>()
  const form = useForm<DecisionValues>({
    resolver: zodResolver(decisionSchema),
    defaultValues: {
      status: 'pending',
      category: 'other',
      reason: '',
      message_index: 0,
      quote: '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: DecisionValues) =>
      decideInputAuditCase(props.caseID, {
        version: version ?? query.data?.case.version ?? 0,
        status: values.status,
        category: values.category,
        reason: values.reason,
        references: values.quote
          ? [{ message_index: values.message_index, quote: values.quote }]
          : [],
      }),
    onSuccess: () => {
      form.reset()
      setVersion(undefined)
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({
        queryKey: ['input-audit-cases', userID],
      })
    },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError || !query.data) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  const detail = query.data
  return (
    <div className='space-y-4'>
      <p className='text-sm'>
        {t('Review case')} #{detail.case.id} ·{' '}
        {labels.statuses[detail.case.status as keyof typeof labels.statuses] ??
          detail.case.status}{' '}
        · {t('Expires at')}:{' '}
        {dayjs.unix(detail.case.expires_at).format('YYYY-MM-DD HH:mm')}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t('Created by')} <UserIdentity userId={detail.case.created_by} /> ·{' '}
        {detail.case.reason}
      </p>
      <Tabs defaultValue='evidence'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='evidence'>{t('Evidence message')}</TabsTrigger>
          <TabsTrigger value='decision'>{t('Decision')}</TabsTrigger>
          <TabsTrigger value='history'>{t('Decision history')}</TabsTrigger>
        </TabsList>
        <TabsContent value='evidence' className='pt-3'>
          <InputAuditEvidenceView
            document={detail.snapshot.document}
            complete={detail.complete}
          />
          {detail.snapshot.allowlist.entries?.length > 0 && (
            <p className='text-muted-foreground text-xs'>
              {t('Allowlist policy version')}:{' '}
              {detail.snapshot.allowlist.version} ·{' '}
              {detail.snapshot.allowlist.entries
                .map((entry) => `${entry.id}: ${entry.reason}`)
                .join('; ')}
            </p>
          )}
        </TabsContent>
        <TabsContent value='decision' className='pt-3'>
          <form
            aria-label={t('Review decision')}
            onChange={() => {
              if (version === undefined) setVersion(detail.case.version)
            }}
            onSubmit={form.handleSubmit((values) => {
              if (
                values.status === 'confirmed' &&
                (!(detail.reviewable ?? detail.complete) ||
                  !values.quote.trim())
              ) {
                form.setError('quote', {
                  message: t(
                    'Retained original text and an exact quote are required'
                  ),
                })
                return
              }
              mutation.mutate(values)
            })}
          >
            <FieldGroup className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='audit-case-status'>
                  {t('Decision')}
                </FieldLabel>
                <NativeSelect
                  id='audit-case-status'
                  disabled={mutation.isPending}
                  {...form.register('status')}
                >
                  {Object.entries(labels.statuses).map(([value, label]) => (
                    <NativeSelectOption
                      key={value}
                      value={value}
                      disabled={
                        value === 'confirmed' &&
                        !(detail.reviewable ?? detail.complete)
                      }
                    >
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='audit-case-category'>
                  {t('Category')}
                </FieldLabel>
                <NativeSelect
                  id='audit-case-category'
                  disabled={mutation.isPending}
                  {...form.register('category')}
                >
                  {Object.entries(labels.categories).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field className='sm:col-span-2'>
                <FieldLabel htmlFor='audit-case-reason'>
                  {t('Review reason')}
                </FieldLabel>
                <Textarea
                  id='audit-case-reason'
                  maxLength={2000}
                  disabled={mutation.isPending}
                  {...form.register('reason')}
                />
                {form.formState.errors.reason && (
                  <FieldError>{t('A review reason is required')}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor='audit-case-message'>
                  {t('Evidence message')}
                </FieldLabel>
                <NativeSelect
                  id='audit-case-message'
                  disabled={mutation.isPending}
                  {...form.register('message_index', { valueAsNumber: true })}
                >
                  {detail.snapshot.document.messages.map((message, index) => (
                    <NativeSelectOption
                      key={message.index ?? message.text}
                      value={index}
                    >
                      #{index + 1} · {message.role}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field className='sm:col-span-2'>
                <FieldLabel htmlFor='audit-case-quote'>
                  {t('Exact evidence quote')}
                </FieldLabel>
                <Textarea
                  id='audit-case-quote'
                  maxLength={4096}
                  disabled={mutation.isPending}
                  {...form.register('quote')}
                />
                {form.formState.errors.quote && (
                  <FieldError>{form.formState.errors.quote.message}</FieldError>
                )}
              </Field>
              {mutation.isError && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t(
                      'The decision was not saved. Your draft is preserved. Refresh explicitly if another reviewer changed the case.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <div className='flex flex-wrap gap-2 sm:col-span-2'>
                <Button type='submit' disabled={mutation.isPending}>
                  {t('Save decision')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  disabled={mutation.isPending || query.isFetching}
                  onClick={async () => {
                    const refreshed = await query.refetch()
                    if (!refreshed.isError) {
                      setVersion(refreshed.data?.case.version)
                    }
                  }}
                >
                  {t('Refresh case version')}
                </Button>
              </div>
            </FieldGroup>
          </form>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Decisions record human review only and do not change account access.'
            )}
          </p>
        </TabsContent>
        <TabsContent value='history' className='pt-3'>
          <section aria-label={t('Decision history')} className='space-y-2'>
            <h3 className='font-medium'>{t('Decision history')}</h3>
            {detail.decisions.map((decision) => (
              <article
                key={decision.id}
                className='space-y-1 rounded-lg border p-3 text-sm'
              >
                <p>
                  {labels.statuses[
                    decision.status as keyof typeof labels.statuses
                  ] ?? decision.status}{' '}
                  ·{' '}
                  {labels.categories[
                    decision.category as keyof typeof labels.categories
                  ] ?? decision.category}{' '}
                  · <UserIdentity userId={decision.created_by} /> ·{' '}
                  {dayjs
                    .unix(decision.created_at)
                    .format('YYYY-MM-DD HH:mm:ss')}
                </p>
                <p className='break-words whitespace-pre-wrap'>
                  {decision.reason}
                </p>
                {decision.references.map((reference) => (
                  <blockquote
                    key={`${reference.message_index}:${reference.quote}`}
                    className='border-l-2 pl-2 break-words whitespace-pre-wrap'
                  >
                    #{reference.message_index + 1} [{reference.start},{' '}
                    {reference.end}): {reference.quote}
                  </blockquote>
                ))}
              </article>
            ))}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
