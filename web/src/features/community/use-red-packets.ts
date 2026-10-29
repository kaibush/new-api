import { useInfiniteQuery } from '@tanstack/react-query'

import { useAuthStore } from '@/stores/auth-store'

import { listRedPackets } from './red-packet-api'

export function useRedPackets(enabled = true) {
  const user = useAuthStore((s) => s.auth.user)
  return useInfiniteQuery({
    queryKey: ['community-red-packets', user?.id],
    queryFn: ({ pageParam }) => listRedPackets(pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) =>
      page.length === 30 ? page.at(-1)?.id : undefined,
    refetchInterval: 5000,
    enabled,
  })
}
