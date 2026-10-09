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
import { Activity, Eye, MousePointerClick, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { VisitReport } from './api'

export function VisitSummary(props: { data: VisitReport }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data = props.data
  return (
    <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
      <Card>
        <CardContent className='pt-5'>
          <StatCard
            title={t('Page views (PV)')}
            value={formatNumber(data.pv, locale)}
            description={t('Page loads and navigation')}
            icon={Eye}
            sparkline={data.trend.map((row) => row.pv)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className='pt-5'>
          <StatCard
            title={t('Unique visitors (UV)')}
            value={formatNumber(data.uv, locale)}
            description={t('Deduplicated across the selected period')}
            icon={Users}
            sparkline={data.trend.map((row) => row.uv)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className='pt-5'>
          <StatCard
            title={t('Visit sessions')}
            value={formatNumber(data.sessions, locale)}
            description={t('New session after 30 minutes of inactivity')}
            icon={MousePointerClick}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className='pt-5'>
          <StatCard
            title={t('Signed-in visitors')}
            value={formatNumber(data.users, locale)}
            description={t('Distinct signed-in accounts')}
            icon={Activity}
          />
        </CardContent>
      </Card>
    </div>
  )
}
