import {
  Box,
  Plus,
  RotateCcw,
  Search,
  Shield,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

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

  const hasActiveFilters = search.trim().length > 0 || filter !== 'all'

  return (
    <div className='grid min-w-0 gap-3'>
      {counts.disabled > 0 && (
        <Alert
          variant='destructive'
          className='border-destructive/30 bg-destructive/5 items-start rounded-xl px-3.5 py-2.5 sm:items-center'
        >
          <TriangleAlert
            aria-hidden='true'
            className='mt-0.5 translate-y-0! sm:mt-0'
          />
          <AlertDescription className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <span className='text-xs leading-relaxed sm:text-sm'>
              {t(
                '{{total}} resources are currently set to Hidden from everyone and cannot be seen or called by any user.',
                { total: formatNumber(counts.disabled, locale) }
              )}
            </span>
            <Button
              size='sm'
              variant='outline'
              className='border-destructive/30 bg-background hover:bg-destructive/10 shrink-0 self-start sm:self-auto'
              onClick={() => setFilter('disabled')}
            >
              {t('View hidden')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-1 flex-col gap-2 sm:flex-row sm:items-center'>
          <InputGroup className='bg-background h-9 w-full sm:max-w-xs'>
            <InputGroupAddon align='inline-start'>
              <Search aria-hidden='true' className='size-4' />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            {search.length > 0 && (
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='icon-xs'
                  aria-label={t('Reset')}
                  onClick={() => setSearch('')}
                >
                  <X aria-hidden='true' />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <div className='flex items-center gap-2 sm:contents'>
            <NativeSelect
              aria-label={t('Filter by access mode')}
              value={filter}
              onChange={(event) => setFilter(event.target.value as FilterValue)}
              className='min-w-0 flex-1 sm:w-48 sm:flex-none [&_select]:h-9'
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

            <Button
              variant='outline'
              className='h-9 shrink-0 px-3 sm:ml-auto'
              disabled={props.names.length === 0}
              onClick={props.onAddRule}
            >
              <Plus aria-hidden='true' />
              {t('Add rule')}
            </Button>
          </div>
        </div>
      </div>

      {activeSelected.length > 0 && (
        <div className='border-primary/20 bg-primary/5 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm'>
          <span className='text-foreground text-xs font-medium sm:text-sm'>
            {t('Selected {{total}} items', {
              total: formatNumber(activeSelected.length, locale),
            })}
          </span>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Button
              size='sm'
              disabled={props.pending}
              onClick={() => props.onEdit(activeSelected)}
            >
              <Shield aria-hidden='true' />
              {t('Batch configure')}
            </Button>
            <Button
              size='sm'
              variant='outline'
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
              onClick={() => setSelectedSet(new Set())}
            >
              {t('Clear selection')}
            </Button>
          </div>
        </div>
      )}

      {filteredItems.length > 0 ? (
        <div className='bg-card overflow-hidden rounded-xl border'>
          <div className='bg-muted/40 text-muted-foreground flex items-center justify-between gap-3 border-b px-3.5 py-2 text-xs font-medium sm:px-4'>
            <div className='flex items-center gap-3'>
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                onCheckedChange={(checked) =>
                  toggleAllVisible(Boolean(checked))
                }
                aria-label={t('Select all')}
              />
              <span>
                {props.kind === 'models' ? t('Model') : t('Routing group')}
              </span>
            </div>
            <span className='tabular-nums'>
              {formatNumber(filteredItems.length, locale)}
              {hasActiveFilters
                ? ` / ${formatNumber(items.length, locale)}`
                : ''}
            </span>
          </div>
          <ul
            aria-label={
              props.kind === 'models'
                ? t('Model permissions')
                : t('Routing group permissions')
            }
            className='divide-y'
          >
            {filteredItems.map((item) => {
              const isConfigured = item.rule.mode !== 'inherit'
              const isSelected = selectedSet.has(item.name)
              return (
                <li
                  key={item.name}
                  aria-label={item.name}
                  className={cn(
                    'hover:bg-muted/30 flex min-w-0 items-start justify-between gap-3 px-3.5 py-3 transition-colors sm:items-center sm:px-4',
                    isSelected && 'bg-primary/[0.04]'
                  )}
                >
                  <div className='flex min-w-0 flex-1 items-start gap-3'>
                    <Checkbox
                      className='mt-0.5'
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        toggleOne(item.name, Boolean(checked))
                      }
                      aria-label={t('Select {{name}}', { name: item.name })}
                    />
                    <div className='min-w-0 flex-1 space-y-1'>
                      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                        <p className='text-foreground truncate font-mono text-sm font-medium'>
                          {item.name}
                        </p>
                        <ResourceAccessBadge rule={item.rule} />
                      </div>
                      <p className='text-muted-foreground text-xs leading-relaxed sm:text-[13px]'>
                        {describeResourceRule(item.rule, t, locale)}
                      </p>
                    </div>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    {isConfigured && (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-muted-foreground hover:text-destructive h-8 px-2'
                        title={t('Remove restriction')}
                        aria-label={t('Remove restriction')}
                        onClick={() => props.onRemoveRule([item.name])}
                      >
                        <RotateCcw aria-hidden='true' className='size-3.5' />
                        <span className='hidden sm:inline'>
                          {t('Remove restriction')}
                        </span>
                      </Button>
                    )}
                    <Button
                      size='sm'
                      variant={isConfigured ? 'secondary' : 'outline'}
                      className='h-8 px-2.5'
                      onClick={() => props.onEdit([item.name])}
                    >
                      <SlidersHorizontal
                        aria-hidden='true'
                        className='size-3.5 sm:hidden'
                      />
                      {isConfigured ? t('Edit') : t('Configure')}
                    </Button>
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
          action={
            hasActiveFilters ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  setSearch('')
                  setFilter('all')
                }}
              >
                {t('Clear filters')}
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
