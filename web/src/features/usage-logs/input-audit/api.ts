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
}

export interface InputAuditStatus {
  settings: InputAuditSettings
  pending: number
  dropped: number
  write_failures: number
}

export interface InputAuditFilters {
  p: number
  page_size: number
  user_id?: number
  request_id?: string
  start_timestamp?: number
  end_timestamp?: number
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
