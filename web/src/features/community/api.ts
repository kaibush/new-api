import { api } from '@/lib/api'
import { authResult } from '@/lib/secure-verification'
import { requireServerSuccess } from '@/lib/server-error-message'

export type ChatMessage = {
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
  bot_status?: 'accepted' | 'failed' | 'busy' | ''
}
export async function sendChatMessage(text: string, replyToId?: number) {
  return requireServerSuccess(
    (
      await api.post<ChatSendResult>('/api/community/messages', {
        text,
        ...(replyToId ? { reply_to_id: replyToId } : {}),
      })
    ).data
  )
}
export async function uploadChatFile(
  file: File,
  kind: string,
  text = '',
  replyToId?: number
) {
  const data = new FormData()
  data.append('file', file)
  data.append('kind', kind)
  data.append('text', text)
  if (replyToId) data.append('reply_to_id', String(replyToId))
  return requireServerSuccess(
    (await api.post<ChatSendResult>('/api/community/attachments', data)).data
  )
}
export async function deleteChatMessage(id: number) {
  return requireServerSuccess(
    (await api.delete(`/api/community/messages/${id}`)).data
  )
}
