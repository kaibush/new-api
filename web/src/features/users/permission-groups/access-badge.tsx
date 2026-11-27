import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ResourceRule } from './lib/policy'

export function ResourceAccessBadge(props: { rule: ResourceRule }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const excludedCount =
    props.rule.excludedUsers.length + props.rule.excludedGroups.length

  let label = t('Default')
  let variant: StatusVariant = 'neutral'

  if (props.rule.mode === 'disabled') {
    label = t('Hidden from everyone')
    variant = 'danger'
  } else if (props.rule.mode === 'all_users') {
    if (excludedCount > 0) {
      label = t('Open · Excluded {{total}}', {
        total: formatNumber(excludedCount, locale),
      })
      variant = 'warning'
    } else {
      label = t('All logged-in users')
      variant = 'success'
    }
  } else if (props.rule.mode === 'allowlist') {
    label = t('Allowlist only')
    variant = 'info'
  }

  return (
    <StatusBadge label={label} variant={variant} size='sm' copyable={false} />
  )
}
