import { useEffect, useState } from 'react'

import { useAuthStore } from '@/stores/auth-store'

import type { ChatMessage, ChatMember } from './api'

export function useChat(enabled: boolean) {
  const token = useAuthStore((s) => s.auth.accessToken)
  const [users, setUsers] = useState<ChatMember[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled || !token) {
      setMessages([])
      setUsers([])
      setConnected(false)
      return
    }
    let disposed = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    function connect() {
      if (disposed) return
      const url = new URL('/api/community/ws', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(url)
      socket.onopen = () => socket?.send(JSON.stringify({ token }))
      socket.onmessage = (event) => {
        if (disposed) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'history' && Array.isArray(data.messages)) {
            setMessages(data.messages)
            setConnected(true)
          }
          if (data.type === 'presence' && Array.isArray(data.users)) {
            setUsers(data.users)
          }
        } catch {
          socket?.close()
        }
      }
      socket.onclose = () => {
        if (disposed) return
        setConnected(false)
        setUsers([])
        if (!disposed) retry = setTimeout(connect, 3000)
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      socket?.close()
      setConnected(false)
    }
  }, [enabled, token])
  return { messages, connected, users }
}
