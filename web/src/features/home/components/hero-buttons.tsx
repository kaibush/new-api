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

import { Button } from '@/components/ui/button'

interface HeroButtonsProps {
  isAuthenticated: boolean
  docsUrl?: string
}

export function HeroButtons(props: HeroButtonsProps) {
  const { t } = useTranslation()
  const docsUrl = props.docsUrl || 'https://docs.newapi.pro'
  const isExternalDocs = docsUrl.startsWith('http')

  return (
    <div className='flex flex-wrap items-center gap-3'>
      {props.isAuthenticated ? (
        <Button
          size='lg'
          className='group bg-foreground text-background hover:bg-foreground/90 h-11 rounded-xl px-5 text-sm font-medium'
          render={<Link to='/dashboard' />}
        >
          {t('Go to Dashboard')}
          <ArrowRight
            aria-hidden='true'
            className='size-4 transition-transform duration-200 group-hover:translate-x-0.5'
          />
        </Button>
      ) : (
        <>
          <Button
            size='lg'
            className='group bg-foreground text-background hover:bg-foreground/90 h-11 rounded-xl px-5 text-sm font-medium'
            render={<Link to='/sign-up' />}
          >
            {t('Get Started')}
            <ArrowRight
              aria-hidden='true'
              className='size-4 transition-transform duration-200 group-hover:translate-x-0.5'
            />
          </Button>
          <Button
            size='lg'
            variant='outline'
            className='border-border/80 bg-background/80 hover:bg-muted/70 h-11 rounded-xl px-5 text-sm font-medium backdrop-blur-sm'
            render={<Link to='/sign-in' />}
          >
            {t('Sign In')}
          </Button>
        </>
      )}

      <Button
        size='lg'
        variant='ghost'
        className='text-muted-foreground hover:text-foreground h-11 rounded-xl px-4 text-sm font-medium'
        render={
          isExternalDocs ? (
            <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
          ) : (
            <Link to={docsUrl} />
          )
        }
      >
        {t('Docs')}
        <ArrowUpRight aria-hidden='true' className='size-4' />
      </Button>
    </div>
  )
}
