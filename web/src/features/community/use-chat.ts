import { useEffect, useState } from 'react'

import { useAuthStore } from '@/stores/auth-store'

import type { ChatMessage } from './api'

export function useChat(enabled: boolean) {
  const token = useAuthStore((s) => s.auth.accessToken)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled || !token) {
      setMessages([])
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
        } catch {
          socket?.close()
        }
      }
      socket.onclose = () => {
        if (disposed) return
        setConnected(false)
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
  return { messages, connected }
}
