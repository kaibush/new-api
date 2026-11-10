import type { EmojiMartData } from '@emoji-mart/data'
import data from '@emoji-mart/data/sets/15/twitter.json'
import { useEffect, useState } from 'react'

export const emojiData: EmojiMartData = data
export const emojiSpritesheetUrl = '/emoji/twitter.png'

// Let the browser cache/coalesce the shared image. Failed loads must be retryable.
export function useEmojiSpritesheet(enabled = true) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    if (!enabled) return
    const image = new Image()
    let timeout: ReturnType<typeof setTimeout>
    let loaded = false
    const onLoad = () => {
      clearTimeout(timeout)
      loaded = true
      setStatus('ready')
    }
    const onError = () => {
      clearTimeout(timeout)
      setStatus('error')
    }
    const load = () => {
      if (loaded) return
      clearTimeout(timeout)
      setStatus('loading')
      timeout = setTimeout(onError, 15000)
      image.src = emojiSpritesheetUrl
    }
    image.addEventListener('load', onLoad)
    image.addEventListener('error', onError)
    load()
    window.addEventListener('online', load)
    return () => {
      clearTimeout(timeout)
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      window.removeEventListener('online', load)
    }
  }, [enabled])
  return status
}
