import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getRedPacketCodes } from './red-packet-api'

export function RedPacketCodes(props: { id: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((s) => s.auth.user?.id)
  const codes = useQuery({
    queryKey: ['community-red-packet-codes', userId, props.id],
    queryFn: ({ signal }) => getRedPacketCodes(props.id, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    meta: { errorToast: false },
  })
  if (codes.isPending) return <LoadingState />
  // Do not keep displaying cached codes after an authorization failure.
  if (codes.isError) {
    return (
      <ErrorState className='min-h-0' onRetry={() => void codes.refetch()} />
    )
  }
  if (!codes.data.length) return <EmptyState className='min-h-0 py-4' />

  const statuses: Record<string, { label: string; variant: StatusVariant }> = {
    unclaimed: { label: t('Unclaimed'), variant: 'neutral' },
    claimed: { label: t('Claimed, not redeemed'), variant: 'warning' },
    redeemed: { label: t('Redeemed'), variant: 'success' },
    disabled: { label: t('Disabled'), variant: 'danger' },
    expired: { label: t('Expired'), variant: 'neutral' },
    deleted: { label: t('Deleted'), variant: 'neutral' },
  }
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-xs'>
        {t('{{total}} codes · {{redeemed}} redeemed', {
          total: formatNumber(codes.data.length, locale),
          redeemed: formatNumber(
            codes.data.filter((code) => code.status === 'redeemed').length,
            locale
          ),
        })}
      </p>
      <ItemGroup aria-label={t('Redemption codes')}>
        {codes.data.map((code) => (
          <Item key={code.code} role='listitem' variant='muted' size='sm'>
            <ItemContent className='min-w-0 gap-2'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <StatusBadge
                  label={statuses[code.status]?.label || t('Unknown')}
                  variant={statuses[code.status]?.variant || 'neutral'}
                  copyable={false}
                />
                <span className='text-sm tabular-nums'>
                  {formatQuota(code.quota)}
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <code className='min-w-0 flex-1 text-sm break-all'>
                  {code.code}
                </code>
                <CopyButton
                  value={code.code}
                  aria-label={t('Copy redemption code')}
                />
              </div>
              {code.user_id !== null && (
                <p className='text-muted-foreground text-xs break-words'>
                  {t('Claimed by {{name}}', { name: code.name })}
                  {' · '}
                  <time
                    dateTime={new Date(code.claimed_at * 1000).toISOString()}
                  >
                    {new Date(code.claimed_at * 1000).toLocaleString(locale)}
                  </time>
                </p>
              )}
              {code.redeemed_at > 0 && (
                <p className='text-muted-foreground text-xs break-words'>
                  {t('Redeemed by user #{{id}}', {
                    id: formatNumber(code.redeemed_by, locale),
                  })}
                  {' · '}
                  <time
                    dateTime={new Date(code.redeemed_at * 1000).toISOString()}
                  >
                    {new Date(code.redeemed_at * 1000).toLocaleString(locale)}
                  </time>
                </p>
              )}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  )
}
