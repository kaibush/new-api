import { api } from '@/lib/api'
import { authResult } from '@/lib/secure-verification'
import { requireServerSuccess } from '@/lib/server-error-message'

export type ChatMessage = {
  client_id?: string
  is_bot?: boolean
  sending?: boolean
  reply_to_id?: number
  reply?: {
    id: number
    name: string
    text: string
    filename: string
    deleted: boolean
  }
  id: number
  user_id: number
  name: string
  avatar: string
  text: string
  kind: 'text' | 'image' | 'sticker' | 'file'
  url: string
  filename: string
  size: number
  created_at: number
  deleted: boolean
}
export type ChatMember = { user_id: number; name: string; avatar: string }
export type ChatStatus = {
  name: string
  enabled: boolean
  bot_enabled: boolean
  bot_name: string
}
export type ChatSettings = ChatStatus & {
  bot_reply: string
  app_id: string
  template_id: string
  receiver: string
  app_secret: string
  callback_token: string
}
export async function getChatStatus() {
  const res = await api.get<{ success: boolean; data: ChatStatus }>(
    '/api/community/status'
  )
  return requireServerSuccess(res.data).data
}
export async function getChatSettings() {
  const res = await api.get<{
    success: boolean
    data: ChatSettings
    has_secret: boolean
    has_callback_token: boolean
  }>('/api/option/community')
  return requireServerSuccess(res.data)
}
export async function saveChatSettings(values: ChatSettings) {
  return requireServerSuccess(
    (await api.put('/api/option/community', values)).data
  )
}
export async function getChatCredentials(proof: string, signal: AbortSignal) {
  return authResult<Pick<ChatSettings, 'app_secret' | 'callback_token'>>(
    api.post('/api/option/community/credentials', undefined, {
      headers: { 'X-Security-Proof': proof },
      singleUseAuthorization: true,
      signal,
    })
  )
}
export async function testChatWeChat() {
  return requireServerSuccess(
    (await api.post('/api/option/community/wechat/test')).data
  )
}
export type ChatSendResult = {
  success: boolean
  data: ChatMessage
}
export async function sendChatMessage(
  text: string,
  replyToId?: number,
  clientId?: string
) {
  return requireServerSuccess(
    (
      await api.post<ChatSendResult>('/api/community/messages', {
        text,
        ...(clientId ? { client_id: clientId } : {}),
        ...(replyToId ? { reply_to_id: replyToId } : {}),
      })
    ).data
  )
}
export async function uploadChatFile(
  file: File,
  kind: string,
  text = '',
  replyToId?: number,
  clientId?: string
) {
  const data = new FormData()
  data.append('file', file)
  data.append('kind', kind)
  data.append('text', text)
  if (replyToId) data.append('reply_to_id', String(replyToId))
  if (clientId) data.append('client_id', clientId)
  return requireServerSuccess(
    (await api.post<ChatSendResult>('/api/community/attachments', data)).data
  )
}

export type BotFeedback = {
  id: number
  message_id: number
  reply_id: number
  user_id: number
  name: string
  text: string
  filename: string
  bot_name: string
  reply_text: string
  created_at: number
}

export async function getBotFeedback(page: number, pageSize: number) {
  const res = await api.get<{
    success: boolean
    data: { items: BotFeedback[]; total: number }
  }>('/api/community/bot-feedback', {
    params: { page, page_size: pageSize },
  })
  return requireServerSuccess(res.data).data
}
export async function deleteChatMessage(id: number) {
  return requireServerSuccess(
    (await api.delete(`/api/community/messages/${id}`)).data
  )
}

export type ChatHistory = {
  items: ChatMessage[]
  has_more: boolean
  day_start: number
  day_end: number
  deleted_ids: number[]
}

export async function getChatHistory(beforeId = 0, archive = false) {
  const res = await api.get<{ success: boolean; data: ChatHistory }>(
    archive ? '/api/community/history' : '/api/community/messages',
    { params: { before_id: beforeId, limit: 50 } }
  )
  return requireServerSuccess(res.data).data
}
