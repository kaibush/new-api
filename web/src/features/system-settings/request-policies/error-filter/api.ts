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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { ErrorFilterConfig } from './lib/schema'

export type ErrorSample = {
  message: string
  type: string
  code: string
  status: number
  channel_id: number
  model: string
  request_id: string
}
export type PreviewResult = {
  body: string
  result: { action: string; rule: string }
}
type Response<T> = { success: boolean; message?: string; data: T }
const path = '/api/option/error_filter'
export const errorFilterQueryKey = ['error-filter'] as const

export async function getErrorFilter() {
  const response = await api.get<Response<ErrorFilterConfig>>(path)
  return requireServerSuccess(response.data).data
}
export async function saveErrorFilter(config: ErrorFilterConfig) {
  const response = await api.put<Response<ErrorFilterConfig>>(path, config)
  return requireServerSuccess(response.data).data
}
export async function previewErrorFilter(
  config: ErrorFilterConfig,
  sample: ErrorSample,
  body = ''
) {
  const response = await api.post<Response<PreviewResult>>(`${path}/preview`, {
    config,
    sample,
    body,
  })
  return requireServerSuccess(response.data).data
}
