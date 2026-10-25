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
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { SettingsPageFrame } from '@/features/system-settings/components/settings-page'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { CheckinActivityPanel } from './components/activity-panel'

const CheckinSettingsSection = lazy(() =>
  import('./components/settings-section').then((module) => ({
    default: module.CheckinSettingsSection,
  }))
)

export function CheckinAdmin() {
  const { t } = useTranslation()
  const canConfigure = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )

  return (
    <SettingsPageFrame title={t('User activity')}>
      {canConfigure ? (
        <Suspense fallback={<LoadingState />}>
          <CheckinSettingsSection />
        </Suspense>
      ) : (
        <CheckinActivityPanel />
      )}
    </SettingsPageFrame>
  )
}
