import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

export function GrokIQSection(props: { baseURL: string }) {
  const { t } = useTranslation()
  const update = useUpdateOption()
  const schema = z.object({
    GrokIQBaseURL: z
      .string()
      .trim()
      .refine((value) => {
        if (!value) return true
        try {
          const url = new URL(value)
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          )
        } catch {
          return false
        }
      }, t('Enter an HTTPS base URL without credentials, query or fragment.')),
    GrokIQAdminToken: z
      .string()
      .trim()
      .refine((value) => !/[\r\n]/.test(value), t('Invalid credential')),
  })
  const defaults = { GrokIQBaseURL: props.baseURL, GrokIQAdminToken: '' }
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  useResetForm(form, defaults)
  const onSubmit = async (values: z.infer<typeof schema>) => {
    const base = values.GrokIQBaseURL.replace(/\/+$/, '')
    if (base !== props.baseURL) {
      await update.mutateAsync({ key: 'GrokIQBaseURL', value: base })
    }
    if (values.GrokIQAdminToken) {
      await update.mutateAsync({
        key: 'GrokIQAdminToken',
        value: values.GrokIQAdminToken,
      })
    }
    form.reset({ GrokIQBaseURL: base, GrokIQAdminToken: '' })
  }
  return (
    <SettingsSection title={t('GrokIQ')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={form.formState.isSubmitting}
            saveLabel='Save'
          />
          <FormField
            control={form.control}
            name='GrokIQBaseURL'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('GrokIQ base URL')}</FormLabel>
                <FormControl>
                  <Input
                    type='url'
                    placeholder='https://grokiq.example.com'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Use the site address without /api. Clear the address to disconnect.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'For personal cards, configure channel headers X-NewAPI-User-ID as {user_id} and X-NewAPI-Username as {username}. Use a GrokIQ instance dedicated to this gateway.'
            )}
          </p>
          <FormField
            control={form.control}
            name='GrokIQAdminToken'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('GrokIQ integration API Key')}</FormLabel>
                <FormControl>
                  <Input
                    type='password'
                    autoComplete='new-password'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Create an integration API Key in GrokIQ Settings → Access and keys with status:read and statistics:read permissions. Choose no expiry for continuous access. Leave blank to keep the saved key. Existing administrator JWTs remain supported.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
