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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'
import { searchUsers } from '@/features/users/api'
import { useDebounce } from '@/hooks/use-debounce'
import { useUserName } from '@/hooks/use-user-name'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

interface UserOption {
  id: number
  username: string
}

// Shared remote picker: bounded search, with the existing batched name cache
// resolving preselected IDs. Never download the complete user directory.
export function UserSelector(props: {
  value?: number
  onChange: (id: number | undefined) => void
  id?: string
  popupClassName?: string
  disabled?: boolean
  'aria-invalid'?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<UserOption | null>(null)
  const keyword = useDebounce(search, 250)
  const auth = useAuthStore((state) => state.auth)
  const username = useUserName(
    props.value ?? 0,
    selection?.id === props.value ? selection?.username : undefined
  )
  const query = useQuery({
    queryKey: ['user-selector', auth.user?.id, auth.session?.sid, keyword],
    queryFn: async () => {
      const response = requireServerSuccess(
        await searchUsers({ keyword, page_size: 20, p: 1 })
      )
      return (response.data?.items ?? []).map((user) => ({
        id: user.id,
        username: user.username,
      }))
    },
    enabled: open && !props.disabled,
    staleTime: 30_000,
    retry: false,
  })
  const selected = props.value ? { id: props.value, username } : null
  const items = query.data ?? []
  const label = (option: UserOption) =>
    option.username ? `${option.username} (#${option.id})` : `#${option.id}`
  let emptyText = t('No results found')
  if (query.isFetching) emptyText = t('Loading...')
  else if (query.isError) emptyText = t('Failed to load users')
  let inputValue = selected ? label(selected) : ''
  if (open) inputValue = search
  return (
    <Combobox<UserOption>
      items={items}
      value={selected}
      itemToStringLabel={label}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={null}
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) setSearch('')
      }}
      inputValue={inputValue}
      onInputValueChange={(value, details) => {
        if (details.reason === 'input-change') setSearch(value.slice(0, 100))
      }}
      onValueChange={(option) => {
        setSelection(option)
        props.onChange(option?.id)
      }}
      disabled={props.disabled}
    >
      <ComboboxInput
        id={props.id}
        disabled={props.disabled}
        aria-label={t('Search users by name or ID')}
        triggerAriaLabel={t('Open')}
        clearAriaLabel={t('Clear')}
        aria-invalid={props['aria-invalid']}
        placeholder={t('Search users by name or ID')}
        showClear
      />
      <ComboboxContent className={props.popupClassName}>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: UserOption) => (
            <ComboboxItem key={option.id} value={option}>
              {label(option)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
