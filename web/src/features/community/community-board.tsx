import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import { RedPacketCard } from './red-packet-card'
import { useRedPackets } from './use-red-packets'

export function CommunityBoard(props: {
  onOpen: (id: number) => void
  onCreate: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((s) => s.auth.user)
  const packets = useRedPackets()
  return (
    <div className='flex min-h-0 flex-col gap-4'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='font-semibold'>{t('Community board')}</h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Shared moments, all in one place.')}
          </p>
        </div>
        <Gift
          className='text-muted-foreground size-5 shrink-0'
          aria-hidden='true'
        />
      </div>
      {(user?.role ?? 0) >= 10 && (
        <Button variant='outline' className='w-full' onClick={props.onCreate}>
          <Gift data-icon='inline-start' />
          {t('Send a red packet')}
        </Button>
      )}
      <section className='flex flex-col gap-3' aria-label={t('Red packets')}>
        {packets.isPending && <LoadingState size='sm' />}
        {packets.isError && (
          <ErrorState
            className='min-h-0'
            onRetry={() => void packets.refetch()}
          />
        )}
        {packets.data?.pages.flat().map((packet) => (
          <article key={packet.id} className='flex flex-col gap-2'>
            <div className='text-muted-foreground flex items-center justify-between gap-2 text-xs'>
              <span className='min-w-0 truncate'>{packet.name}</span>
              <time
                className='shrink-0'
                dateTime={new Date(packet.created_at * 1000).toISOString()}
              >
                {new Date(packet.created_at * 1000).toLocaleDateString(locale)}
              </time>
            </div>
            <RedPacketCard
              id={packet.id}
              greeting={packet.greeting}
              packet={packet}
              onOpen={props.onOpen}
            />
          </article>
        ))}
        {packets.data?.pages[0]?.length === 0 && (
          <EmptyState
            className='min-h-0 py-8'
            icon={Gift}
            title={t('No red packets yet')}
            description={t(
              'New red packets appear here and in the conversation.'
            )}
          />
        )}
        {packets.hasNextPage && (
          <Button
            variant='ghost'
            disabled={packets.isFetchingNextPage}
            onClick={() => void packets.fetchNextPage()}
          >
            {t('Load more')}
          </Button>
        )}
      </section>
      <Card size='sm' className='mt-2'>
        <CardHeader>
          <CardTitle>{t('About red packets')}</CardTitle>
          <CardDescription>
            {t('One code per person, first come, first served.')}
          </CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground text-xs leading-relaxed'>
          {t(
            'Open a packet to claim your code and see who has received one. Codes stay private; claim records are shared.'
          )}
        </CardContent>
      </Card>
    </div>
  )
}
