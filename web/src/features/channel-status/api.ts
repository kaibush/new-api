import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type AuditClient = {
  id?: string
  name: string
  requestCount: number
  thinkingRequests: number
  thinkingSampleRequests: number | null
  httpSuccessRequests: number | null
  lastSeenAt?: string | null
}
export type ChannelStatusData = {
  configured: boolean
  checkedAt?: string
  summary?: AuditClient
  clients?: AuditClient[]
  auditError?: string
  inventoryError?: string
  inventory?: {
    reachable: boolean
    updatedAt: string | null
    accounts?: {
      total: number
      available: number
      recovering: number
      attention: number
      risk: number
      recovery: {
        cooldown: number
        waitingReset: number
        probing: number
      } | null
      issues: { disabled: number; reauthRequired: number } | null
    }
    providers: Record<string, { capacity: number }>
  }
}
export async function getChannelStatus(window: string, signal?: AbortSignal) {
  const response = await api.get<{ success: boolean; data: ChannelStatusData }>(
    '/api/channel-status',
    { params: { window }, signal }
  )
  return requireServerSuccess(response.data).data
}

export function auditRate(
  count: number | null,
  total: number | null
): number | null {
  if (
    count == null ||
    total == null ||
    total <= 0 ||
    count < 0 ||
    count > total
  ) {
    return null
  }
  return (count / total) * 100
}

export async function getStatusDashboard<T>(
  dataset: string,
  params: { period: string; start?: string; end?: string },
  signal?: AbortSignal
): Promise<T> {
  const response = await api.get<{ success: boolean; data: T }>(
    '/api/channel-status',
    { params: { dataset, ...params }, signal }
  )
  return requireServerSuccess(response.data).data
}
