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
import { useQuery } from '@tanstack/react-query'
import type { KeyboardEventHandler } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { getUsers } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface UsernameFilterProps {
  value?: string
  onValueChange: (value: string) => void
  enabled?: boolean
  id?: string
  placeholder?: string
  className?: string
  popupClassName?: string
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

export function UsernameFilter(props: UsernameFilterProps) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const usernameAnchor = useComboboxAnchor()
  const usersQuery = useQuery({
    queryKey: ['users', 'filter-options', user?.id],
    enabled: props.enabled !== false && (user?.role ?? 0) >= 10,
    staleTime: 60_000,
    queryFn: async () => {
      const options: ComboboxInputOption[] = []
      // The users API caps each page at 100; load every page so local keyword
      // matching also finds users outside the first page.
      for (let page = 1; ; page++) {
        const response = requireServerSuccess(
          await getUsers({
            p: page,
            page_size: 100,
            sort_by: 'id',
            sort_order: 'asc',
          })
        )
        const data = response.data
        if (!data?.items.length) return options
        options.push(
          ...data.items.map((item) => ({
            value: item.username,
            label: item.username,
          }))
        )
        if (page * data.page_size >= data.total) return options
      }
    },
  })
  return (
    <>
      <Combobox
        items={usersQuery.data ?? []}
        value={
          usersQuery.data?.find((option) => option.value === props.value) ??
          null
        }
        inputValue={props.value ?? ''}
        onInputValueChange={(value, details) => {
          if (details.reason === 'input-change') {
            props.onValueChange(value)
          }
        }}
        onValueChange={(option) => {
          if (option) props.onValueChange(option.value)
        }}
        isItemEqualToValue={(item, value) => item.value === value.value}
        filter={(option, query) =>
          option.value.toLowerCase().includes(query.trim().toLowerCase())
        }
      >
        <div ref={usernameAnchor}>
          <ComboboxInput
            id={props.id}
            aria-label={t('Username')}
            placeholder={props.placeholder ?? t('Filter by username')}
            triggerAriaLabel={t('Username')}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return
              // Let the popup commit a highlighted user before Enter submits a filter.
              if (
                event.key === 'Enter' &&
                event.currentTarget.getAttribute('aria-activedescendant')
              ) {
                return
              }
              props.onKeyDown?.(event)
            }}
            className={cn('w-full', props.className)}
          />
        </div>
        <ComboboxContent
          anchor={usernameAnchor}
          className={props.popupClassName}
        >
          <ComboboxEmpty>{t('No results found')}</ComboboxEmpty>
          <ComboboxList>
            {(option: ComboboxInputOption) => (
              <ComboboxItem key={option.value} value={option}>
                <span className='min-w-0 break-all'>{option.label}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {usersQuery.isLoading && (
        <div role='status'>
          <LoadingState inline size='sm' message={t('Loading...')} />
        </div>
      )}
      {usersQuery.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Failed to load users')}
        </p>
      )}
      {usersQuery.isSuccess && usersQuery.data.length === 0 && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('No Users Found')}
        </p>
      )}
    </>
  )
}
