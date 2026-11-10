import { Picker } from 'emoji-mart'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'

import {
  emojiData,
  emojiSpritesheetUrl,
  useEmojiSpritesheet,
} from './emoji-assets'

export default function EmojiBrowser(props: {
  onSelect: (emoji: string) => void
}) {
  const { t, i18n } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const onSelect = useRef(props.onSelect)
  onSelect.current = props.onSelect
  const language = i18n.resolvedLanguage || i18n.language
  const spritesheet = useEmojiSpritesheet()
  useEffect(() => {
    if (!host.current || spritesheet !== 'ready') return
    const picker = new Picker({
      data: emojiData,
      set: 'twitter',
      i18n: {
        search: t('Search'),
        search_no_results_1: t('Oh no!'),
        search_no_results_2: t('That emoji couldn’t be found'),
        pick: t('Pick an emoji…'),
        add_custom: t('Add custom emoji'),
        categories: {
          activity: t('Activity'),
          custom: t('Custom'),
          flags: t('Flags'),
          foods: t('Food & Drink'),
          frequent: t('Frequently used'),
          nature: t('Animals & Nature'),
          objects: t('Objects'),
          people: t('Smileys & People'),
          places: t('Travel & Places'),
          search: t('Search Results'),
          symbols: t('Symbols'),
        },
        skins: {
          choose: t('Choose default skin tone'),
          '1': t('Default'),
          '2': t('Light'),
          '3': t('Medium-Light'),
          '4': t('Medium'),
          '5': t('Medium-Dark'),
          '6': t('Dark'),
        },
      },
      theme: 'auto',
      dynamicWidth: true,
      perLine: 8,
      previewPosition: 'none',
      skinTonePosition: 'search',
      getSpritesheetURL: () => emojiSpritesheetUrl,
      onEmojiSelect: (emoji: { native: string }) =>
        onSelect.current(emoji.native),
    })
    const element = picker as unknown as HTMLElement
    element.style.width = '100%'
    host.current.appendChild(element)
    return () => element.remove()
  }, [language, t, spritesheet])
  if (spritesheet === 'error') throw new Error('Emoji artwork failed to load')
  return (
    <>
      {spritesheet === 'loading' && <LoadingState size='sm' />}
      <div ref={host} className='w-full min-w-0' />
    </>
  )
}
