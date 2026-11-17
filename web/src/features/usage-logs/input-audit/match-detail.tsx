import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { UserIdentity } from '@/components/user-identity'
import dayjs from '@/lib/dayjs'
import { useAuthStore } from '@/stores/auth-store'

import { useInputAuditCaseLabels } from './case-labels'
import { decideMatch, getMatch, type MatchRecord } from './match-api'

export function MatchDetail(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const labels = useInputAuditCaseLabels().statuses
  const query = useQuery({
    queryKey: ['input-audit-match', userID, props.id],
    queryFn: () => getMatch(props.id),
    retry: false,
  })
  const data = query.data
  const evidence = data?.evidence
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Match evidence')}
      contentClassName='sm:max-w-3xl'
    >
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Audit evidence is unavailable or expired')}
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            <UserIdentity userId={data.record.user_id} />
            <Badge variant='secondary'>{labels[data.record.status]}</Badge>
            <Badge variant='outline'>
              {data.record.rule || data.record.name}
            </Badge>
          </div>
          <Tabs defaultValue='evidence'>
            <TabsList className='w-full'>
              <TabsTrigger value='evidence'>{t('Match evidence')}</TabsTrigger>
              <TabsTrigger value='review'>{t('Human review')}</TabsTrigger>
            </TabsList>
            <TabsContent value='evidence' className='space-y-4 pt-3'>
              <Alert>
                <AlertDescription>
                  {t(
                    'A keyword match is not proof of a violation. Review the context before deciding.'
                  )}
                </AlertDescription>
              </Alert>
              {!evidence && (
                <p className='text-muted-foreground py-6'>
                  {t(
                    'No match excerpt was captured. Older records cannot be reconstructed.'
                  )}
                </p>
              )}
              {evidence && (
                <>
                  <div className='flex flex-wrap gap-2'>
                    <Badge variant='outline'>
                      {evidence.role || t('Unknown role')}
                    </Badge>
                    <Badge variant='secondary'>
                      {evidence.representation === 'original'
                        ? t('Original text')
                        : t('Transformed matching text')}
                    </Badge>
                    {evidence.serialized && (
                      <Badge variant='outline'>JSON</Badge>
                    )}
                  </div>
                  <p className='text-muted-foreground text-xs [overflow-wrap:anywhere]'>
                    {evidence.path || '/'}
                  </p>
                  {evidence.representation === 'transformed' && (
                    <p className='text-muted-foreground text-sm'>
                      {t(
                        'This excerpt includes normalization or case folding used by the filter; it is not the original text.'
                      )}
                    </p>
                  )}
                  <blockquote className='bg-muted max-h-80 overflow-y-auto rounded-lg border p-4 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap'>
                    {evidence.before}
                    <mark className='bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50'>
                      {evidence.match || t('Zero-length match')}
                    </mark>
                    {evidence.matchTruncated && '…'}
                    {evidence.after}
                  </blockquote>
                  {evidence.truncated && (
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Only bounded context around the decisive match is retained.'
                      )}
                    </p>
                  )}
                </>
              )}
              <Accordion>
                <AccordionItem value='request'>
                  <AccordionTrigger>{t('Request details')}</AccordionTrigger>
                  <AccordionContent>
                    <dl className='grid gap-3 text-sm sm:grid-cols-2'>
                      <div className='min-w-0 sm:col-span-2'>
                        <dt className='text-muted-foreground'>
                          {t('Request ID')}
                        </dt>
                        <dd className='flex items-center gap-2'>
                          <span className='min-w-0 [overflow-wrap:anywhere]'>
                            {data.record.request_id}
                          </span>
                          <CopyButton value={data.record.request_id} />
                        </dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>{t('Plugin')}</dt>
                        <dd className='[overflow-wrap:anywhere]'>
                          {data.record.name} · {data.record.plugin_version}
                        </dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>{t('Stage')}</dt>
                        <dd>{data.record.stage}</dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>{t('Model')}</dt>
                        <dd className='[overflow-wrap:anywhere]'>
                          {data.record.model}
                        </dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>
                          {t('Created at')}
                        </dt>
                        <dd>
                          {dayjs
                            .unix(data.record.created_at)
                            .format('YYYY-MM-DD HH:mm:ss')}
                        </dd>
                      </div>
                    </dl>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
            <TabsContent value='review' className='pt-3'>
              <MatchDecision key={data.record.version} record={data.record} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </Dialog>
  )
}

const decisionSchema = z.object({ status: z.enum(['pending', 'dismissed', 'confirmed', 'insufficient_evidence']), reason: z.string().trim().min(1).max(1000) })

function MatchDecision(props: { record: MatchRecord }) {
  const { t } = useTranslation()
  const labels = useInputAuditCaseLabels().statuses
  const client = useQueryClient()
  const form = useForm<z.infer<typeof decisionSchema>>({
    resolver: zodResolver(decisionSchema),
    defaultValues: { status: props.record.status, reason: props.record.reason },
  })
  const mutation = useMutation({
    mutationFn: (values: { status: string; reason: string }) =>
      decideMatch(props.record.id, {
        ...values,
        version: props.record.version,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['input-audit-match'] })
      void client.invalidateQueries({ queryKey: ['input-audit-matches'] })
    },
  })
  return (
    <form
      className='space-y-4'
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <p className='text-muted-foreground text-sm'>
        {t(
          'Review decisions do not automatically block users or change filter rules.'
        )}
      </p>
      <NativeSelect
        aria-label={t('Review result')}
        {...form.register('status')}
      >
        {(
          [
            'pending',
            'dismissed',
            'confirmed',
            'insufficient_evidence',
          ] as const
        ).map((status) => (
          <NativeSelectOption key={status} value={status}>
            {labels[status]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Textarea
        aria-label={t('Review reason')}
        placeholder={t('Review reason')}
        rows={5}
        maxLength={1000}
        {...form.register('reason', {
          validate: (value) => value.trim().length > 0,
        })}
        aria-invalid={!!form.formState.errors.reason}
      />
      {form.formState.errors.reason && (
        <p role='alert' className='text-destructive text-sm'>
          {t('A review reason is required')}
        </p>
      )}
      {props.record.reviewed_by > 0 && (
        <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
          <UserIdentity userId={props.record.reviewed_by} />
          <span>
            {dayjs.unix(props.record.updated_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>
      )}
      {mutation.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Could not save the review. Refresh if another reviewer changed this record.'
            )}
            <Button
              variant='outline'
              onClick={() =>
                void client.invalidateQueries({
                  queryKey: ['input-audit-match'],
                })
              }
            >
              {t('Refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Button type='submit' disabled={mutation.isPending}>
        {mutation.isPending ? t('Saving...') : t('Save review')}
      </Button>
    </form>
  )
}
