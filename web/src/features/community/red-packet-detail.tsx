import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Check } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useRedemption } from '@/features/wallet/hooks/use-redemption'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback } from '@/lib/avatar'
import { formatNumber, formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import { claimRedPacket, getRedPacket } from './red-packet-api'

export function RedPacketDetailDialog(props: {
  id: number
  onClose: () => void
  onLocate: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((s) => s.auth.user?.id)
  const client = useQueryClient()
  const locating = useRef(false)
  const key = ['community-red-packet', userId, props.id]
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getRedPacket(props.id, signal),
    gcTime: 0,
    refetchInterval: 5000,
  })
  const wallet = useRedemption()
  const claim = useMutation({
    mutationFn: () => claimRedPacket(props.id),
    retry: false,
    gcTime: 0,
    onSuccess: async (packet) => {
      await client.cancelQueries({ queryKey: key })
      client.setQueryData(key, packet)
      void client.invalidateQueries({ queryKey: ['community-red-packets'] })
    },
    onError: (error) => {
      handleServerError(error, t('Red packet is unavailable'))
      void detail.refetch()
      void client.invalidateQueries({ queryKey: ['community-red-packets'] })
    },
  })
  const packet = detail.data
  const expired = !!packet && packet.expires_at <= Date.now() / 1000
  const exhausted = !!packet && packet.claimed >= packet.total
  let claimLabel = t('Open red packet')
  if (packet?.deleted) claimLabel = t('Message deleted')
  else if (exhausted) claimLabel = t('All claimed')
  else if (expired) claimLabel = t('Expired')
  return (
    <Dialog
      open
      title={t('Quota red packet')}
      contentClassName='sm:max-w-md'
      finalFocus={() => !locating.current}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      {detail.isPending && <LoadingState />}
      {detail.isError && <ErrorState onRetry={() => void detail.refetch()} />}
      {packet && (
        <div className='flex flex-col gap-5'>
          <div className='community-red-packet flex flex-col items-center gap-3 rounded-xl px-5 py-6 text-center'>
            <span className='community-red-packet-seal flex size-14 items-center justify-center rounded-full'>
              <Gift className='size-7' aria-hidden='true' />
            </span>
            <p className='text-sm break-words'>
              {t('From {{name}}', { name: packet.name })}
            </p>
            <p className='text-xl font-semibold break-words'>
              {packet.greeting || t('A little luck for everyone')}
            </p>
          </div>
          {packet.my_code ? (
            <div className='flex flex-col gap-3'>
              <p className='text-center text-sm'>
                {t('You received a redemption code')}
              </p>
              <p className='text-center text-3xl font-semibold tabular-nums'>
                {formatQuota(packet.my_quota || 0)}
              </p>
              <div className='bg-muted flex items-center gap-2 rounded-lg p-2 pl-3'>
                <code className='min-w-0 flex-1 text-sm break-all'>
                  {packet.my_code}
                </code>
                <CopyButton value={packet.my_code} />
              </div>
              {packet.redeemed ? (
                <Badge variant='secondary' className='mx-auto'>
                  <Check data-icon='inline-start' />
                  {t('Redeemed')}
                </Badge>
              ) : (
                <Button
                  disabled={wallet.redeeming}
                  onClick={async () => {
                    if (await wallet.redeemCode(packet.my_code || '')) {
                      await detail.refetch()
                    }
                  }}
                >
                  {wallet.redeeming
                    ? t('Processing...')
                    : t('Redeem to wallet')}
                </Button>
              )}
              <p className='text-muted-foreground text-center text-xs'>
                {t('Only you can view and redeem this code.')}
              </p>
            </div>
          ) : (
            <Button
              size='lg'
              className='community-red-packet-action w-full'
              disabled={
                claim.isPending || expired || exhausted || packet.deleted
              }
              onClick={() => claim.mutate()}
            >
              {claim.isPending ? <LoadingState inline size='sm' /> : claimLabel}
            </Button>
          )}
          <section
            className='flex flex-col gap-3'
            aria-label={t('Claim records')}
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='font-medium'>{t('Claim records')}</h3>
              <span className='text-muted-foreground text-xs'>
                {t('{{claimed}} / {{total}} claimed', {
                  claimed: formatNumber(packet.claimed, locale),
                  total: formatNumber(packet.total, locale),
                })}
              </span>
            </div>
            {packet.records.length === 0 && (
              <EmptyState
                className='min-h-0 py-4'
                icon={Gift}
                title={t('No claims yet')}
              />
            )}
            <ul className='flex max-h-56 flex-col gap-3 overflow-y-auto'>
              {packet.records.map((record) => (
                <li key={record.user_id} className='flex items-center gap-3'>
                  <Avatar className='size-8'>
                    <AvatarFallback>
                      {getUserAvatarFallback(record.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className='min-w-0 flex-1 text-sm break-words'>
                    {record.name}
                  </span>
                  {record.user_id === userId && (
                    <Badge variant='outline'>{t('You')}</Badge>
                  )}
                  <time
                    className='text-muted-foreground shrink-0 text-xs'
                    dateTime={new Date(record.claimed_at * 1000).toISOString()}
                  >
                    {new Date(record.claimed_at * 1000).toLocaleTimeString(
                      locale
                    )}
                  </time>
                </li>
              ))}
            </ul>
          </section>
          <p className='text-muted-foreground text-xs'>
            {t('Available until {{time}}', {
              time: new Date(packet.expires_at * 1000).toLocaleString(locale),
            })}
          </p>
          <Button
            variant='outline'
            onClick={() => {
              locating.current = true
              props.onLocate(packet.id)
            }}
          >
            {t('View in chat')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
