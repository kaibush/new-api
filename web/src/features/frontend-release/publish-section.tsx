import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { FrontendRelease } from './store'

const releaseSchema = z.object({
  version: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000),
})
type ReleaseInput = z.infer<typeof releaseSchema>
const queryKey = ['frontend-release-admin']

export function PublishFrontendReleaseSection() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [pending, setPending] = useState<ReleaseInput | null>(null)
  const form = useForm<ReleaseInput>({
    resolver: zodResolver(releaseSchema),
    defaultValues: { version: '', notes: '' },
  })
  const current = useQuery({
    queryKey,
    queryFn: async () =>
      requireServerSuccess(
        (
          await api.get<{ success: boolean; data: FrontendRelease }>(
            '/api/option/frontend-release'
          )
        ).data
      ).data,
  })
  const publish = useMutation({
    mutationFn: async (input: ReleaseInput) =>
      requireServerSuccess(
        (
          await api.post<{ success: boolean; data: FrontendRelease }>(
            '/api/option/frontend-release',
            input
          )
        ).data
      ).data,
    onSuccess: (release) => {
      client.setQueryData(queryKey, release)
      setPending(null)
      form.reset()
      toast.success(t('Version notification published'))
    },
  })
  return (
    <SettingsSection title={t('Frontend version notification')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Deploy the update first, then publish a notification asking online users to refresh.'
        )}
      </p>
      {current.data?.revision ? (
        <p className='text-sm break-all'>
          {t('Latest published version')}: {current.data.version}
        </p>
      ) : null}
      <Form {...form}>
        <form className='space-y-4' onSubmit={form.handleSubmit(setPending)}>
          <FormField
            control={form.control}
            name='version'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Version')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={80} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='notes'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Release notes')}</FormLabel>
                <FormControl>
                  <Textarea {...field} maxLength={2000} rows={4} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type='submit' disabled={publish.isPending}>
            {t('Publish version notification')}
          </Button>
        </form>
      </Form>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !publish.isPending) setPending(null)
        }}
        title={t('Publish version notification')}
        desc={t(
          'All signed-in users with an older open page will be asked to refresh. Continue?'
        )}
        confirmText={t('Publish version notification')}
        isLoading={publish.isPending}
        handleConfirm={() => {
          if (pending) publish.mutate(pending)
        }}
      />
    </SettingsSection>
  )
}
