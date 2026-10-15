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
import {
  ArrowUpRight,
  AudioLines,
  Image,
  MessageCircle,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { FishPond } from '../fish-pond'
import { HeroButtons } from '../hero-buttons'
import { HeroTerminalDemo } from '../hero-terminal-demo'

import '@/styles/home.css'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'

  return (
    <main
      className={cn(
        'mofish-home px-6 pt-16 pb-10 sm:px-10 lg:pt-24',
        props.className
      )}
    >
      <div className='mx-auto max-w-6xl'>
        <div className='grid items-center gap-14 lg:grid-cols-2 lg:gap-16'>
          <section className='min-w-0' aria-labelledby='mofish-title'>
            <p className='text-muted-foreground mb-7 flex items-center gap-2.5 text-xs tracking-wider'>
              <span
                className='size-2 rounded-full bg-emerald-600'
                aria-hidden
              />
              {t('A little time, just for you')}
            </p>
            <h1
              id='mofish-title'
              className='text-[clamp(2.6rem,4.8vw,4.2rem)] leading-[1.22] font-bold tracking-tight'
            >
              {t('Work in order.')}
              <br />
              <span className='mofish-headline mt-2 inline-block'>
                {t('Unwind at ease.')}
              </span>
            </h1>
            <p className='text-muted-foreground mt-7 max-w-md text-sm leading-7 sm:text-base'>
              {t(
                'Models, accounts, and inspiration, all in one place. Let AI handle the busywork. Take a little time for yourself.'
              )}
            </p>
            <FishPond />
            <ul className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-3 text-xs'>
              <li className='flex items-center gap-2'>
                <MessageCircle
                  aria-hidden
                  className='size-8 rounded-xl bg-blue-500/10 p-2 text-blue-500'
                />
                {t('Chat')}
              </li>
              <li className='flex items-center gap-2'>
                <Image
                  aria-hidden
                  className='size-8 rounded-xl bg-emerald-600/10 p-2 text-emerald-600'
                />
                {t('Image')}
              </li>
              <li className='flex items-center gap-2'>
                <Video
                  aria-hidden
                  className='size-8 rounded-xl bg-amber-600/10 p-2 text-amber-700'
                />
                {t('Video')}
              </li>
              <li className='flex items-center gap-2'>
                <AudioLines
                  aria-hidden
                  className='size-8 rounded-xl bg-pink-600/10 p-2 text-pink-600'
                />
                {t('Audio')}
              </li>
            </ul>
          </section>
          <section className='min-w-0' aria-labelledby='mofish-connect'>
            <div className='mb-5 flex items-center justify-between gap-4'>
              <div>
                <p className='mb-2 font-mono text-[10px] tracking-[0.2em] text-emerald-700 dark:text-emerald-400'>
                  {t('API Access')}
                </p>
                <h2
                  id='mofish-connect'
                  className='text-xl font-semibold tracking-tight'
                >
                  {t('One connection. More free time.')}
                </h2>
              </div>
              <Button
                variant='ghost'
                size='sm'
                render={
                  docsUrl.startsWith('http') ? (
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
                <ArrowUpRight aria-hidden className='size-4' />
              </Button>
            </div>
            <HeroTerminalDemo />
            <p className='text-muted-foreground mt-5 text-xs leading-6'>
              {t(
                'Supports one-click configuration and perfectly adapts to NewAPI multi-protocol configuration.'
              )}
            </p>
            <div className='mt-5 flex flex-wrap gap-3'>
              <HeroButtons isAuthenticated={!!props.isAuthenticated} />
            </div>
          </section>
        </div>
        <div className='border-border/50 text-muted-foreground mt-14 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs lg:mt-20'>
          <p>{t('Less busywork. More breathing room.')}</p>
          <p>{t('Hover over a fish and watch it swim')}</p>
        </div>
      </div>
    </main>
  )
}
