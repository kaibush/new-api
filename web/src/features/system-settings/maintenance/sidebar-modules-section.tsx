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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormLabel,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { getChatStatus } from '@/features/community/api'
import {
  CONSOLE_LANDING_PAGES,
  DEFAULT_CONSOLE_PAGE,
  getAvailableConsolePages,
  type ConsoleLandingPage,
} from '@/lib/console-landing'
import { useAuthStore } from '@/stores/auth-store'

import {
  SettingsControlChildren,
  SettingsForm,
  SettingsSwitchContent,
  SettingsControlGroup,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  SIDEBAR_MODULES_DEFAULT,
  type SidebarModulesAdminConfig,
  serializeSidebarModulesAdmin,
} from './config'

type SidebarModulesSectionProps = {
  config: SidebarModulesAdminConfig
  initialSerialized: string
  defaultPage: ConsoleLandingPage
}

const sidebarSchema = z.object({
  modules: z.record(
    z.string(),
    z.object({ enabled: z.boolean() }).catchall(z.boolean())
  ),
  defaultPage: z
    .string()
    .refine(
      (value) => CONSOLE_LANDING_PAGES.some((page) => page.url === value),
      'Select a valid console page.'
    ),
})
type SidebarFormValues = z.infer<typeof sidebarSchema>

const toTitleCase = (value: string) =>
  value
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/\b\w/g, (char) => char.toUpperCase())

export function SidebarModulesSection({
  config,
  initialSerialized,
  defaultPage,
}: SidebarModulesSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const user = useAuthStore((state) => state.auth.user)
  const community = useQuery({
    queryKey: ['community-status'],
    queryFn: getChatStatus,
    staleTime: 30_000,
  })

  const sectionMeta: Record<string, { title: string; description: string }> = {
    chat: {
      title: t('Chat area'),
      description: t('Playground experiments and live conversations.'),
    },
    console: {
      title: t('Console area'),
      description: t('Dashboards, tokens, and usage analytics.'),
    },
    personal: {
      title: t('Personal area'),
      description: t('Wallet management and personal preferences.'),
    },
    admin: {
      title: t('Admin area'),
      description: t('Global configuration and administrative tools.'),
    },
  }

  const moduleMeta: Record<
    string,
    Record<string, { title: string; description: string }>
  > = {
    chat: {
      community: {
        title: t('Community chat'),
        description: t(
          'Show community chat in the sidebar when the feature is enabled.'
        ),
      },
      playground: {
        title: t('Playground'),
        description: t('Experiment with prompts and models in real time.'),
      },
      chat: {
        title: t('Chat'),
        description: t('Access previous conversations and start new ones.'),
      },
    },
    console: {
      channel_status: {
        title: t('Channel status'),
        description: t('Channel availability'),
      },
      detail: {
        title: t('Dashboard'),
        description: t('Aggregated usage metrics and trend charts.'),
      },
      token: {
        title: t('Token management'),
        description: t('Create, revoke, and audit API tokens.'),
      },
      log: {
        title: t('Usage logs'),
        description: t('Detailed request logs for investigations.'),
      },
      audit: {
        title: t('Audit Logs'),
        description: t('Login, security and access records'),
      },
      midjourney: {
        title: t('Drawing logs'),
        description: t('History of MjProxy-style image tasks.'),
      },
      task: {
        title: t('Task logs'),
        description: t('Background job tracker for queued work.'),
      },
    },
    personal: {
      topup: {
        title: t('Wallet'),
        description: t('Top up balance and view billing history.'),
      },
      personal: {
        title: t('Profile'),
        description: t('Personal settings and profile management.'),
      },
      security: {
        title: t('Security & Access'),
        description: t('Manage your security settings and account access'),
      },
    },
    admin: {
      channel: {
        title: t('Channels'),
        description: t('Configure upstream providers and routing.'),
      },
      models: {
        title: t('Models'),
        description: t('Manage catalog visibility and pricing.'),
      },
      redemption: {
        title: t('Redeem codes'),
        description: t('Create and review invite or credit codes.'),
      },
      user: {
        title: t('Users'),
        description: t('Administer user accounts and roles.'),
      },
      checkin: {
        title: t('User activity'),
        description: t('Check-in Rewards'),
      },
      setting: {
        title: t('System settings'),
        description: t('Advanced platform configuration.'),
      },
      subscription: {
        title: t('Subscription Management'),
        description: t('Manage subscription plans and pricing.'),
      },
    },
  }
  const formDefaults = useMemo(
    () => ({ modules: config, defaultPage }),
    [config, defaultPage]
  )

  const form = useForm<SidebarFormValues>({
    resolver: zodResolver(sidebarSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const onSubmit = (values: SidebarFormValues) => {
    const serialized = serializeSidebarModulesAdmin(
      values.modules,
      values.defaultPage
    )
    if (serialized === initialSerialized) {
      return
    }

    updateOption.mutate({
      key: 'SidebarModulesAdmin',
      value: serialized,
    })
  }

  const resetToDefault = () => {
    form.reset({
      modules: SIDEBAR_MODULES_DEFAULT,
      defaultPage: DEFAULT_CONSOLE_PAGE,
    })
  }

  const sections = Object.entries(config)
  const modules = form.watch('modules')
  const availablePages = getAvailableConsolePages(
    serializeSidebarModulesAdmin(modules),
    { ...user, sidebar_modules: undefined },
    community.data?.enabled === true
  )

  return (
    <SettingsSection title={t('Sidebar modules')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={resetToDefault}
            isSaving={updateOption.isPending}
            resetLabel='Reset to default'
            saveLabel='Save sidebar modules'
          />
          <FormField
            control={form.control}
            name='defaultPage'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Default console page')}</FormLabel>
                <FormControl>
                  <NativeSelect {...field} disabled={updateOption.isPending}>
                    {CONSOLE_LANDING_PAGES.map((page) => (
                      <NativeSelectOption
                        key={page.url}
                        value={page.url}
                        disabled={
                          !availablePages.some(
                            (available) => available.url === page.url
                          )
                        }
                      >
                        {t(page.labelKey)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormDescription>
                  {t(
                    'Choose the default page opened from Console or after sign-in. Unavailable pages fall back to an accessible sidebar page.'
                  )}
                </FormDescription>
                <FormDescription>
                  {t(
                    'Community chat can be selected when its feature and sidebar entry are enabled.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {sections.map(([sectionKey, sectionConfig]) => {
            const sectionInfo = sectionMeta[sectionKey] ?? {
              title: toTitleCase(sectionKey),
              description: t('Custom sidebar section'),
            }
            const modules = Object.entries(sectionConfig).filter(
              ([moduleKey]) => moduleKey !== 'enabled'
            )

            return (
              <SettingsControlGroup key={sectionKey}>
                <FormField
                  control={form.control}
                  name={`modules.${sectionKey}.enabled`}
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{sectionInfo.title}</FormLabel>
                        <FormDescription>
                          {sectionInfo.description}
                        </FormDescription>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </SettingsSwitchItem>
                  )}
                />

                <SettingsControlChildren className='grid gap-3 md:grid-cols-2'>
                  {modules.map(([moduleKey]) => {
                    const moduleInfo = moduleMeta[sectionKey]?.[moduleKey] ?? {
                      title: toTitleCase(moduleKey),
                      description: t('Custom module'),
                    }
                    return (
                      <FormField
                        key={`${sectionKey}.${moduleKey}`}
                        control={form.control}
                        name={`modules.${sectionKey}.${moduleKey}`}
                        render={({ field }) => (
                          <SettingsSwitchItem className='py-2'>
                            <SettingsSwitchContent>
                              <FormLabel>{moduleInfo.title}</FormLabel>
                              <FormDescription>
                                {moduleInfo.description}
                              </FormDescription>
                            </SettingsSwitchContent>
                            <FormControl>
                              <Switch
                                checked={Boolean(field.value)}
                                onCheckedChange={field.onChange}
                                disabled={
                                  !form.watch(`modules.${sectionKey}.enabled`)
                                }
                              />
                            </FormControl>
                          </SettingsSwitchItem>
                        )}
                      />
                    )
                  })}
                </SettingsControlChildren>
              </SettingsControlGroup>
            )
          })}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
