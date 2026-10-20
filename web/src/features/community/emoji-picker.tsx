import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const groups = [
  {
    label: 'Smileys',
    emojis: [
      '😊',
      '😀',
      '😁',
      '😂',
      '🤣',
      '😍',
      '🥰',
      '😘',
      '😎',
      '🤓',
      '🥳',
      '🤔',
      '🤭',
      '🤫',
      '😴',
      '😅',
      '🥲',
      '😭',
      '😤',
      '😡',
      '😱',
      '😳',
      '🙄',
      '😇',
      '🤗',
      '🤝',
      '🫡',
      '🤩',
      '🥺',
      '😋',
      '😜',
      '😏',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍',
      '👎',
      '👏',
      '🙌',
      '🙏',
      '👌',
      '✌️',
      '🤞',
      '💪',
      '👋',
      '🤟',
      '🫶',
      '👊',
      '✊',
      '☝️',
      '🤲',
    ],
  },
  {
    label: 'Hearts and celebration',
    emojis: [
      '❤️',
      '💔',
      '💕',
      '💖',
      '💯',
      '🔥',
      '🎉',
      '🎊',
      '✨',
      '🌹',
      '🎁',
      '🎂',
      '🍻',
      '☕',
      '🌞',
      '🌙',
    ],
  },
] as const

export function EmojiPicker(props: {
  disabled: boolean
  onSelect: (emoji: string) => void
}) {
  const { t } = useTranslation()
  const [group, setGroup] = useState(0)
  const labels = [t('Smileys'), t('Gestures'), t('Hearts and celebration')]
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            disabled={props.disabled}
            aria-label={t('Insert emoji')}
          />
        }
      >
        😊
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='start'
        className='w-80 max-w-[calc(100vw-2rem)]'
      >
        <PopoverTitle>{t('Insert emoji')}</PopoverTitle>
        <ToggleGroup
          className='max-w-full flex-wrap'
          spacing={1}
          size='sm'
          value={[String(group)]}
          onValueChange={(values) => {
            if (values.length > 0) setGroup(Number(values[0]))
          }}
          aria-label={t('Emoji categories')}
        >
          {groups.map((item, index) => (
            <ToggleGroupItem key={item.label} value={String(index)}>
              {labels[index]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className='grid max-h-56 grid-cols-8 gap-1 overflow-y-auto'>
          {groups[group].emojis.map((emoji) => (
            <Button
              key={emoji}
              type='button'
              variant='ghost'
              size='icon'
              className='size-8 text-xl'
              disabled={props.disabled}
              aria-label={t('Insert {{emoji}}', { emoji })}
              onClick={() => props.onSelect(emoji)}
            >
              {emoji}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
