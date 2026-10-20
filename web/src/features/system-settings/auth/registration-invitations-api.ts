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

export type RegistrationInvitation = {
  id: number
  code_prefix: string
  created_at: number
  expires_at: number
  revoked_at: number
  used_at: number
  used_user_id: number
  username: string
}

const endpoint = '/api/option/registration-invitations'

export async function searchRegistrationInvitations(
  page: number,
  code: string
) {
  const response = await api.post<{
    success: boolean
    data: { items: RegistrationInvitation[]; total: number }
  }>(`${endpoint}/search`, { page, code })
  return requireServerSuccess(response.data).data
}

export async function generateRegistrationInvitations(values: {
  count: number
  days: number
}) {
  const response = await api.post<{ success: boolean; data: string[] }>(
    `${endpoint}/`,
    values
  )
  return requireServerSuccess(response.data).data
}

export async function revokeRegistrationInvitation(id: number) {
  const response = await api.delete<{ success: boolean }>(`${endpoint}/${id}`)
  return requireServerSuccess(response.data)
}
