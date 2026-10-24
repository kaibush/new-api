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
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'

import type { CheckinDay } from '../types'

export function CheckinActivityChart(props: {
  days?: CheckinDay[]
  distribution?: Array<{ label: string; count: number }>
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { resolvedTheme } = useTheme()
  const days = props.days
  const distribution = props.distribution
  const spec = useMemo<IBarChartSpec>(() => {
    const values =
      distribution?.map((item) => ({ label: item.label, value: item.count })) ??
      (days ?? []).map((item) => ({
        label: new Date(item.day * 1000).toISOString().slice(0, 10),
        value: item.quota,
      }))
    return {
      type: 'bar',
      data: [{ id: 'checkin', values }],
      xField: 'label',
      yField: 'value',
      background: 'transparent',
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      axes: [
        {
          orient: 'left',
          label: {
            formatMethod: (value) =>
              distribution
                ? formatNumber(Number(value), locale)
                : formatQuotaWithCurrency(Number(value)),
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: distribution ? t('Users') : t('Spending'),
              value: (datum) =>
                distribution
                  ? formatNumber(Number(datum?.value ?? 0), locale)
                  : formatQuotaWithCurrency(Number(datum?.value ?? 0)),
            },
          ],
        },
      },
    }
  }, [days, distribution, resolvedTheme, locale, t])
  const title = distribution
    ? t('Spending achievement distribution')
    : t('Daily settled spending (UTC)')
  return (
    <section className='min-w-0 space-y-2' aria-label={title}>
      <h4 className='text-sm font-medium'>{title}</h4>
      {(distribution?.length ?? days?.length ?? 0) === 0 ? (
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
                {item.label}:{' '}
                {distribution
                  ? formatNumber(item.value, locale)
                  : formatQuotaWithCurrency(item.value)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
