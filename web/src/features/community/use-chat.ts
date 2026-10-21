import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuthStore } from '@/stores/auth-store'

import {
  getChatHistory,
  type ChatHistory,
  type ChatMessage,
  type ChatMember,
} from './api'

const emptyHistory: ChatHistory = {
  items: [],
  has_more: false,
  day_start: 0,
  day_end: 0,
  deleted_ids: [],
}

function mergeChatHistory(
  current: ChatHistory,
  next: ChatHistory,
  older: boolean
): ChatHistory {
  const sameDay = current.day_start === next.day_start
  if (older && !sameDay) return current
  const keepCurrent =
    sameDay &&
    (older ||
      !current.items.length ||
      !next.items.length ||
      (current.items.at(-1)?.id ?? 0) >= next.items[0].id)
  const byId = new Map(
    (keepCurrent ? current.items : []).map((message) => [message.id, message])
  )
  for (const message of next.items) byId.set(message.id, message)
  const deleted = new Set([
    ...next.deleted_ids,
    ...(sameDay ? current.deleted_ids : []),
  ])
  const items = [...byId.values()]
    .sort((a, b) => a.id - b.id)
    .map((message) => {
      if (message.deleted || deleted.has(message.id)) {
        return {
          ...message,
          deleted: true,
          text: '',
          url: '',
          filename: '',
          size: 0,
          reply_to_id: undefined,
          reply: undefined,
        }
      }
      if (message.reply && deleted.has(message.reply.id)) {
        return {
          ...message,
          reply: { ...message.reply, deleted: true, text: '', filename: '' },
        }
      }
      return message
    })
  const retainedOlder =
    keepCurrent &&
    current.items.length > 0 &&
    next.items.length > 0 &&
    current.items[0].id < next.items[0].id
  return {
    ...next,
    items,
    deleted_ids: [...deleted],
    has_more: !older && retainedOlder ? current.has_more : next.has_more,
  }
}

export function useChat(enabled: boolean) {
  const token = useAuthStore((s) => s.auth.accessToken)
  const [users, setUsers] = useState<ChatMember[]>([])
  const [history, setHistory] = useState<ChatHistory>(emptyHistory)
  const messages = history.items
  const sessionGeneration = useRef(0)
  const earlier = useMutation({
    mutationFn: (request: {
      before: number
      day: number
      generation: number
    }) => getChatHistory(request.before),
    onSuccess: (page, request) => {
      if (request.generation !== sessionGeneration.current) return
      setHistory((current) => {
        if (current.day_start !== request.day) return current
        if (page.day_start > current.day_start) return page
        return mergeChatHistory(current, page, true)
      })
    },
    meta: { errorToast: false },
  })
  useEffect(() => {
    if (!history.day_end) return
    const timer = setTimeout(
      () => {
        setHistory(emptyHistory)
        setOutgoing([])
      },
      Math.max(0, history.day_end * 1000 - Date.now())
    )
    return () => clearTimeout(timer)
  }, [history.day_end])
  const [outgoing, setOutgoing] = useState<ChatMessage[]>([])
  const acknowledged = useRef(
    new Map<string, { userId: number; confirmed: boolean }>()
  )
  const previewURLs = useRef(new Set<string>())
  useEffect(() => {
    const active = new Set(outgoing.map((message) => message.url))
    for (const url of previewURLs.current) {
      if (!active.has(url)) {
        URL.revokeObjectURL(url)
        previewURLs.current.delete(url)
      }
    }
  }, [outgoing])
  useEffect(() => {
    const urls = previewURLs.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])
  const visibleMessages = useMemo(
    () => [...messages, ...outgoing],
    [messages, outgoing]
  )
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const generation = ++sessionGeneration.current
    setHistory(emptyHistory)
    setOutgoing([])
    acknowledged.current.clear()
    if (!enabled || !token) {
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
            const page: ChatHistory = {
              items: data.messages,
              has_more: data.has_more ?? false,
              day_start: data.day_start ?? 0,
              day_end: data.day_end ?? 0,
              deleted_ids: data.deleted_ids ?? [],
            }
            setHistory((current) => mergeChatHistory(current, page, false))
            const history = data.messages as ChatMessage[]
            for (const message of history) {
              if (!message.client_id) continue
              const pending = acknowledged.current.get(message.client_id)
              if (pending?.userId === message.user_id) pending.confirmed = true
            }
            setOutgoing((current) =>
              current.filter(
                (pending) =>
                  !history.some(
                    (message) =>
                      message.id === pending.id ||
                      (message.client_id &&
                        message.client_id === pending.client_id &&
                        message.user_id === pending.user_id)
                  )
              )
            )
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
      sessionGeneration.current = generation + 1
      clearTimeout(retry)
      socket?.close()
      setConnected(false)
    }
  }, [enabled, token])
  return {
    messages: visibleMessages,
    hasMore: history.has_more,
    loadingEarlier:
      earlier.isPending && earlier.variables?.day === history.day_start,
    historyError:
      earlier.isError && earlier.variables?.day === history.day_start,
    loadEarlier: () => {
      if (
        history.has_more &&
        (!earlier.isPending || earlier.variables?.day !== history.day_start)
      ) {
        earlier.mutate({
          before: messages[0]?.id || 0,
          day: history.day_start,
          generation: sessionGeneration.current,
        })
      }
    },
    connected,
    users,
    onSending: (message: ChatMessage) => {
      if (message.client_id) {
        acknowledged.current.set(message.client_id, {
          userId: message.user_id,
          confirmed: false,
        })
      }
      if (message.url.startsWith('blob:')) previewURLs.current.add(message.url)
      setOutgoing((current) => [...current, message])
    },
    onSent: (clientId: string, message: ChatMessage) => {
      acknowledged.current.delete(clientId)
      setOutgoing((current) =>
        current.map((pending) =>
          pending.client_id === clientId
            ? { ...message, sending: false }
            : pending
        )
      )
    },
    onFailed: (clientId: string) => {
      const confirmed = acknowledged.current.get(clientId)?.confirmed === true
      acknowledged.current.delete(clientId)
      setOutgoing((current) =>
        current.filter((pending) => pending.client_id !== clientId)
      )
      return !confirmed
    },
  }
}
