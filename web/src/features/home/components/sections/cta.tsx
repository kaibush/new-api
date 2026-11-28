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
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

interface CTAProps {
  className?: string
  isAuthenticated?: boolean
}

const STACK_FOOTPRINT = [
  'Go + React',
  'Docker / Single Binary',
  'SQLite · MySQL · PostgreSQL',
  'Redis · ClickHouse',
] as const

export function CTA(props: CTAProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const statusData = (status?.data ?? status) as
    | Record<string, unknown>
    | null
    | undefined
  const docsUrl =
    (typeof statusData?.docs_link === 'string' && statusData.docs_link) ||
    'https://docs.newapi.pro'
  const isExternalDocs = docsUrl.startsWith('http')
  const navModules = parseHeaderNavModulesFromStatus(statusData ?? null)
  const canViewPricing =
    Boolean(props.isAuthenticated) && navModules.pricing.enabled

  return (
    <section
      aria-labelledby='home-cta-heading'
      className={cn(
        'tidal-hairline-border border-t pt-12 pb-20 lg:pt-16 lg:pb-28',
        props.className
      )}
    >
      <div className='mx-auto max-w-7xl px-6 sm:px-8'>
        <AnimateInView
          animation='fade-up'
          className='tidal-sanctuary-monolith relative overflow-hidden rounded-3xl px-6 py-16 sm:px-12 sm:py-20 lg:px-20'
        >
          {/* Event-Horizon Relativistic Eclipse Arc */}
          <svg
            aria-hidden='true'
            viewBox='0 0 1200 260'
            preserveAspectRatio='none'
            className='pointer-events-none absolute inset-x-0 top-0 h-56 w-full'
          >
            <defs>
              <linearGradient
                id='cta-eclipse-arc'
                x1='0%'
                y1='0%'
                x2='100%'
                y2='0%'
              >
                <stop offset='0%' stopColor='#38bdf8' stopOpacity='0' />
                <stop offset='26%' stopColor='#38bdf8' stopOpacity='0.78' />
                <stop offset='50%' stopColor='#fbbf24' stopOpacity='0.95' />
                <stop offset='74%' stopColor='#a78bfa' stopOpacity='0.78' />
                <stop offset='100%' stopColor='#fb7185' stopOpacity='0' />
              </linearGradient>
            </defs>
            <path
              d='M 0 185 Q 600 -5 1200 185'
              fill='none'
              stroke='url(#cta-eclipse-arc)'
              strokeWidth='1.8'
            />
            <path
              d='M 120 225 Q 600 50 1080 225'
              fill='none'
              stroke='url(#cta-eclipse-arc)'
              strokeOpacity='0.32'
              strokeWidth='1'
              strokeDasharray='4 8'
            />
          </svg>

          <div className='relative z-10 mx-auto max-w-3xl text-center'>
            {/* Singularity Photon-Ring & Pale-Blue-Dot Orbital Medallion */}
            <div
              aria-hidden='true'
              className='mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-sky-300/30 bg-sky-400/10 shadow-[0_0_36px_rgba(56,189,248,0.3)]'
            >
              <svg viewBox='0 0 48 48' fill='none' className='size-7'>
                <ellipse
                  cx='24'
                  cy='24'
                  rx='18'
                  ry='7.5'
                  transform='rotate(-22 24 24)'
                  stroke='#38bdf8'
                  strokeOpacity='0.65'
                  strokeWidth='1.4'
                />
                <circle
                  cx='24'
                  cy='24'
                  r='7.2'
                  fill='#030712'
                  stroke='#fbbf24'
                  strokeWidth='1.7'
                />
                <circle cx='39.5' cy='18' r='2.4' fill='#7dd3fc' />
                <circle
                  cx='39.5'
                  cy='18'
                  r='4.6'
                  fill='#38bdf8'
                  fillOpacity='0.28'
                />
              </svg>
            </div>

            <p className='mb-4 font-mono text-[11px] font-medium tracking-[0.22em] text-sky-200/80 uppercase'>
              <span className='text-[#fbbf24]'>04</span>
              <span className='mx-2 opacity-40'>//</span>
              {t('Clock Out Across Light-Years')}
            </p>

            <h2
              id='home-cta-heading'
              className='text-3xl leading-[1.16] font-semibold tracking-[-0.025em] text-[#f8fafc] sm:text-5xl'
            >
              <span className='block'>
                {t('Let a universe of compute roar for you.')}
              </span>
              <span className='tidal-serif mt-1.5 block font-normal text-[#bae6fd] italic'>
                {t('Drift into your own quiet orbit.')}
              </span>
            </h2>

            <p className='mx-auto mt-5 max-w-lg text-sm leading-7 text-balance text-slate-300/85 sm:text-base'>
              {t(
                'Deploy one unified AI gateway to route, meter, and guard 40+ model star systems around the clock—humanity stays tiny, carefree, and home on time.'
              )}
            </p>

            <div className='mt-9 flex flex-wrap items-center justify-center gap-3'>
              {props.isAuthenticated ? (
                <Button
                  size='lg'
                  className='group h-11 rounded-xl bg-[#f8fafc] px-6 text-sm font-medium text-[#040814] hover:bg-white'
                  render={<Link to='/dashboard' />}
                >
                  {t('Go to Dashboard')}
                  <ArrowRight
                    aria-hidden='true'
                    className='size-4 transition-transform duration-200 group-hover:translate-x-0.5'
                  />
                </Button>
              ) : (
                <Button
                  size='lg'
                  className='group h-11 rounded-xl bg-[#f8fafc] px-6 text-sm font-medium text-[#040814] hover:bg-white'
                  render={<Link to='/sign-up' />}
                >
                  {t('Get Started')}
                  <ArrowRight
                    aria-hidden='true'
                    className='size-4 transition-transform duration-200 group-hover:translate-x-0.5'
                  />
                </Button>
              )}

              {canViewPricing && (
                <Button
                  size='lg'
                  variant='outline'
                  className='h-11 rounded-xl border-sky-200/20 bg-white/5 px-5 text-sm font-medium text-[#f8fafc] hover:bg-white/12 hover:text-white'
                  render={<Link to='/pricing' />}
                >
                  {t('View Pricing')}
                </Button>
              )}

              <Button
                size='lg'
                variant='ghost'
                className='h-11 rounded-xl px-4 text-sm font-medium text-slate-200/80 hover:bg-white/8 hover:text-white'
                render={
                  isExternalDocs ? (
                    <a
                      href={docsUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                    />
                  ) : (
                    <Link to={docsUrl} />
                  )
                }
              >
                {t('Docs')}
                <ArrowUpRight aria-hidden='true' className='size-4' />
              </Button>
            </div>

            <div className='mt-12 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-sky-200/12 pt-6 font-mono text-[11px] text-slate-300/65'>
              {STACK_FOOTPRINT.map((item) => (
                <span key={item} className='flex items-center gap-2'>
                  <span
                    aria-hidden='true'
                    className='size-1 rounded-full bg-[#38bdf8]/80'
                  />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </AnimateInView>
      </div>
    </section>
  )
}
