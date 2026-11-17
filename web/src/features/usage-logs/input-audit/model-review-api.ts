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
import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export interface ModelReviewSettings {
  enabled: boolean
  automatic: boolean
  interval_minutes: number
  endpoint: string
  key_env: string
  model: string
  instructions: string
  batch_size: number
  chunk_chars: number
  timeout_seconds: number
  request_interval_seconds: number
  retries: number
  confidence_threshold: number
  retention_days: number
}
export interface ModelReviewJob {
  id: number
  created_at: number
  updated_at: number
  created_by: number
  status: string
  mode: string
  user_id: number
  cursor: number
  upper_id: number
  processed: number
  flagged: number
  failed: number
}
export interface ModelReviewResult {
  id: number
  job_id: number
  audit_id: number
  user_id: number
  created_at: number
  status: string
  category: string
  confidence: number
  reason: string
  quote: string
  model: string
  complete: boolean
  chunks: number
}
export interface ModelReviewFilters {
  p: number
  page_size: number
  status: string
  job_id?: number
  user_id?: number
}
const base = '/api/input-audit/model'
export async function getModelReviewSettings() {
  const response = await api.get<ApiResponse<ModelReviewSettings>>(
    `${base}/settings`
  )
  requireServerSuccess(response.data)
  if (!response.data.data) throw new Error('Missing model review settings')
  return response.data.data
}
export async function saveModelReviewSettings(settings: ModelReviewSettings) {
  const response = await api.put<ApiResponse>(`${base}/settings`, settings)
  requireServerSuccess(response.data)
}
export async function getModelReviewJobs() {
  const response = await api.get<ApiResponse<ModelReviewJob[]>>(`${base}/jobs`)
  requireServerSuccess(response.data)
  return response.data.data ?? []
}
export async function startModelReview(request: {
  mode: string
  user_id?: number
}) {
  const response = await api.post<ApiResponse<ModelReviewJob>>(
    `${base}/jobs`,
    request
  )
  requireServerSuccess(response.data)
  return response.data.data
}
export async function cancelModelReview(id: number) {
  const response = await api.post<ApiResponse>(`${base}/jobs/${id}/cancel`)
  requireServerSuccess(response.data)
}
export async function getModelReviewResults(params: ModelReviewFilters) {
  const response = await api.get<
    ApiResponse<{ items: ModelReviewResult[]; total: number }>
  >(`${base}/results`, { params })
  requireServerSuccess(response.data)
  return response.data.data ?? { items: [], total: 0 }
}

export async function getModelReviewSummary() {
  const response = await api.get<ApiResponse<{ unreviewed: number }>>(
    `${base}/summary`
  )
  requireServerSuccess(response.data)
  return response.data.data ?? { unreviewed: 0 }
}
