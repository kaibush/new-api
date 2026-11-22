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

import { AnimateInView } from '@/components/animate-in-view'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TIDAL_SPECS } from '../../constants'

interface StatsProps {
  className?: string
}

export function Stats(props: StatsProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <section
      aria-label={t('Breathing-room ledger')}
      className={cn(
        'tidal-hairline-border border-y bg-[var(--tidal-surface)]/65 backdrop-blur-xs',
        props.className
      )}
    >
      <div className='mx-auto max-w-7xl px-6 sm:px-8'>
        <div className='tidal-hairline-border grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x'>
          {TIDAL_SPECS.map((spec, idx) => (
            <AnimateInView
              key={spec.index}
              animation='fade-up'
              delay={idx * 55}
              className={cn(
                'py-8 sm:py-10',
                idx > 0 && 'lg:pl-8',
                idx < TIDAL_SPECS.length - 1 && 'lg:pr-8',
                idx % 2 === 1 && 'sm:pl-6 lg:pl-8',
                idx % 2 === 0 && 'sm:pr-6 lg:pr-8'
              )}
            >
              <div className='text-muted-foreground flex items-center justify-between font-mono text-[11px] tracking-[0.16em]'>
                <span>{spec.index}</span>
                <span aria-hidden='true' className='opacity-40'>
                  ✦
                </span>
              </div>

              <div className='tidal-serif mt-3 flex items-baseline gap-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-[2.65rem]'>
                <span>{formatNumber(spec.value, locale)}</span>
                {spec.suffix && (
                  <span className='text-2xl font-normal text-[var(--tidal-gold)]'>
                    {spec.suffix}
                  </span>
                )}
                {typeof spec.secondaryValue === 'number' && (
                  <span className='text-2xl font-normal text-[var(--tidal-jade)]'>
                    +{formatNumber(spec.secondaryValue, locale)}
                  </span>
                )}
              </div>

              <h2 className='mt-2.5 text-sm font-semibold tracking-tight'>
                {t(spec.labelKey)}
              </h2>
              <p className='text-muted-foreground mt-1.5 text-xs leading-5'>
                {t(spec.detailKey)}
              </p>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
