import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthStore } from '@/stores/auth-store'

import type { ChatMessage } from './api'

export function useMentionNotifications(
  enabled: boolean,
  onOpenChat: () => void
) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const supported =
    typeof Notification !== 'undefined' && window.isSecureContext
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'default'
  )
  const active = useRef(new Set<Notification>())
  const toastIds = useRef(new Set<string | number>())

  async function request() {
    if (!supported) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'denied') {
        toast.info(
          t(
            'Allow notifications in your browser settings to receive mention alerts.'
          )
        )
      }
    } catch {
      toast.error(t('Browser notifications are unavailable.'))
    }
  }
  const offerPermission = useEffectEvent(() => {
    return toast.info(
      t('Receive browser notifications when someone mentions you.'),
      {
        duration: 10000,
        action: {
          label: t('Enable mention notifications'),
          onClick: () => void request(),
        },
      }
    )
  })
  useEffect(() => {
    if (!enabled || !supported || Notification.permission !== 'default') return
    const id = offerPermission()
    return () => {
      toast.dismiss(id)
    }
  }, [enabled, supported])
  useEffect(() => {
    if (!supported) return
    const update = () => setPermission(Notification.permission)
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [supported])
  useEffect(() => {
    const notifications = active.current
    const ids = toastIds.current
    return () => {
      for (const notification of notifications) notification.close()
      notifications.clear()
      for (const id of ids) toast.dismiss(id)
      ids.clear()
    }
  }, [enabled, userId])

  function notify(messages: ChatMessage[]) {
    if (!enabled || !userId) return
    for (const message of messages) {
      if (message.user_id === userId || message.deleted || message.cleared) {
        continue
      }
      const mentions = [
        ...message.text.matchAll(/@\[([^\]\r\n]*)\]\(user:(\d+)\)/g),
      ]
      if (!mentions.some((mention) => Number(mention[2]) === userId)) continue
      const title = t('{{name}} mentioned you in community chat', {
        name: message.name,
      })
      const body = message.text
        .replaceAll(/@\[([^\]\r\n]*)\]\(user:\d+\)/g, '@$1')
        .slice(0, 200)
      const id = `community-mention:${userId}:${message.id}`
      if (supported && Notification.permission === 'granted') {
        try {
          const notification = new Notification(title, { body, tag: id })
          active.current.add(notification)
          notification.onclose = () => active.current.delete(notification)
          notification.onclick = () => {
            window.focus()
            onOpenChat()
            notification.close()
            active.current.delete(notification)
          }
          continue
        } catch {
          // Some browsers expose Notification but do not support its constructor.
        }
      }
      toastIds.current.add(id)
      toast.info(title, {
        id,
        description: body,
        action: { label: t('Community chat'), onClick: onOpenChat },
        onDismiss: () => {
          toastIds.current.delete(id)
        },
        onAutoClose: () => {
          toastIds.current.delete(id)
        },
      })
    }
  }
  return { supported, permission, request, notify }
}
