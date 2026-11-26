import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type TicketSettings = { enabled: boolean; name: string }
export type TicketStatus =
  | 'awaiting_staff'
  | 'awaiting_user'
  | 'resolved'
  | 'closed'
export type Ticket = {
  id: number
  user_id: number
  title: string
  status: TicketStatus
  updated_at: number
}
export type TicketMessage = {
  id: number
  author_id: number
  staff: boolean
  body: string
  created_at: number
}
type Result<T> = { success: boolean; data: T }

export const ticketSettingsQuery = queryOptions({
  queryKey: ['ticket-settings'],
  queryFn: async ({ signal }) =>
    requireServerSuccess(
      (
        await api.get<Result<TicketSettings>>('/api/tickets/settings', {
          signal,
        })
      ).data
    ).data,
  staleTime: 30000,
  refetchInterval: 30000,
})

export async function saveTicketSettings(input: TicketSettings) {
  return requireServerSuccess(
    (await api.put<Result<TicketSettings>>('/api/tickets/settings', input)).data
  ).data
}

export async function listTickets(
  search: string,
  status: string,
  page: number,
  signal: AbortSignal
) {
  return requireServerSuccess(
    (
      await api.get<
        Result<{ items: Ticket[]; total: number; has_more: boolean }>
      >('/api/tickets', { params: { search, status, page }, signal })
    ).data
  ).data
}

export async function readTicket(
  id: number,
  before: number,
  signal: AbortSignal
) {
  return requireServerSuccess(
    (
      await api.get<
        Result<{ ticket: Ticket; messages: TicketMessage[]; has_more: boolean }>
      >(`/api/tickets/${id}`, { params: { before }, signal })
    ).data
  ).data
}

export async function openTicket(input: { title: string; body: string }) {
  return requireServerSuccess(
    (await api.post<Result<Ticket>>('/api/tickets', input)).data
  ).data
}

export async function replyToTicket(id: number, body: string) {
  requireServerSuccess(
    (await api.post(`/api/tickets/${id}/messages`, { body })).data
  )
}

export async function changeTicketStatus(id: number, status: TicketStatus) {
  requireServerSuccess(
    (await api.patch(`/api/tickets/${id}/status`, { status })).data
  )
}
