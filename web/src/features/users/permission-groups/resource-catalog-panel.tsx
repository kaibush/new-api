import { Box, Plus, Search, Shield, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { ResourceAccessBadge } from './access-badge'
import {
  describeResourceRule,
  getResourceRule,
  type AccessMode,
  type Policy,
  type ResourceKind,
} from './lib/policy'

type FilterValue = 'all' | 'configured' | AccessMode

export function ResourceCatalogPanel(props: {
  kind: ResourceKind
  names: string[]
  policy: Policy
  pending: boolean
  onEdit: (names: string[]) => void
  onAddRule: () => void
  onRemoveRule: (names: string[]) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterValue>('all')
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set())

  const items = useMemo(
    () =>
      props.names.map((name) => ({
        name,
        rule: getResourceRule(props.policy, props.kind, name),
      })),
    [props.names, props.policy, props.kind]
  )

  const counts = useMemo(() => {
    let configured = 0
    let disabled = 0
    for (const item of items) {
      if (item.rule.mode !== 'inherit') configured += 1
      if (item.rule.mode === 'disabled') disabled += 1
    }
    return { configured, disabled }
  }, [items])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (query && !item.name.toLowerCase().includes(query)) {
        return false
      }
      if (filter === 'all') return true
      if (filter === 'configured') return item.rule.mode !== 'inherit'
      return item.rule.mode === filter
    })
  }, [items, search, filter])

  const activeSelected = useMemo(() => {
    const valid = new Set(props.names)
    return [...selectedSet].filter((name) => valid.has(name))
  }, [selectedSet, props.names])

  const visibleNames = useMemo(
    () => filteredItems.map((item) => item.name),
    [filteredItems]
  )

  const allVisibleSelected =
    visibleNames.length > 0 &&
    visibleNames.every((name) => selectedSet.has(name))
  const someVisibleSelected =
    !allVisibleSelected && visibleNames.some((name) => selectedSet.has(name))

  const toggleAllVisible = (checked: boolean) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      for (const name of visibleNames) {
        if (checked) next.add(name)
        else next.delete(name)
      }
      return next
    })
  }

  const toggleOne = (name: string, checked: boolean) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const searchPlaceholder =
    props.kind === 'models'
      ? t('Search models...')
      : t('Search routing groups...')

  return (
    <div className='grid min-w-0 gap-4'>
      {counts.disabled > 0 && (
        <Alert
          variant='destructive'
          className='border-destructive/30 bg-destructive/5'
        >
          <TriangleAlert aria-hidden='true' />
          <AlertDescription className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <span>
              {t(
                '{{total}} resources are currently set to Hidden from everyone and cannot be seen or called by any user.',
                { total: formatNumber(counts.disabled, locale) }
              )}
            </span>
            <Button
              size='sm'
              variant='outline'
              className='min-h-9 shrink-0 self-start sm:self-auto'
              onClick={() => setFilter('disabled')}
            >
              {t('View hidden')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-1 flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative flex-1 sm:max-w-xs'>
            <Search
              aria-hidden='true'
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className='min-h-11 pl-9 sm:min-h-9'
            />
          </div>
          <NativeSelect
            aria-label={t('Filter by access mode')}
            value={filter}
            onChange={(event) => setFilter(event.target.value as FilterValue)}
            className='w-full sm:w-56 [&_select]:min-h-11 sm:[&_select]:min-h-9'
          >
            <NativeSelectOption value='all'>
              {t('All ({{total}})', {
                total: formatNumber(items.length, locale),
              })}
            </NativeSelectOption>
            <NativeSelectOption value='configured'>
              {t('Configured rules ({{total}})', {
                total: formatNumber(counts.configured, locale),
              })}
            </NativeSelectOption>
            <NativeSelectOption value='all_users'>
              {t('Open to logged-in users')}
            </NativeSelectOption>
            <NativeSelectOption value='allowlist'>
              {t('Allowlist only')}
            </NativeSelectOption>
            <NativeSelectOption value='disabled'>
              {t('Hidden from everyone')}
            </NativeSelectOption>
            <NativeSelectOption value='inherit'>
              {t('Default')}
            </NativeSelectOption>
          </NativeSelect>
        </div>

        <Button
          variant='outline'
          size='sm'
          className='min-h-11 sm:min-h-9'
          disabled={props.names.length === 0}
          onClick={props.onAddRule}
        >
          <Plus aria-hidden='true' />
          {t('Add rule')}
        </Button>
      </div>

      {activeSelected.length > 0 && (
        <div className='bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm'>
          <span className='font-medium'>
            {t('Selected {{total}} items', {
              total: formatNumber(activeSelected.length, locale),
            })}
          </span>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              className='min-h-9'
              disabled={props.pending}
              onClick={() => props.onEdit(activeSelected)}
            >
              <Shield aria-hidden='true' />
              {t('Batch configure')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='min-h-9'
              disabled={props.pending}
              onClick={() => {
                props.onRemoveRule(activeSelected)
                setSelectedSet(new Set())
              }}
            >
              {t('Restore default')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              className='min-h-9'
              onClick={() => setSelectedSet(new Set())}
            >
              {t('Clear selection')}
            </Button>
          </div>
        </div>
      )}

      {filteredItems.length > 0 ? (
        <div className='rounded-xl border'>
          <div className='bg-muted/30 flex items-center gap-3 border-b px-4 py-2.5 text-xs font-medium'>
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
              aria-label={t('Select all')}
            />
            <span>
              {props.kind === 'models' ? t('Model') : t('Routing group')}
            </span>
          </div>
          <ul
            aria-label={
              props.kind === 'models'
                ? t('Model permissions')
                : t('Routing group permissions')
            }
            className='divide-y px-4'
          >
            {filteredItems.map((item) => {
              const isConfigured = item.rule.mode !== 'inherit'
              return (
                <li
                  key={item.name}
                  aria-label={item.name}
                  className='flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='flex min-w-0 items-start gap-3'>
                    <Checkbox
                      className='mt-1'
                      checked={selectedSet.has(item.name)}
                      onCheckedChange={(checked) =>
                        toggleOne(item.name, Boolean(checked))
                      }
                      aria-label={t('Select {{name}}', { name: item.name })}
                    />
                    <div className='min-w-0 space-y-1 wrap-anywhere'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='font-mono text-sm font-medium'>
                          {item.name}
                        </p>
                        <ResourceAccessBadge rule={item.rule} />
                      </div>
                      <p className='text-muted-foreground text-sm'>
                        {describeResourceRule(item.rule, t, locale)}
                      </p>
                    </div>
                  </div>
                  <div className='grid shrink-0 grid-cols-2 gap-2 sm:flex'>
                    <Button
                      className='min-h-11 sm:min-h-9'
                      size='sm'
                      variant='outline'
                      onClick={() => props.onEdit([item.name])}
                    >
                      {isConfigured ? t('Edit') : t('Configure')}
                    </Button>
                    {isConfigured && (
                      <Button
                        className='min-h-11 sm:min-h-9'
                        size='sm'
                        variant='ghost'
                        onClick={() => props.onRemoveRule([item.name])}
                      >
                        {t('Remove restriction')}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <EmptyState
          bordered
          className='min-h-32'
          icon={Box}
          title={t('No matching resources')}
        />
      )}
    </div>
  )
}
