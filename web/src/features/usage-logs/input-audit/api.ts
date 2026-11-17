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
import { t } from 'i18next'

import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

export interface InputAudit {
  id: number
  user_id: number
  username: string
  created_at: number
  token_id: number
  model: string
  request_id: string
  route: string
  ip: string
  content: string
  content_hash: string
  content_chars: number
  truncated: boolean
}

export interface InputAuditSettings {
  enabled: boolean
  retention_days: number
  max_records: number
  max_chars: number
  evidence_enabled?: boolean
  evidence_max_chars?: number
  evidence_max_records?: number
  evidence_max_bytes?: number
  case_retention_days?: number
}

export interface InputAuditStatus {
  match_pending?: number
  match_dropped?: number
  match_write_failures?: number
  settings: InputAuditSettings
  pending: number
  dropped: number
  write_failures: number
  evidence_pending?: number
  evidence_dropped?: number
  evidence_write_failures?: number
}

export interface InputAuditFilters {
  p: number
  page_size: number
  user_id?: number
  request_id?: string
  keyword?: string
  start_timestamp?: number
  end_timestamp?: number
}

export interface InputAuditAllowlistEntry {
  id: string
  user_id: number
  instances: string[]
  reason: string
  expires_at: number
  created_at?: number
  created_by?: number
  updated_at?: number
  updated_by?: number
}

export interface InputAuditAllowlist {
  version: number
  entries: InputAuditAllowlistEntry[]
}

export async function getInputAuditAllowlist(): Promise<InputAuditAllowlist> {
  const response = await api.get<ApiResponse<InputAuditAllowlist>>(
    '/api/input-audit/allowlist'
  )
  return requireAuditData(response.data)
}

export async function updateInputAuditAllowlist(
  policy: InputAuditAllowlist
): Promise<InputAuditAllowlist> {
  const response = await api.put<ApiResponse<InputAuditAllowlist>>(
    '/api/input-audit/allowlist',
    policy
  )
  return requireAuditData(response.data)
}

function requireAuditData<T>(response: ApiResponse<T>): T {
  requireServerSuccess(response)
  if (!response.data) {
    throw createServerError(response, t('Failed to load audit records'))
  }
  return response.data
}

export interface InputAuditEvidenceDocument {
  source: string
  scope: string
  messages: { index?: number; role: string; text: string }[]
  truncated: boolean
  context_missing: boolean
  omitted: string[]
}

export interface InputAuditEvidenceResponse {
  available: boolean
  complete: boolean
  document?: InputAuditEvidenceDocument
  evidence?: {
    id: number
    document_hash: string
    created_at: number
    request_id: string
  }
}

export interface InputAuditCase {
  id: number
  audit_id: number
  user_id: number
  request_id: string
  created_at: number
  created_by: number
  expires_at: number
  updated_at: number
  version: number
  status: string
  category: string
  reason: string
}

export interface InputAuditEvidenceReference {
  message_index: number
  quote: string
  start?: number
  end?: number
}

export interface InputAuditCaseDetail {
  case: InputAuditCase
  complete: boolean
  snapshot: {
    audit: InputAudit
    evidence_id: number
    document_hash: string
    document: InputAuditEvidenceDocument
    allowlist: InputAuditAllowlist
  }
  decisions: {
    id: number
    created_at: number
    created_by: number
    version: number
    status: string
    category: string
    reason: string
    references: InputAuditEvidenceReference[]
  }[]
}

export async function getInputAuditEvidence(
  auditID: number
): Promise<InputAuditEvidenceResponse> {
  const response = await api.get<ApiResponse<InputAuditEvidenceResponse>>(
    `/api/input-audit/${auditID}/evidence`
  )
  return requireAuditData(response.data)
}

export async function getInputAuditCases(params: {
  p?: number
  page_size?: number
  audit_id?: number
  user_id?: number
  status?: string
}): Promise<{ items: InputAuditCase[]; total: number }> {
  const response = await api.get<
    ApiResponse<{ items: InputAuditCase[]; total: number }>
  >('/api/input-audit/cases', { params })
  return requireAuditData(response.data)
}

export async function getInputAuditCase(
  id: number
): Promise<InputAuditCaseDetail> {
  const response = await api.get<ApiResponse<InputAuditCaseDetail>>(
    `/api/input-audit/cases/${id}`
  )
  return requireAuditData(response.data)
}

export async function createInputAuditCase(request: {
  audit_id: number
  reason: string
}): Promise<InputAuditCase> {
  const response = await api.post<ApiResponse<InputAuditCase>>(
    '/api/input-audit/cases',
    request
  )
  return requireAuditData(response.data)
}

export async function decideInputAuditCase(
  id: number,
  request: {
    version: number
    status: string
    category: string
    reason: string
    references: InputAuditEvidenceReference[]
  }
): Promise<void> {
  const response = await api.post<ApiResponse<never>>(
    `/api/input-audit/cases/${id}/decisions`,
    request
  )
  requireServerSuccess(response.data)
}

export async function getInputAuditAllowlistHistory(): Promise<
  { created_at: number; policy: InputAuditAllowlist }[]
> {
  const response = await api.get<
    ApiResponse<{ created_at: number; policy: InputAuditAllowlist }[]>
  >('/api/input-audit/allowlist/history')
  return requireAuditData(response.data)
}

export async function exportInputAuditLabels(p: number): Promise<{
  items: unknown[]
  total_cases: number
  page: number
  page_size: number
}> {
  const response = await api.get<
    ApiResponse<{
      items: unknown[]
      total_cases: number
      page: number
      page_size: number
    }>
  >('/api/input-audit/cases/export', { params: { p, page_size: 100 } })
  return requireAuditData(response.data)
}

export async function getInputAudits(
  params: InputAuditFilters
): Promise<{ items: InputAudit[]; total: number }> {
  const response = await api.get<
    ApiResponse<{ items: InputAudit[]; total: number }>
  >('/api/input-audit', { params })
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, t('Failed to load audit records'))
  }
  return response.data.data
}

export async function getInputAuditStatus(): Promise<InputAuditStatus> {
  const response = await api.get<ApiResponse<InputAuditStatus>>(
    '/api/input-audit/status'
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, t('Failed to load audit records'))
  }
  return response.data.data
}

export async function updateInputAuditSettings(
  settings: InputAuditSettings
): Promise<ApiResponse> {
  const response = await api.put<ApiResponse>(
    '/api/input-audit/settings',
    settings
  )
  return requireServerSuccess(response.data)
}
