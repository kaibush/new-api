import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'

import {
  getChatCredentials,
  getChatSettings,
  saveChatSettings,
  testChatWeChat,
} from './api'
import { CommunityBotFeedback } from './bot-feedback'
import { CommunityHistory } from './history'

const schema = z.object({
  name: z.string().trim().max(80),
  enabled: z.boolean(),
  bot_enabled: z.boolean(),
  bot_reply: z.string().trim().max(2000),
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
  const verification = useSecureVerification()
  const credentialsRequest = useRef<AbortController | null>(null)
  useEffect(() => () => credentialsRequest.current?.abort(), [])
  const settings = useQuery({
    queryKey: ['community-settings'],
    queryFn: getChatSettings,
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      enabled: false,
      bot_enabled: false,
      bot_name: '助手',
      bot_reply: '',
      app_id: '',
      app_secret: '',
      template_id: '',
      receiver: '',
      callback_token: '',
    },
  })
  useEffect(() => {
    if (settings.data) {
      form.reset({
        ...settings.data.data,
        name: settings.data.data.name || '',
        bot_reply: settings.data.data.bot_reply || '',
        app_secret: '',
        callback_token: '',
      })
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
  const reveal = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async () => {
      const proof = await verification.requestVerification({
        scope: 'community.credentials.read',
        title: t('Verify to view saved credentials'),
      })
      if (!proof) return
      const request = new AbortController()
      credentialsRequest.current = request
      try {
        const credentials = await getChatCredentials(
          proof.proof_token,
          request.signal
        )
        if (request.signal.aborted) return
        for (const field of ['app_secret', 'callback_token'] as const) {
          if (!form.getFieldState(field).isDirty) {
            form.resetField(field, { defaultValue: credentials[field] })
          }
        }
      } finally {
        if (credentialsRequest.current === request) {
          credentialsRequest.current = null
        }
      }
    },
  })
  if (settings.isPending) return <LoadingState />
  if (settings.isError) {
    return <ErrorState onRetry={() => void settings.refetch()} />
  }
  return (
    <SettingsSection title={t('Community chat')}>
      <Tabs defaultValue='settings' className='min-w-0 gap-6'>
        <TabsList
          className='max-w-full justify-start overflow-x-auto'
          aria-label={t('Community chat')}
        >
          <TabsTrigger value='settings' className='flex-none'>
            {t('Settings')}
          </TabsTrigger>
          <TabsTrigger value='feedback' className='flex-none'>
            {t('Bot feedback records')}
          </TabsTrigger>
          <TabsTrigger className='flex-none' value='history'>
            {t('Chat history')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='settings'>
          <SettingsForm
            className='max-w-2xl'
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='community-name'>
                  {t('Chat display name')}
                </FieldLabel>
                <Input
                  id='community-name'
                  maxLength={80}
                  placeholder={t('Community chat')}
                  {...form.register('name')}
                  aria-invalid={Boolean(form.formState.errors.name)}
                />
                <FieldDescription>
                  {t(
                    'Shown in the sidebar and chat header. Leave blank to use the default name.'
                  )}
                </FieldDescription>
              </Field>
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
                  {t('Enable bot replies')}
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
                <FieldLabel htmlFor='bot-reply'>{t('Bot reply')}</FieldLabel>
                <Textarea
                  id='bot-reply'
                  rows={4}
                  maxLength={2000}
                  {...form.register('bot_reply')}
                  aria-invalid={Boolean(form.formState.errors.bot_reply)}
                />
                <FieldDescription>
                  {t(
                    'The bot quotes the mention message and automatically mentions its author. Leave blank to use the default reply.'
                  )}
                </FieldDescription>
              </Field>
              <div className='border-t pt-4'>
                <h4 className='font-medium'>
                  {t('WeChat notifications (optional)')}
                </h4>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {t(
                    'Configured WeChat notifications run in the background without delaying chat replies.'
                  )}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor='wechat-app-id'>WeChat AppID</FieldLabel>
                <Input id='wechat-app-id' {...form.register('app_id')} />
              </Field>
              <Field>
                <FieldLabel htmlFor='wechat-secret'>
                  WeChat AppSecret
                </FieldLabel>
                <PasswordInput
                  id='wechat-secret'
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
                <PasswordInput
                  id='wechat-callback'
                  autoComplete='new-password'
                  {...form.register('callback_token')}
                />
                <FieldDescription>
                  {settings.data.has_callback_token
                    ? t('Secret saved. Leave blank to keep it.')
                    : t('Enter the test account credentials.')}
                </FieldDescription>
              </Field>
              <Field>
                <Button
                  type='button'
                  variant='outline'
                  disabled={
                    reveal.isPending ||
                    save.isPending ||
                    (!settings.data.has_secret &&
                      !settings.data.has_callback_token)
                  }
                  onClick={() => reveal.mutate()}
                >
                  {t('Load saved credentials')}
                </Button>
                <FieldDescription>
                  {t(
                    'Verify your identity to load saved credentials, then use the eye buttons to view them.'
                  )}
                </FieldDescription>
              </Field>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Set the test account callback URL to {{url}} and use the same callback token.',
                  {
                    url: `${window.location.origin}/api/community/wechat/callback`,
                  }
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
                {t(
                  'Chat uploads reuse the help center R2 storage configuration.'
                )}
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
        </TabsContent>
        <TabsContent value='feedback' className='min-w-0'>
          <CommunityBotFeedback />
        </TabsContent>
        <TabsContent value='history' className='min-w-0'>
          <CommunityHistory />
        </TabsContent>
      </Tabs>
      <SecureVerificationDialog {...verification.dialogProps} />
    </SettingsSection>
  )
}
