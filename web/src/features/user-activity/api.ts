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

export interface ActivityAmounts {
  consumed_quota: number
  wallet_quota: number
  checkin_quota: number
  subscription_quota: number
}
export interface ActivityUser extends ActivityAmounts {
  id: number
  username: string
  display_name: string
  charged_records: number
  active_days: number
  last_used_at: number
  pending_records: number
  coverage_since: number
  history_complete: boolean
}
export interface ActivityPeriod {
  window_start: number
  as_of: number
}
export interface ActivityDay {
  day: number
  quota: number
}
export interface ActivityOverview extends ActivityAmounts, ActivityPeriod {
  total_users: number
  consuming_users: number
  incomplete_users: number
  pending_records: number
  days: ActivityDay[]
}
export interface ActivityQuery {
  days: number
  page: number
  page_size: number
  search: string
  filter: string
  sort: string
}
export interface ActivityPage extends ActivityPeriod {
  items: ActivityUser[]
  total: number
}
export interface ActivityDetail extends ActivityPeriod {
  user: ActivityUser
  days: ActivityDay[]
}
interface Response<T> {
  success: boolean
  message?: string
  data: T
}
export async function getActivityOverview(days: number, signal?: AbortSignal) {
  const response = await api.get<Response<ActivityOverview>>(
    '/api/user/activity/overview',
    { params: { days }, signal }
  )
  return requireServerSuccess(response.data).data
}
export async function listUserActivity(
  query: ActivityQuery,
  signal?: AbortSignal
) {
  const response = await api.post<Response<ActivityPage>>(
    '/api/user/activity/users',
    query,
    { signal }
  )
  return requireServerSuccess(response.data).data
}
export async function getUserActivity(
  id: number,
  days: number,
  signal?: AbortSignal
) {
  const response = await api.get<Response<ActivityDetail>>(
    `/api/user/${id}/activity`,
    { params: { days }, signal }
  )
  return requireServerSuccess(response.data).data
}
