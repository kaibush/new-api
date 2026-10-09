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

export interface VisitBucket {
  name: string
  pv: number
  uv: number
}
export interface VisitReport {
  pv: number
  uv: number
  sessions: number
  users: number
  trend: VisitBucket[]
  pages: VisitBucket[]
  referrers: VisitBucket[]
  browsers: VisitBucket[]
  devices: VisitBucket[]
  systems: VisitBucket[]
  user_ranking: VisitBucket[]
}
export interface VisitDetail {
  id: number
  created_at: number
  user_id: number
  username: string
  page: string
  referrer: string
  ip: string
  browser: string
  os: string
  device: string
  language: string
}
export interface VisitFilters {
  start: number
  end: number
  path: string
  user_id: number
}
export async function getVisitReport(
  filters: VisitFilters
): Promise<VisitReport> {
  const response = await api.get<{ success: boolean; data: VisitReport }>(
    '/api/site-visits',
    { params: filters }
  )
  requireServerSuccess(response.data)
  return response.data.data
}
export async function getVisitDetails(
  filters: VisitFilters,
  page: number
): Promise<{ items: VisitDetail[]; total: number }> {
  const response = await api.get<{
    success: boolean
    data: { items: VisitDetail[]; total: number }
  }>('/api/site-visits', { params: { ...filters, page, view: 'details' } })
  requireServerSuccess(response.data)
  return response.data.data
}
