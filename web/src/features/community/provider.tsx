import { useQuery } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'

import { FrontendRefreshDialog } from '@/features/frontend-release/refresh-dialog'
import { useFrontendRelease } from '@/features/frontend-release/store'
import { useAuthStore } from '@/stores/auth-store'

import { getChatStatus } from './api'
import { useChat } from './use-chat'
import { CommunityContext } from './use-community-chat'
import { useMentionNotifications } from './use-mention-notifications'

export function CommunityProvider(props: {
  children: ReactNode
  onOpenChat: () => void
}) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  return <CommunitySession key={userId ?? 'guest'} {...props} />
}

function CommunitySession(props: {
  children: ReactNode
  onOpenChat: () => void
}) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const token = useAuthStore((state) => state.auth.accessToken)
  const loggedIn = Boolean(userId && token)
  const status = useQuery({
    queryKey: ['community-status', userId],
    queryFn: getChatStatus,
    enabled: loggedIn,
    refetchInterval: loggedIn ? 15000 : false,
    meta: { errorToast: false },
  })
  const enabled = loggedIn && status.data?.enabled === true
  const notifications = useMentionNotifications(enabled, props.onOpenChat)
  const chat = useChat(
    enabled,
    notifications.notify,
    loggedIn && status.isSuccess
  )
  useEffect(() => {
    if (status.data?.frontend_release) {
      useFrontendRelease.getState().receive(status.data.frontend_release)
    }
  }, [status.data])
  return (
    <CommunityContext value={{ status, chat, notifications }}>
      {props.children}
      {loggedIn && <FrontendRefreshDialog />}
    </CommunityContext>
  )
}
