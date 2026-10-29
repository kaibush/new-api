import { Gift, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { RedPacket } from './red-packet-api'

export function RedPacketCard(props: {
  id: number
  greeting: string
  packet?: RedPacket
  onOpen: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  let status = t('Open red packet')
  if (props.packet && props.packet.claimed >= props.packet.total) {
    status = t('All claimed')
  } else if (props.packet && props.packet.expires_at <= Date.now() / 1000) {
    status = t('Expired')
  }
  return (
    <Button
      variant='ghost'
      className='community-red-packet h-auto w-full min-w-0 flex-col items-stretch gap-0 overflow-hidden rounded-xl p-0 text-left whitespace-normal'
      onClick={() => props.onOpen(props.id)}
    >
      <span className='flex items-center gap-3 p-4'>
        <span className='community-red-packet-seal flex size-11 shrink-0 items-center justify-center rounded-full'>
          <Gift aria-hidden='true' />
        </span>
        <span className='flex min-w-0 flex-1 flex-col gap-1'>
          <span className='line-clamp-2 font-semibold break-words'>
            {props.greeting || t('A little luck for everyone')}
          </span>
          <span className='text-xs opacity-90'>{status}</span>
        </span>
        <ArrowUpRight aria-hidden='true' />
      </span>
      <span className='community-red-packet-footer flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs'>
        <span>{t('Quota red packet')}</span>
        {props.packet && (
          <span>
            {t('{{claimed}} / {{total}} claimed', {
              claimed: formatNumber(props.packet.claimed, locale),
              total: formatNumber(props.packet.total, locale),
            })}
          </span>
        )}
      </span>
    </Button>
  )
}
