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
import { VChart } from '@visactor/react-vchart'
import type { IBarChartSpec } from '@visactor/vchart'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { VCHART_OPTION } from '@/lib/vchart'

import type { ActivityDay } from '../api'

export function UserActivityTrend(props: { days: ActivityDay[] }) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const days = props.days
  const spec = useMemo<IBarChartSpec>(() => {
    const values = days.map((item) => ({
      label: new Date(item.day * 1000).toISOString().slice(0, 10),
      value: item.quota,
    }))
    return {
      type: 'bar',
      animation: false,
      data: [{ id: 'user-activity', values }],
      xField: 'label',
      yField: 'value',
      background: 'transparent',
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      axes: [
        {
          orient: 'left',
          label: {
            formatMethod: (value) => formatQuotaWithCurrency(Number(value)),
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: t('Spending'),
              value: (datum) =>
                formatQuotaWithCurrency(Number(datum?.value ?? 0)),
            },
          ],
        },
      },
    }
  }, [days, resolvedTheme, t])
  const title = t('Daily settled spending (UTC)')
  return (
    <section className='min-w-0 space-y-2' aria-label={title}>
      <h4 className='text-sm font-medium'>{title}</h4>
      {days.length === 0 ? (
        <EmptyState title={t('No records')} />
      ) : (
        <>
          <div className='h-56' aria-hidden='true'>
            <VChart spec={spec} option={VCHART_OPTION} />
          </div>
          <ul className='sr-only'>
            {(
              spec.data as Array<{
                values: Array<{ label: string; value: number }>
              }>
            )[0]?.values.map((item) => (
              <li key={item.label}>
                {item.label}: {formatQuotaWithCurrency(item.value)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
