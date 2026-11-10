import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import {
  emojiData,
  emojiSpritesheetUrl,
  useEmojiSpritesheet,
} from './emoji-assets'

const graphemes =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null
const emojiSkins = new Map(
  Object.values(emojiData.emojis).flatMap((emoji) =>
    emoji.skins.map(
      (skin) => [skin.native.replaceAll('\uFE0F', ''), skin] as const
    )
  )
)

function renderEmojiText(text: string, ready: boolean): ReactNode {
  if (!ready || !graphemes) return text
  const parts: ReactNode[] = []
  let offset = 0
  for (const { segment, index } of graphemes.segment(text)) {
    const skin = emojiSkins.get(segment.replaceAll('\uFE0F', ''))
    if (!skin || skin.x === undefined || skin.y === undefined) continue
    parts.push(text.slice(offset, index))
    parts.push(
      <span
        key={index}
        role='img'
        aria-label={segment}
        className='inline-block size-[1.25em] align-[-0.25em] text-transparent'
        style={{
          backgroundImage: `url(${emojiSpritesheetUrl})`,
          backgroundSize: `${emojiData.sheet.cols * 100}% ${emojiData.sheet.rows * 100}%`,
          backgroundPosition: `${(100 / (emojiData.sheet.cols - 1)) * skin.x}% ${(100 / (emojiData.sheet.rows - 1)) * skin.y}%`,
        }}
      >
        {segment}
      </span>
    )
    offset = index + segment.length
  }
  parts.push(text.slice(offset))
  return parts
}

// Mentions carry stable user IDs while readers see the selected display name.
export function MessageText(props: { text: string; currentUserId?: number }) {
  const spritesheet = useEmojiSpritesheet(
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(props.text)
  )
  const ready = spritesheet === 'ready'
  const parts: ReactNode[] = []
  let offset = 0
  for (const mention of props.text.matchAll(
    /@\[([^\]\r\n]*)\]\(user:(\d+)\)/g
  )) {
    parts.push(renderEmojiText(props.text.slice(offset, mention.index), ready))
    parts.push(
      <mark
        key={`${mention[2]}:${mention.index}`}
        className={cn('rounded bg-primary/10 px-1 text-primary', {
          'font-bold': Number(mention[2]) === props.currentUserId,
        })}
      >
        @{renderEmojiText(mention[1], ready)}
      </mark>
    )
    offset = mention.index + mention[0].length
  }
  parts.push(renderEmojiText(props.text.slice(offset), ready))
  return parts
}
