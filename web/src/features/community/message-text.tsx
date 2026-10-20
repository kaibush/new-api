import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Mentions carry stable user IDs while readers see the selected display name.
export function MessageText(props: { text: string; currentUserId?: number }) {
  const parts: ReactNode[] = []
  let offset = 0
  for (const mention of props.text.matchAll(
    /@\[([^\]\r\n]*)\]\(user:(\d+)\)/g
  )) {
    parts.push(props.text.slice(offset, mention.index))
    parts.push(
      <mark
        key={`${mention[2]}:${mention.index}`}
        className={cn('rounded bg-primary/10 px-1 text-primary', {
          'font-bold': Number(mention[2]) === props.currentUserId,
        })}
      >
        @{mention[1]}
      </mark>
    )
    offset = mention.index + mention[0].length
  }
  parts.push(props.text.slice(offset))
  return parts
}
