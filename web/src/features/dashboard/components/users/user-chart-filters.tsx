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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { TIME_RANGE_PRESETS } from '@/features/dashboard/constants'
import { saveGranularity } from '@/features/dashboard/lib/filters'
import type {
  UserChartsFilters,
  UserUsageMetric,
} from '@/features/dashboard/types'
import type { TimeGranularity } from '@/lib/time'

interface UserChartFiltersProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
}

export function UserChartFilters(props: UserChartFiltersProps) {
  const { t } = useTranslation()
  const id = useId()

  return (
    <FieldGroup className='grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4'>
      <Field className='min-w-0'>
        <FieldLabel htmlFor={`${id}-metric`}>{t('Usage Metric')}</FieldLabel>
        <NativeSelect
          id={`${id}-metric`}
          className='w-full min-w-0'
          value={props.filters.metric ?? 'quota'}
          onChange={(event) =>
            props.onFiltersChange({
              ...props.filters,
              metric: event.target.value as UserUsageMetric,
            })
          }
        >
          <NativeSelectOption value='quota'>
            {t('Consumption Amount')}
          </NativeSelectOption>
          <NativeSelectOption value='tokens'>
            {t('Token Usage')}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field className='min-w-0'>
        <FieldLabel htmlFor={`${id}-range`}>{t('Date Range')}</FieldLabel>
        <NativeSelect
          id={`${id}-range`}
          className='w-full min-w-0'
          value={props.filters.selectedRange}
          onChange={(event) =>
            props.onFiltersChange({
              ...props.filters,
              selectedRange: Number(event.target.value),
            })
          }
        >
          {TIME_RANGE_PRESETS.map((preset) => (
            <NativeSelectOption key={preset.days} value={preset.days}>
              {preset.days === 1
                ? t('Last 24 hours')
                : t('Last {{days}} days', { days: preset.days })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field className='min-w-0'>
        <FieldLabel htmlFor={`${id}-granularity`}>
          {t('Time Granularity')}
        </FieldLabel>
        <NativeSelect
          id={`${id}-granularity`}
          className='w-full min-w-0'
          value={props.filters.timeGranularity}
          aria-describedby={`${id}-granularity-hint`}
          onChange={(event) => {
            const timeGranularity = event.target.value as TimeGranularity
            saveGranularity(timeGranularity)
            props.onFiltersChange({ ...props.filters, timeGranularity })
          }}
        >
          <NativeSelectOption value='hour'>{t('By hour')}</NativeSelectOption>
          <NativeSelectOption value='day'>{t('By day')}</NativeSelectOption>
          <NativeSelectOption value='week'>
            {t('By week (Mon–Sun)')}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field className='min-w-0'>
        <FieldLabel htmlFor={`${id}-limit`}>{t('Users to display')}</FieldLabel>
        <NativeSelect
          id={`${id}-limit`}
          className='w-full min-w-0'
          value={props.filters.topUserLimit}
          onChange={(event) =>
            props.onFiltersChange({
              ...props.filters,
              topUserLimit: Number(event.target.value),
            })
          }
        >
          {[5, 10, 20, 50].map((limit) => (
            <NativeSelectOption key={limit} value={limit}>
              {t('Top {{count}}', { count: limit })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <p
        id={`${id}-granularity-hint`}
        className='text-muted-foreground text-xs min-[360px]:col-span-2 lg:col-span-4'
      >
        {t(
          'Granularity only changes the trend grouping. Users are ranked by their total over the selected period.'
        )}
      </p>
    </FieldGroup>
  )
}
