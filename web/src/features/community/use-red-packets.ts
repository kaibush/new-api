import { useQuery } from '@tanstack/react-query'

import { useAuthStore } from '@/stores/auth-store'

import { listRedPackets, type RedPacket } from './red-packet-api'

export function useRedPackets(messageIds: number[], enabled = true) {
  const user = useAuthStore((s) => s.auth.user)
  const oldestId = messageIds.length ? Math.min(...messageIds) : 0
  const newestId = messageIds.length ? Math.max(...messageIds) : 0
  return useQuery({
    queryKey: ['community-red-packets', user?.id, oldestId, newestId],
    queryFn: async ({ signal }) => {
      const packets: RedPacket[] = []
      if (!oldestId) return packets
      let beforeId = newestId + 1
      // Refresh public progress for the loaded range, including packets beyond
      // the API's first page. The chat messages decide which cards are visible.
      while (beforeId > oldestId) {
        const page = await listRedPackets(beforeId, signal)
        packets.push(...page.filter((packet) => packet.id >= oldestId))
        const lastId = page.at(-1)?.id
        if (page.length < 30 || !lastId || lastId <= oldestId) break
        if (lastId >= beforeId) throw new Error('Could not load red packets')
        beforeId = lastId
      }
      return packets
    },
    refetchInterval: 5000,
    enabled: enabled && messageIds.length > 0,
  })
}
