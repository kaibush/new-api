import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type ChatMessage = {
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
export type ChatStatus = {
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
export async function testChatWeChat() {
  return requireServerSuccess(
    (await api.post('/api/option/community/wechat/test')).data
  )
}
export async function sendChatMessage(text: string) {
  return requireServerSuccess(
    (await api.post('/api/community/messages', { text })).data
  )
}
export async function uploadChatFile(file: File, kind: string, text = '') {
  const data = new FormData()
  data.append('file', file)
  data.append('kind', kind)
  data.append('text', text)
  return requireServerSuccess(
    (await api.post('/api/community/attachments', data)).data
  )
}
export async function deleteChatMessage(id: number) {
  return requireServerSuccess(
    (await api.delete(`/api/community/messages/${id}`)).data
  )
}
