import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { InputAuditEvidenceResponse } from './api'

export interface MatchRecord {
  id: number
  request_id: string
  user_id: number
  created_at: number
  instance: string
  name: string
  plugin: string
  plugin_version: string
  stage: string
  rule: string
  model: string
  status: 'pending' | 'dismissed' | 'confirmed' | 'insufficient_evidence'
  version: number
  reason: string
  reviewed_by: number
  updated_at: number
  request_max_chars?: number
}
export interface MatchEvidence {
  path: string
  role: string
  method: string
  representation: 'original' | 'transformed'
  before: string
  match: string
  after: string
  serialized: boolean
  truncated: boolean
  matchTruncated: boolean
}
export interface MatchFilters {
  p: number
  page_size: number
  user_id?: number
  keyword?: string
  request_id?: string
  rule?: string
  status?: string
}
export async function getMatches(filters: MatchFilters) {
  const response = await api.get<
    ApiResponse<{ items: MatchRecord[]; total: number }>
  >('/api/input-audit/matches', { params: filters })
  requireServerSuccess(response.data)
  return response.data.data ?? { items: [], total: 0 }
}
export async function getMatch(id: number) {
  const response = await api.get<
    ApiResponse<{
      record: MatchRecord
      evidence: MatchEvidence | null
      request_context?: InputAuditEvidenceResponse
    }>
  >(`/api/input-audit/matches/${id}`)
  requireServerSuccess(response.data)
  if (!response.data.data) {
    throw new Error('Audit evidence is unavailable or expired')
  }
  return response.data.data
}
export async function decideMatch(
  id: number,
  data: { version: number; status: string; reason: string }
) {
  const response = await api.post<ApiResponse>(
    `/api/input-audit/matches/${id}/decision`,
    data
  )
  requireServerSuccess(response.data)
}
