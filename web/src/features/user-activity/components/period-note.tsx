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
import { useTranslation } from 'react-i18next'

import dayjs from '@/lib/dayjs'

import type { ActivityPeriod } from '../api'

export function ActivityPeriodNote(props: { period: ActivityPeriod }) {
  const { t } = useTranslation()
  return (
    <p className='text-muted-foreground text-xs'>
      {t('Usage period (UTC)')}:{' '}
      {new Date(props.period.window_start * 1000).toISOString().slice(0, 10)} –{' '}
      {new Date(props.period.as_of * 1000).toISOString().slice(0, 10)} ·{' '}
      {t('Updated at {{date}}', {
        date: dayjs.unix(props.period.as_of).format('YYYY-MM-DD HH:mm:ss'),
      })}
    </p>
  )
}
