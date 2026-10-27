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
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPageFrame } from '@/features/system-settings/components/settings-page'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { CheckinActivityPanel } from './components/activity-panel'

const Overview = lazy(() =>
  import('@/features/user-activity/components/overview').then((module) => ({
    default: module.UserActivityOverviewPanel,
  }))
)
const Users = lazy(() =>
  import('@/features/user-activity/components/users').then((module) => ({
    default: module.UserActivityUsersPanel,
  }))
)

export function CheckinAdmin() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('overview')
  const [days, setDays] = useState(30)
  const canConfigure = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  return (
    <SettingsPageFrame title={t('User activity')}>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
            <TabsTrigger value='overview'>{t('Global overview')}</TabsTrigger>
            <TabsTrigger value='users'>{t('User usage')}</TabsTrigger>
            <TabsTrigger value='checkin'>
              {t('Check-in and balances')}
            </TabsTrigger>
          </TabsList>
          <div className='flex items-center gap-2'>
            {tab !== 'checkin' && (
              <Select
                value={String(days)}
                items={[7, 30, 90].map((value) => ({
                  value: String(value),
                  label: t('Last {{count}} days', { count: value }),
                }))}
                onValueChange={(value) => setDays(Number(value))}
              >
                <SelectTrigger className='w-40' aria-label={t('Usage period')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[7, 30, 90].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {t('Last {{count}} days', { count: value })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canConfigure && (
              <Button
                variant='outline'
                size='sm'
                render={
                  <Link
                    to='/system-settings/billing/$section'
                    params={{ section: 'checkin' }}
                  />
                }
              >
                {t('Check-in Settings')}
              </Button>
            )}
          </div>
        </div>
        <TabsContent value='overview' className='pt-3'>
          {tab === 'overview' && (
            <Suspense fallback={<LoadingState />}>
              <Overview days={days} onUsers={() => setTab('users')} />
            </Suspense>
          )}
        </TabsContent>
        <TabsContent value='users' className='pt-3'>
          {tab === 'users' && (
            <Suspense fallback={<LoadingState />}>
              <Users key={days} days={days} />
            </Suspense>
          )}
        </TabsContent>
        <TabsContent value='checkin' className='pt-3'>
          {tab === 'checkin' && <CheckinActivityPanel />}
        </TabsContent>
      </Tabs>
    </SettingsPageFrame>
  )
}
