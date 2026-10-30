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
  completed_at?: number
}

export type RedPacketDetail = RedPacket & {
  deleted: boolean
  records: { user_id: number; name: string; claimed_at: number }[]
  my_code?: string
  my_quota?: number
  redeemed: boolean
}

export type RedPacketCode = {
  code: string
  quota: number
  status:
    | 'unclaimed'
    | 'claimed'
    | 'redeemed'
    | 'disabled'
    | 'expired'
    | 'deleted'
  user_id: number | null
  name: string
  claimed_at: number
  redeemed_at: number
  redeemed_by: number
}

export async function getRedPacketCodes(id: number, signal?: AbortSignal) {
  const res = await api.get<{ success: boolean; data: RedPacketCode[] }>(
    `/api/community/red-packets/${id}/codes`,
    { signal }
  )
  const codes = requireServerSuccess(res.data).data
  if (!Array.isArray(codes)) throw new Error('Could not load redemption codes')
  return codes
}

export async function listRedPackets(beforeId = 0, signal?: AbortSignal) {
  const res = await api.get<{ success: boolean; data: RedPacket[] }>(
    '/api/community/red-packets',
    { params: { before_id: beforeId }, signal }
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
