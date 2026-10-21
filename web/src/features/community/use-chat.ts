import { useMutation } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

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

function pruneChatHistory(history: ChatHistory): ChatHistory {
  const now = Date.now() / 1000
  return {
    ...history,
    items: history.items
      .filter(
        (message) =>
          message.id > (history.cleared_through_id || 0) &&
          message.created_at >= history.day_start &&
          (!history.day_end || message.created_at < history.day_end) &&
          !(message.expires_at && message.expires_at <= now)
      )
      .map((message) => {
        if (
          message.reply &&
          (message.reply.id <= (history.cleared_through_id || 0) ||
            (message.reply.expires_at && message.reply.expires_at <= now))
        ) {
          return { ...message, reply: undefined }
        }
        return message
      }),
  }
}

function mergeChatHistory(
  current: ChatHistory,
  next: ChatHistory,
  older: boolean
): ChatHistory {
  if ((next.cleared_through_id || 0) < (current.cleared_through_id || 0)) {
    return current
  }
  const samePolicy = current.history_days === next.history_days
  if (older && (!samePolicy || current.day_start !== next.day_start)) {
    return current
  }
  const retained = pruneChatHistory({ ...next, items: current.items }).items
  const keepCurrent =
    samePolicy &&
    (older ||
      !current.items.length ||
      !next.items.length ||
      (current.items.at(-1)?.id ?? 0) >= next.items[0].id)
  const byId = new Map(
    (keepCurrent ? retained : []).map((message) => [message.id, message])
  )
  for (const message of next.items) byId.set(message.id, message)
  const deleted = new Set([
    ...next.deleted_ids,
    ...(samePolicy ? current.deleted_ids : []),
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
    retained.length > 0 &&
    next.items.length > 0 &&
    retained[0].id < next.items[0].id
  const reachedBoundary = current.items.some(
    (message) => message.created_at < next.day_start
  )
  return pruneChatHistory({
    ...next,
    items,
    deleted_ids: [...deleted],
    has_more:
      !older && retainedOlder && next.day_start >= current.day_start
        ? current.has_more && !reachedBoundary
        : next.has_more,
  })
}

export function useChat(
  enabled: boolean,
  onNewMessages?: (messages: ChatMessage[]) => void
) {
  const notifyMessages = useEffectEvent((messages: ChatMessage[]) => {
    onNewMessages?.(messages)
  })
  const token = useAuthStore((s) => s.auth.accessToken)
  const [users, setUsers] = useState<ChatMember[]>([])
  const [history, setHistory] = useState<ChatHistory>(emptyHistory)
  const messages = history.items
  const sessionGeneration = useRef(0)
  const earlier = useMutation({
    mutationFn: (request: {
      before: number
      day: number
      clearedThrough: number
      days?: number
      generation: number
    }) => getChatHistory(request.before),
    onSuccess: (page, request) => {
      if (request.generation !== sessionGeneration.current) return
      setHistory((current) => {
        if (
          (current.cleared_through_id || 0) !== request.clearedThrough ||
          current.day_start !== request.day ||
          current.history_days !== request.days
        ) {
          return current
        }
        if (
          page.day_start !== current.day_start ||
          page.history_days !== current.history_days
        ) {
          return current
        }
        return mergeChatHistory(current, page, true)
      })
    },
    meta: { errorToast: false },
  })
  useEffect(() => {
    let nextExpiry = Infinity
    for (const message of history.items) {
      const expiresAt = message.expires_at || history.day_end
      if (expiresAt > 0) nextExpiry = Math.min(nextExpiry, expiresAt)
      if (message.reply?.expires_at) {
        nextExpiry = Math.min(nextExpiry, message.reply.expires_at)
      }
    }
    if (!Number.isFinite(nextExpiry)) return
    const timer = setTimeout(
      () => {
        setHistory((current) =>
          pruneChatHistory({
            ...current,
            items: current.items.filter(
              (message) =>
                (message.expires_at || current.day_end) > Date.now() / 1000
            ),
          })
        )
      },
      Math.min(2147483647, Math.max(0, nextExpiry * 1000 - Date.now()))
    )
    return () => clearTimeout(timer)
  }, [history])
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
    () => [
      ...messages,
      ...outgoing
        .filter(
          (message) =>
            message.sending ||
            (!message.cleared && message.id > (history.cleared_through_id || 0))
        )
        .map((message) =>
          message.reply && message.reply.id <= (history.cleared_through_id || 0)
            ? { ...message, reply: undefined }
            : message
        ),
    ],
    [messages, outgoing, history.cleared_through_id]
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
    let latestMessageId: number | undefined
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
              cleared_through_id: data.cleared_through_id || 0,
              items: data.messages,
              has_more: data.has_more ?? false,
              day_start: data.day_start ?? 0,
              day_end: data.day_end ?? 0,
              deleted_ids: data.deleted_ids ?? [],
              history_days: data.history_days,
            }
            setHistory((current) => mergeChatHistory(current, page, false))
            const history = data.messages as ChatMessage[]
            const previousId = latestMessageId
            latestMessageId = Math.max(
              latestMessageId ?? 0,
              page.cleared_through_id || 0,
              ...history.map((message) => message.id)
            )
            // The first snapshot is history, not a batch of new mentions.
            if (previousId !== undefined) {
              notifyMessages(
                history.filter(
                  (message) =>
                    message.id > previousId &&
                    message.id > (page.cleared_through_id || 0) &&
                    !page.deleted_ids.includes(message.id) &&
                    !message.deleted &&
                    !message.cleared &&
                    (!message.expires_at ||
                      message.expires_at > Date.now() / 1000)
                )
              )
            }
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
  const currentHistoryRequest =
    earlier.variables?.day === history.day_start &&
    earlier.variables?.days === history.history_days &&
    earlier.variables?.clearedThrough === (history.cleared_through_id || 0)
  return {
    messages: visibleMessages,
    hasMore: history.has_more,
    loadingEarlier: earlier.isPending && currentHistoryRequest,
    historyError: earlier.isError && currentHistoryRequest,
    loadEarlier: () => {
      if (history.has_more && (!earlier.isPending || !currentHistoryRequest)) {
        earlier.mutate({
          clearedThrough: history.cleared_through_id || 0,
          before: messages[0]?.id || 0,
          day: history.day_start,
          days: history.history_days,
          generation: sessionGeneration.current,
        })
      }
    },
    clearThrough: (throughId: number) => {
      setHistory((current) =>
        pruneChatHistory({
          ...current,
          cleared_through_id: Math.max(
            current.cleared_through_id || 0,
            throughId
          ),
          has_more:
            (current.cleared_through_id || 0) >= throughId
              ? current.has_more
              : false,
        })
      )
    },
    markDeleted: (id: number) => {
      setHistory((current) =>
        mergeChatHistory(
          current,
          { ...current, deleted_ids: [...current.deleted_ids, id] },
          false
        )
      )
      setOutgoing((current) => current.filter((message) => message.id !== id))
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
