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
import type { QueryClient } from '@tanstack/react-query'

import { getChatStatus } from '@/features/community/api'
import { ROLE } from '@/lib/roles'
import {
  isModuleEnabled,
  parseSidebarConfig,
  parseUserSidebarConfig,
} from '@/lib/sidebar-modules'
import { statusQueryOptions } from '@/lib/status-query'

// Fixed sidebar destinations only: never use a stored value as an arbitrary URL.
export const CONSOLE_LANDING_PAGES = [
  { url: '/dashboard/overview', labelKey: 'Overview' },
  { url: '/dashboard/models', labelKey: 'Dashboard' },
  { url: '/community', labelKey: 'Community chat' },
  { url: '/playground', labelKey: 'Playground' },
  { url: '/channel-status', labelKey: 'Channel status' },
  { url: '/keys', labelKey: 'API Keys' },
  { url: '/usage-logs/common', labelKey: 'Usage Logs' },
  { url: '/usage-logs/audit', labelKey: 'Audit Logs' },
  {
    url: '/usage-logs/task',
    labelKey: 'Task Logs',
    configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
  },
  { url: '/wallet', labelKey: 'Wallet' },
  { url: '/profile', labelKey: 'Profile' },
  { url: '/security', labelKey: 'Security & Access' },
  {
    url: '/visit-analytics',
    labelKey: 'Visit analytics',
    requiredRole: ROLE.ADMIN,
  },
  { url: '/channels', labelKey: 'Channels', requiredRole: ROLE.ADMIN },
  { url: '/models/metadata', labelKey: 'Models', requiredRole: ROLE.ADMIN },
  { url: '/users', labelKey: 'Users', requiredRole: ROLE.ADMIN },
  { url: '/checkin', labelKey: 'User activity', requiredRole: ROLE.ADMIN },
  {
    url: '/redemption-codes',
    labelKey: 'Redemption Codes',
    requiredRole: ROLE.ADMIN,
  },
  {
    url: '/subscriptions',
    labelKey: 'Subscriptions',
    requiredRole: ROLE.ADMIN,
  },
  {
    url: '/system-info',
    labelKey: 'System Info',
    requiredRole: ROLE.SUPER_ADMIN,
  },
  {
    url: '/task-plugins',
    labelKey: 'Task Plugins',
    requiredRole: ROLE.SUPER_ADMIN,
  },
  {
    url: '/system-settings/site',
    labelKey: 'System Settings',
    requiredRole: ROLE.SUPER_ADMIN,
  },
] as const

export type ConsoleLandingPage = (typeof CONSOLE_LANDING_PAGES)[number]['url']
export const DEFAULT_CONSOLE_PAGE: ConsoleLandingPage = '/dashboard/overview'

export function parseConsoleDefaultPage(
  raw: string | null | undefined
): ConsoleLandingPage {
  try {
    const value: unknown = JSON.parse(raw || '{}').default_page
    return (
      CONSOLE_LANDING_PAGES.find((page) => page.url === value)?.url ??
      DEFAULT_CONSOLE_PAGE
    )
  } catch {
    return DEFAULT_CONSOLE_PAGE
  }
}

export type ConsoleNavigationUser = {
  role?: number
  sidebar_modules?: string
  permissions?: { sidebar_settings?: boolean }
}

export function getAvailableConsolePages(
  raw: string | null | undefined,
  user: ConsoleNavigationUser | null | undefined,
  communityEnabled: boolean
) {
  const adminConfig = parseSidebarConfig(raw)
  const userConfig =
    user?.permissions?.sidebar_settings === false
      ? null
      : parseUserSidebarConfig(user?.sidebar_modules)
  const role = user?.role ?? ROLE.USER
  return CONSOLE_LANDING_PAGES.filter((page) => {
    if ('requiredRole' in page && role < page.requiredRole) return false
    if ('requiredRole' in page && adminConfig.admin.enabled === false) {
      return false
    }
    if (page.url === '/community' && !communityEnabled) return false
    const configUrls = 'configUrls' in page ? page.configUrls : [page.url]
    return configUrls.some((url) =>
      isModuleEnabled(url, adminConfig, userConfig)
    )
  })
}

export function resolveConsoleLanding(
  raw: string | null | undefined,
  user: ConsoleNavigationUser | null | undefined,
  communityEnabled: boolean
): ConsoleLandingPage {
  const pages = getAvailableConsolePages(raw, user, communityEnabled)
  const preferred = parseConsoleDefaultPage(raw)
  return (
    pages.find((page) => page.url === preferred)?.url ??
    pages.find((page) => page.url === DEFAULT_CONSOLE_PAGE)?.url ??
    pages[0]?.url ??
    '/profile'
  )
}

// The generic console entry waits for fresh settings; explicit page URLs keep
// their own route and are never replaced by the configured landing preference.
export async function getConsoleLandingForGuard(
  queryClient: QueryClient,
  user: ConsoleNavigationUser | null | undefined
): Promise<ConsoleLandingPage> {
  const status = await queryClient
    .fetchQuery(statusQueryOptions)
    .catch(() => null)
  const raw =
    typeof status?.SidebarModulesAdmin === 'string'
      ? status.SidebarModulesAdmin
      : undefined
  let communityEnabled = false
  if (parseConsoleDefaultPage(raw) === '/community') {
    const community = await queryClient
      .fetchQuery({
        queryKey: ['community-status'],
        queryFn: getChatStatus,
        staleTime: 30_000,
        retry: false,
      })
      .catch(() => null)
    communityEnabled = community?.enabled === true
  }
  return resolveConsoleLanding(raw, user, communityEnabled)
}
