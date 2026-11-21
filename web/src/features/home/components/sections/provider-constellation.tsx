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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  PROVIDER_CATEGORIES,
  PROVIDER_RIBBON_BOTTOM,
  PROVIDER_RIBBON_TOP,
  PROVIDER_SPECIMENS,
  type ProviderModalityId,
  type ProviderRibbonItem,
} from '../../constants'

interface ProviderConstellationProps {
  className?: string
}

function RibbonTrack(props: {
  items: readonly ProviderRibbonItem[]
  reverse?: boolean
  trackId: string
}) {
  const copies = ['primary', 'duplicate'] as const

  return (
    <div aria-hidden='true' className='tidal-ribbon-mask overflow-hidden py-1'>
      <div
        className={
          props.reverse ? 'tidal-ribbon-track-reverse' : 'tidal-ribbon-track'
        }
      >
        {copies.map((copyTag) => (
          <div key={copyTag} className='flex items-center gap-2.5 pr-2.5'>
            {props.items.map((item) => (
              <div
                key={`${props.trackId}-${copyTag}-${item.id}`}
                className='tidal-hairline-border bg-background/80 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium whitespace-nowrap dark:bg-white/[0.03]'
              >
                <span className='flex size-4 items-center justify-center'>
                  {getLobeIcon(item.iconKey, 15)}
                </span>
                <span className='text-foreground/85'>{item.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProviderConstellation(props: ProviderConstellationProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [category, setCategory] = useState<ProviderModalityId>('all')

  const filteredSpecimens = useMemo(() => {
    if (category === 'all') {
      return PROVIDER_SPECIMENS
    }
    return PROVIDER_SPECIMENS.filter((item) => item.category === category)
  }, [category])

  return (
    <section
      id='providers'
      aria-labelledby='provider-constellation-heading'
      className={cn(
        'tidal-hairline-border relative border-t py-20 lg:py-28',
        props.className
      )}
    >
      <div className='mx-auto max-w-7xl px-6 sm:px-8'>
        <AnimateInView
          animation='fade-up'
          className='mb-10 flex flex-col justify-between gap-6 lg:mb-12 lg:flex-row lg:items-end'
        >
          <div className='max-w-2xl'>
            <p className='text-muted-foreground mb-4 font-mono text-[11px] font-medium tracking-[0.2em] uppercase'>
              <span className='text-[var(--tidal-gold)]'>03</span>
              <span className='mx-2 opacity-40'>//</span>
              {t('Open Waters')}
            </p>
            <h2
              id='provider-constellation-heading'
              className='text-3xl leading-[1.15] font-semibold tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]'
            >
              <span className='block'>{t('Forty-plus AI currents.')}</span>
              <span className='tidal-serif tidal-loaf-headline mt-1 block font-normal italic'>
                {t('Swimming in one calm sea.')}
              </span>
            </h2>
          </div>

          <div className='flex flex-col items-start gap-3 sm:items-end'>
            <Tabs
              value={category}
              onValueChange={(value) =>
                setCategory(value as ProviderModalityId)
              }
            >
              <TabsList className='h-auto flex-wrap justify-start gap-1 rounded-xl p-1'>
                {PROVIDER_CATEGORIES.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className='rounded-lg px-3 py-1.5 text-xs'
                  >
                    {t(tab.labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <span className='text-muted-foreground font-mono text-[11px]'>
              {t('Showing {{count}} featured adapters', {
                count: formatNumber(filteredSpecimens.length, locale),
              })}
            </span>
          </div>
        </AnimateInView>

        <div className='tidal-hairline-border overflow-hidden rounded-2xl border bg-[var(--tidal-hairline)] p-px'>
          <div
            className={cn(
              'grid grid-cols-1 gap-px',
              filteredSpecimens.length === 2 && 'sm:grid-cols-2',
              filteredSpecimens.length === 3 && 'sm:grid-cols-3',
              filteredSpecimens.length >= 4 && 'sm:grid-cols-2 lg:grid-cols-4'
            )}
          >
            {filteredSpecimens.map((specimen) => (
              <div
                key={specimen.id}
                className='group hover:bg-background relative flex flex-col justify-between bg-[var(--tidal-surface)] p-5 transition-colors duration-200'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div
                    aria-hidden='true'
                    className='tidal-hairline-border bg-background/90 flex size-10 shrink-0 items-center justify-center rounded-xl border shadow-2xs transition-transform duration-300 group-hover:-translate-y-0.5 dark:bg-white/[0.04]'
                  >
                    {getLobeIcon(specimen.iconKey, 22)}
                  </div>
                  <Badge
                    variant='outline'
                    className='text-muted-foreground rounded-md font-mono text-[10px] tracking-[0.12em]'
                  >
                    {specimen.code}
                  </Badge>
                </div>

                <div className='mt-5'>
                  <h3 className='text-sm font-semibold tracking-tight'>
                    {specimen.name}
                  </h3>
                  <p className='text-muted-foreground mt-1 text-xs leading-5'>
                    {t(specimen.capabilityKey)}
                  </p>
                </div>

                <span
                  aria-hidden='true'
                  className='absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-[var(--tidal-jade)] transition-transform duration-300 group-hover:scale-x-100'
                />
              </div>
            ))}
          </div>
        </div>

        <div className='mt-8 space-y-2'>
          <RibbonTrack items={PROVIDER_RIBBON_TOP} trackId='top' />
          <RibbonTrack
            items={PROVIDER_RIBBON_BOTTOM}
            reverse
            trackId='bottom'
          />
        </div>
      </div>
    </section>
  )
}
