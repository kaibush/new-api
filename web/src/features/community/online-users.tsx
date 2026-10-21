import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatNumber } from '@/lib/format'

import type { ChatMember } from './api'

export function OnlineUsers(props: {
  users: ChatMember[]
  connected: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type='button' variant='outline' disabled={!props.connected} />
        }
      >
        {t('Online users')}:{' '}
        {props.connected ? formatNumber(props.users.length, locale) : '—'}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-72 max-w-[calc(100vw-2rem)]'>
        <PopoverTitle>{t('Online users')}</PopoverTitle>
        <PopoverDescription>
          {t(
            'Signed-in users currently on this site. Each account is counted once.'
          )}
        </PopoverDescription>
        <ul
          className='flex max-h-72 flex-col gap-3 overflow-y-auto'
          aria-label={t('Online users')}
        >
          {props.users.map((user) => (
            <li key={user.user_id} className='flex items-center gap-2'>
              <Avatar className='size-8 shrink-0'>
                <AvatarImage src={user.avatar || undefined} alt={user.name} />
                <AvatarFallback style={getUserAvatarStyle(user.name)}>
                  {getUserAvatarFallback(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className='min-w-0 break-words'>{user.name}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
