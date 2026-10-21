import type { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

import type { getChatStatus } from './api'
import type { useChat } from './use-chat'
import type { useMentionNotifications } from './use-mention-notifications'

export const CommunityContext = createContext<{
  status: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getChatStatus>>>>
  chat: ReturnType<typeof useChat>
  notifications: ReturnType<typeof useMentionNotifications>
} | null>(null)

export function useCommunityChat() {
  const context = useContext(CommunityContext)
  if (!context) throw new Error('CommunityProvider is required')
  return context
}
