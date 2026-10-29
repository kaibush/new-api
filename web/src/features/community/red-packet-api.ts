import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type RedPacket = {
  id: number
  user_id: number
  name: string
  greeting: string
  total: number
  claimed: number
  created_at: number
  expires_at: number
}

export type RedPacketDetail = RedPacket & {
  deleted: boolean
  records: { user_id: number; name: string; claimed_at: number }[]
  my_code?: string
  my_quota?: number
  redeemed: boolean
}

export async function listRedPackets(beforeId = 0) {
  const res = await api.get<{ success: boolean; data: RedPacket[] }>(
    '/api/community/red-packets',
    { params: { before_id: beforeId } }
  )
  const packets = requireServerSuccess(res.data).data
  if (!Array.isArray(packets)) throw new Error('Could not load red packets')
  return packets
}

export async function getRedPacket(id: number, signal?: AbortSignal) {
  const res = await api.get<{ success: boolean; data: RedPacketDetail }>(
    `/api/community/red-packets/${id}`,
    { signal }
  )
  return requireServerSuccess(res.data).data
}

export async function claimRedPacket(id: number) {
  const res = await api.post<{ success: boolean; data: RedPacketDetail }>(
    `/api/community/red-packets/${id}/claim`
  )
  return requireServerSuccess(res.data).data
}

export async function createRedPacket(values: {
  greeting: string
  codes: string[]
}) {
  const res = await api.post<{ success: boolean; data: RedPacket }>(
    '/api/community/red-packets',
    values
  )
  return requireServerSuccess(res.data).data
}
