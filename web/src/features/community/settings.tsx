import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'

import { getChatSettings, saveChatSettings, testChatWeChat } from './api'

const schema = z.object({
  enabled: z.boolean(),
  bot_enabled: z.boolean(),
  bot_name: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[^@\s]+$/),
  app_id: z.string().max(128),
  app_secret: z.string().max(128),
  template_id: z.string().max(128),
  receiver: z.string().max(128),
  callback_token: z.string().max(128),
})

export function CommunitySettings() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const settings = useQuery({
    queryKey: ['community-settings'],
    queryFn: getChatSettings,
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      enabled: false,
      bot_enabled: false,
      bot_name: '助手',
      app_id: '',
      app_secret: '',
      template_id: '',
      receiver: '',
      callback_token: '',
    },
  })
  useEffect(() => {
    if (settings.data) {
      form.reset({ ...settings.data.data, app_secret: '', callback_token: '' })
    }
  }, [settings.data, form])
  const save = useMutation({
    mutationFn: saveChatSettings,
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      void client.invalidateQueries({ queryKey: ['community-settings'] })
      void client.invalidateQueries({ queryKey: ['community-status'] })
    },
  })
  const test = useMutation({
    mutationFn: testChatWeChat,
    onSuccess: () => toast.success(t('Test message sent')),
  })
  if (settings.isPending) return <LoadingState />
  if (settings.isError) {
    return <ErrorState onRetry={() => void settings.refetch()} />
  }
  return (
    <SettingsSection title={t('Community chat')}>
      <SettingsForm
        className='max-w-2xl'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='community-enabled'>
              {t('Enable community chat')}
            </FieldLabel>
            <Controller
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <Switch
                  id='community-enabled'
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <FieldDescription>
              {t(
                'The latest 50 messages are shown. All signed-in users can read this chat.'
              )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor='community-bot'>
              {t('Enable WeChat bot notifications')}
            </FieldLabel>
            <Controller
              control={form.control}
              name='bot_enabled'
              render={({ field }) => (
                <Switch
                  id='community-bot'
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='bot-name'>{t('Bot name')}</FieldLabel>
            <Input
              id='bot-name'
              {...form.register('bot_name')}
              aria-invalid={Boolean(form.formState.errors.bot_name)}
            />
            {form.formState.errors.bot_name && (
              <FieldDescription>
                {t('Use 1 to 24 characters without spaces or @.')}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor='wechat-app-id'>WeChat AppID</FieldLabel>
            <Input id='wechat-app-id' {...form.register('app_id')} />
          </Field>
          <Field>
            <FieldLabel htmlFor='wechat-secret'>WeChat AppSecret</FieldLabel>
            <Input
              id='wechat-secret'
              type='password'
              autoComplete='new-password'
              {...form.register('app_secret')}
            />
            <FieldDescription>
              {settings.data.has_secret
                ? t('Secret saved. Leave blank to keep it.')
                : t('Enter the test account credentials.')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor='wechat-template'>
              {t('WeChat template ID')}
            </FieldLabel>
            <Input id='wechat-template' {...form.register('template_id')} />
          </Field>
          <Field>
            <FieldLabel htmlFor='wechat-receiver'>
              {t('Recipient OpenID')}
            </FieldLabel>
            <Input id='wechat-receiver' {...form.register('receiver')} />
            <FieldDescription>
              {t('The recipient must follow this WeChat test account.')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor='wechat-callback'>
              {t('WeChat callback token')}
            </FieldLabel>
            <Input
              id='wechat-callback'
              type='password'
              autoComplete='new-password'
              {...form.register('callback_token')}
            />
            <FieldDescription>
              {settings.data.has_callback_token
                ? t('Secret saved. Leave blank to keep it.')
                : t('Enter the test account credentials.')}
            </FieldDescription>
          </Field>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Set the test account callback URL to {{url}} and use the same callback token.',
              { url: `${window.location.origin}/api/community/wechat/callback` }
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Create a template with these fields: sender, content, time. Add this server IP to the WeChat API allowlist.'
            )}
          </p>
          <pre className='overflow-auto rounded-md border p-3 text-sm'>
            {'{{sender.DATA}}\n{{content.DATA}}\n{{time.DATA}}'}
          </pre>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Images and stickers: 5 MiB. Files: 10 MiB. Attachment links can be shared outside this chat.'
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t('Chat uploads reuse the help center R2 storage configuration.')}
          </p>
          <div className='flex gap-2'>
            <SettingsPageFormActions
              onSave={form.handleSubmit((values) => save.mutate(values))}
              isSaving={save.isPending}
              isSaveDisabled={!form.formState.isDirty}
              saveLabel='Save'
            />
            <Button
              type='button'
              variant='outline'
              disabled={
                test.isPending || save.isPending || form.formState.isDirty
              }
              onClick={() => test.mutate()}
            >
              {t('Send test message')}
            </Button>
          </div>
        </FieldGroup>
      </SettingsForm>
    </SettingsSection>
  )
}
