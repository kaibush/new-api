import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

export type CommunityEventInput = {
  title: string
  description: string
  kind: 'event' | 'red_packet'
  starts_at: number
  ends_at: number
}

export type CommunityEvent = CommunityEventInput & {
  id: number
  user_id: number
  name: string
  created_at: number
  cancelled: boolean
}

export function useCommunityEvents(enabled = true) {
  const userId = useAuthStore((s) => s.auth.user?.id)
  return useQuery({
    queryKey: ['community-events', userId],
    queryFn: async ({ signal }) => {
      const res = await api.get<{ success: boolean; data: CommunityEvent[] }>(
        '/api/community/events',
        { signal }
      )
      const events = requireServerSuccess(res.data).data
      if (!Array.isArray(events)) throw new Error('Could not load events')
      return events
    },
    refetchInterval: 15000,
    enabled,
  })
}

export async function getCommunityEvent(id: number, signal?: AbortSignal) {
  const res = await api.get<{ success: boolean; data: CommunityEvent }>(
    `/api/community/events/${id}`,
    { signal }
  )
  return requireServerSuccess(res.data).data
}

export async function createCommunityEvent(input: CommunityEventInput) {
  const res = await api.post<{ success: boolean; data: CommunityEvent }>(
    '/api/community/events',
    input
  )
  return requireServerSuccess(res.data).data
}

export async function cancelCommunityEvent(id: number) {
  return requireServerSuccess(
    (await api.delete(`/api/community/events/${id}`)).data
  )
}
