import { useMemo } from 'react'

import { useSystemOptions } from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'

import { EMPTY_POLICY, parsePolicy, type Policy } from './lib/policy'

export function useCatalogVisibility(queryOptions?: { enabled?: boolean }) {
  const options = useSystemOptions(queryOptions)
  const update = useUpdateOption()

  const state = useMemo(() => {
    const list = Array.isArray(options.data?.data) ? options.data.data : null
    if (!list) {
      return { policy: EMPTY_POLICY, invalid: false }
    }
    const found = list.find((item) => item.key === 'CatalogVisibility')
    if (!found) {
      return { policy: EMPTY_POLICY, invalid: false }
    }
    const parsed = parsePolicy(found.value)
    if (!parsed) {
      return { policy: null, invalid: true }
    }
    return { policy: parsed, invalid: false }
  }, [options.data])

  const savePolicy = (next: Policy, onSuccess?: () => void) => {
    update.mutate(
      { key: 'CatalogVisibility', value: JSON.stringify(next) },
      { onSuccess }
    )
  }

  return {
    policy: state.policy,
    invalid: state.invalid,
    isPending: options.isPending,
    isError: options.isError,
    isSaving: update.isPending,
    refetch: options.refetch,
    savePolicy,
  }
}
