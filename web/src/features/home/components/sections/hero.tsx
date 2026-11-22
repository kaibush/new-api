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
import {
  AudioLines,
  Coffee,
  Image,
  MessageCircle,
  Video,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import type { HomeMood, ProtocolId } from '../../constants'
import { CosmicSingularityStage } from '../cosmic-singularity-stage'
import { HeroButtons } from '../hero-buttons'

interface HeroProps {
  className?: string
  isAuthenticated: boolean
  baseUrl: string
  mood: HomeMood
  onMoodChange: (mood: HomeMood) => void
  selectedProtocolId: ProtocolId
  onProtocolChange: (id: ProtocolId) => void
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()

  const statusData = (status?.data ?? status) as
    | { system_name?: string; docs_link?: string }
    | null
    | undefined
  const systemName = statusData?.system_name || 'New API'
  const docsUrl = statusData?.docs_link || 'https://docs.newapi.pro'
  const endpointDisplay = `${props.baseUrl.replace(/\/+$/, '')}/v1`

  return (
    <section
      aria-labelledby='tidal-hero-heading'
      className={cn(
        'relative overflow-hidden pt-8 pb-16 sm:pt-11 lg:pt-12 lg:pb-24',
        props.className
      )}
    >
      <div
        aria-hidden='true'
        className='cosmic-orbital-grid pointer-events-none absolute inset-0'
      />
      <div
        aria-hidden='true'
        className='cosmic-hero-nebula pointer-events-none absolute inset-0'
      />

      <div className='relative z-10 mx-auto max-w-7xl px-6 sm:px-8'>
        {/* Top Deep-Space Horizon Bar + Interactive Work / Loaf Mode Switch */}
        <div className='tidal-hairline-border mb-9 flex flex-wrap items-center justify-between gap-3 border-b pb-4 lg:mb-11'>
          <div className='flex items-center gap-2.5 font-mono text-[11px] tracking-[0.16em] uppercase'>
            <span
              aria-hidden='true'
              className='size-2 rounded-full bg-[var(--tidal-jade)]'
            />
            <span className='font-semibold'>{systemName}</span>
            <span className='text-muted-foreground/45'>/</span>
            <span className='text-muted-foreground'>
              {t('Galactic Compute Roaring · Cosmic Speck Unwinding')}
            </span>
          </div>

          <div
            role='group'
            aria-label={t('Switch homepage mood')}
            className='tidal-hairline-border bg-background/75 inline-flex items-center gap-1 rounded-full border p-1 backdrop-blur-md'
          >
            <button
              type='button'
              aria-pressed={props.mood === 'work'}
              onClick={() => props.onMoodChange('work')}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
                props.mood === 'work'
                  ? 'bg-foreground text-background shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Zap aria-hidden='true' className='size-3' />
              {t('Work Mode')}
            </button>
            <button
              type='button'
              aria-pressed={props.mood === 'loaf'}
              onClick={() => props.onMoodChange('loaf')}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
                props.mood === 'loaf'
                  ? 'bg-[var(--tidal-gold)] text-white shadow-2xs dark:text-slate-950'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Coffee aria-hidden='true' className='size-3' />
              {t('Loaf Mode')}
            </button>
          </div>
        </div>

        {/* Wide 12-Column Editorial Masthead */}
        <div className='grid items-end gap-8 lg:grid-cols-12 lg:gap-10'>
          <div className='min-w-0 lg:col-span-7'>
            <div className='mb-5 flex flex-wrap items-center gap-2.5'>
              <span className='font-mono text-[11px] font-medium tracking-[0.18em] text-[var(--tidal-gold)] uppercase'>
                00 // {t('Before the vast cosmos, claim a quiet hour')}
              </span>
              <span className='rounded-full border border-[var(--tidal-jade)]/30 bg-[var(--tidal-jade-soft)] px-2.5 py-0.5 font-mono text-[10px] font-medium text-sky-800 dark:text-sky-200'>
                {props.mood === 'loaf'
                  ? t('Paid Daydreaming Cleared')
                  : t('40+ Star Systems Standing By')}
              </span>
            </div>

            <h1
              id='tidal-hero-heading'
              className='text-[clamp(2.65rem,5vw,4.6rem)] leading-[1.08] font-semibold tracking-[-0.032em]'
            >
              <span className='block'>{t('Work in order.')}</span>
              <span className='relative mt-2 inline-block'>
                <span className='tidal-serif tidal-loaf-headline font-normal italic'>
                  {t('Unwind at ease.')}
                </span>
                <svg
                  aria-hidden='true'
                  viewBox='0 0 300 18'
                  fill='none'
                  preserveAspectRatio='none'
                  className='mt-1.5 h-3.5 w-full'
                >
                  <path
                    d='M 4 14 Q 150 -2 296 14'
                    stroke='url(#hero-orbit-stroke)'
                    strokeWidth='2.5'
                    strokeLinecap='round'
                  />
                  <circle cx='236' cy='8' r='2.8' fill='var(--tidal-gold)' />
                  <defs>
                    <linearGradient
                      id='hero-orbit-stroke'
                      x1='0%'
                      y1='0%'
                      x2='100%'
                      y2='0%'
                    >
                      <stop offset='0%' stopColor='var(--tidal-jade)' />
                      <stop offset='52%' stopColor='var(--tidal-gold)' />
                      <stop offset='100%' stopColor='var(--tidal-indigo)' />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
            </h1>

            <p className='text-muted-foreground mt-5 max-w-2xl text-base leading-7 text-balance sm:text-[1.05rem]'>
              {t(
                'Trillions of tokens surge across orbital AI star systems while you float easy in one quiet corner of the galaxy. Models, accounts, and inspiration in one place—let the cosmos handle the busywork, and keep the afternoon for yourself.'
              )}
            </p>
          </div>

          {/* Right 5 Columns: Mission-Control Endpoint & Launch Actions */}
          <div className='min-w-0 lg:col-span-5 lg:pb-1'>
            <div className='tidal-hairline-border bg-background/85 flex w-full items-center justify-between gap-2 rounded-xl border p-1.5 pl-3.5 shadow-2xs backdrop-blur-md dark:bg-[#091122]/90'>
              <div className='flex min-w-0 items-center gap-2.5 font-mono text-xs'>
                <span className='text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase'>
                  BASE URL
                </span>
                <code className='text-foreground/90 truncate'>
                  {endpointDisplay}
                </code>
              </div>
              <CopyButton
                value={endpointDisplay}
                size='icon'
                variant='ghost'
                className='size-8 shrink-0 rounded-lg'
                iconClassName='size-3.5'
                tooltip={t('Copy gateway endpoint')}
                successTooltip={t('Copied!')}
              />
            </div>

            <div className='mt-5'>
              <HeroButtons
                isAuthenticated={props.isAuthenticated}
                docsUrl={docsUrl}
              />
            </div>

            <ul className='tidal-hairline-border text-muted-foreground mt-6 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t pt-4 text-xs'>
              <li className='flex items-center gap-2'>
                <span
                  aria-hidden='true'
                  className='flex size-7 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-400'
                >
                  <MessageCircle className='size-3.5' />
                </span>
                <span>{t('Chat')}</span>
              </li>
              <li className='flex items-center gap-2'>
                <span
                  aria-hidden='true'
                  className='flex size-7 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                >
                  <Image className='size-3.5' />
                </span>
                <span>{t('Image')}</span>
              </li>
              <li className='flex items-center gap-2'>
                <span
                  aria-hidden='true'
                  className='flex size-7 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400'
                >
                  <Video className='size-3.5' />
                </span>
                <span>{t('Video')}</span>
              </li>
              <li className='flex items-center gap-2'>
                <span
                  aria-hidden='true'
                  className='flex size-7 items-center justify-center rounded-lg bg-rose-500/12 text-rose-600 dark:text-rose-400'
                >
                  <AudioLines className='size-3.5' />
                </span>
                <span>{t('Audio')}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Full-Width 12-Column Panoramic 21:9 3D Cosmic Singularity Observatory */}
        <div className='mt-10 lg:mt-12'>
          <CosmicSingularityStage
            mood={props.mood}
            selectedProtocolId={props.selectedProtocolId}
            onProtocolChange={props.onProtocolChange}
          />
        </div>
      </div>
    </section>
  )
}
