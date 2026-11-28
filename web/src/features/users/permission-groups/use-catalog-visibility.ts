import { useMemo } from 'react'

import { useSystemOptions } from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'

import { EMPTY_POLICY, parsePolicy, type Policy } from './lib/policy'

export function useCatalogVisibility(queryOptions?: { enabled?: boolean }) {
  const options = useSystemOptions(queryOptions)
  const update = useUpdateOption()

  const state = useMemo(() => {
    if (options.isPending || options.isError) {
      return { policy: null, invalid: false }
    }
    if (!Array.isArray(options.data?.data)) {
      return { policy: null, invalid: true }
    }
    const found = options.data.data.find(
      (item) => item.key === 'CatalogVisibility'
    )
    if (!found) {
      return { policy: EMPTY_POLICY, invalid: false }
    }
    const parsed = parsePolicy(found.value)
    if (!parsed) {
      return { policy: null, invalid: true }
    }
    return { policy: parsed, invalid: false }
  }, [options.data, options.isError, options.isPending])

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
