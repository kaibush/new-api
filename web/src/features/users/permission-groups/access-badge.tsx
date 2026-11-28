import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ResourceRule } from './lib/policy'

type BadgeTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-border/70 bg-muted/60 text-muted-foreground',
  success: 'border-success/25 bg-success/10 text-success',
  info: 'border-info/25 bg-info/10 text-info',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
}

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground/50',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

export function ResourceAccessBadge(props: { rule: ResourceRule }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const excludedCount =
    props.rule.excludedUsers.length + props.rule.excludedGroups.length

  let label = t('Default')
  let tone: BadgeTone = 'neutral'

  if (props.rule.mode === 'disabled') {
    label = t('Hidden from everyone')
    tone = 'danger'
  } else if (props.rule.mode === 'all_users') {
    if (excludedCount > 0) {
      label = t('Open · Excluded {{total}}', {
        total: formatNumber(excludedCount, locale),
      })
      tone = 'warning'
    } else {
      label = t('All logged-in users')
      tone = 'success'
    }
  } else if (props.rule.mode === 'allowlist') {
    label = t('Allowlist only')
    tone = 'info'
  }

  return (
    <Badge
      variant='outline'
      className={cn(
        'h-5 gap-1.5 rounded-full px-2 text-[11px] font-medium',
        toneClasses[tone]
      )}
    >
      <span
        aria-hidden='true'
        className={cn('size-1.5 shrink-0 rounded-full', dotClasses[tone])}
      />
      <span className='truncate'>{label}</span>
    </Badge>
  )
}
