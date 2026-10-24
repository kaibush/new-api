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

import type {
  CheckinConfiguration,
  CheckinOverview,
  CheckinSettings,
  CheckinUserDetail,
  CheckinUserPage,
  CheckinUserQuery,
} from './types'

interface Response<T> {
  success: boolean
  message?: string
  data: T
}

export async function getCheckinConfiguration() {
  const response = await api.get<Response<CheckinConfiguration>>(
    '/api/option/checkin'
  )
  return requireServerSuccess(response.data).data
}

export async function saveCheckinConfiguration(
  settings: CheckinSettings,
  version: number
) {
  const response = await api.put<Response<CheckinConfiguration>>(
    '/api/option/checkin',
    { settings, version }
  )
  return requireServerSuccess(response.data).data
}

export async function getCheckinOverview() {
  const response = await api.get<Response<CheckinOverview>>(
    '/api/user/checkin/overview'
  )
  return requireServerSuccess(response.data).data
}

export async function listCheckinUsers(
  query: CheckinUserQuery,
  signal?: AbortSignal
) {
  const response = await api.post<Response<CheckinUserPage>>(
    '/api/user/checkin/users',
    query,
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getCheckinUserDetail(id: number) {
  const response = await api.get<Response<CheckinUserDetail>>(
    `/api/user/${id}/checkin`
  )
  return requireServerSuccess(response.data).data
}
