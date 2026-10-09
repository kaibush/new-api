/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { markServerErrorHandled } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

export function HelpImageUpload(props: { onUploaded: (url: string) => void }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)
  const onUploaded = useRef(props.onUploaded)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: async (request: { body: FormData; signal: AbortSignal }) =>
      requireServerSuccess(
        (
          await api.post('/api/option/help-center/images', request.body, {
            signal: request.signal,
          })
        ).data
      ),
    meta: { errorToast: false },
    retry: false,
  })
  useEffect(() => {
    onUploaded.current = props.onUploaded
  }, [props.onUploaded])
  useEffect(
    () => () => {
      pending.current?.abort()
    },
    []
  )

  const upload = async (file: File) => {
    if (pending.current) return
    if (
      file.size === 0 ||
      file.size > 5 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      setError(t('Choose a PNG, JPEG or WebP image up to 5 MiB.'))
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setUploading(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await mutation.mutateAsync({
        body,
        signal: controller.signal,
      })
      const url = new URL(response.data.url)
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(
          t(
            'Image upload failed. Check the image storage configuration and try again.'
          )
        )
      }
      if (!controller.signal.aborted) onUploaded.current(url.href)
    } catch (cause) {
      if (!controller.signal.aborted) {
        markServerErrorHandled(cause)
        setError(
          getServerErrorMessage(
            cause,
            t(
              'Image upload failed. Check the image storage configuration and try again.'
            )
          )
        )
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  return (
    <div className='space-y-2'>
      <Input
        ref={input}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        aria-label={t('Upload image')}
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={uploading}
        onClick={() => input.current?.click()}
      >
        {uploading ? t('Uploading...') : t('Upload image')}
      </Button>
      <p className='text-muted-foreground text-xs'>
        {t(
          'PNG, JPEG or WebP, up to 5 MiB. Uploaded images are public; save the article to publish the inserted link.'
        )}
      </p>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
    </div>
  )
}
