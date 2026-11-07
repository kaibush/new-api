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
import { toast } from 'sonner'

import { AvatarPreview } from '@/components/avatar-preview'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { uploadChatFile } from './api'

export function ChatAvatar(props: { avatar?: string; name: string }) {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [avatar, setAvatar] = useState(props.avatar)
  // Keep the last saved image while disconnected; presence also carries changes
  // made in another tab, independently of this component's upload response.
  useEffect(() => {
    if (props.avatar !== undefined) setAvatar(props.avatar)
  }, [props.avatar])
  const upload = useMutation({
    mutationFn: (file: File) => uploadChatFile(file, 'avatar'),
    onSuccess: (result) => {
      setAvatar(result.data.url)
      toast.success(t('Upload successful'))
    },
  })

  return (
    <div className='flex shrink-0 items-center gap-2'>
      <AvatarPreview
        src={avatar}
        name={props.name}
        label={t('Current avatar')}
      />
      <Button
        type='button'
        variant='outline'
        disabled={upload.isPending}
        aria-label={t('Upload avatar')}
        onClick={() => fileInput.current?.click()}
      >
        {upload.isPending ? (
          <LoadingState inline size='sm' message={t('Uploading...')} />
        ) : (
          t('Upload avatar')
        )}
      </Button>
      <Input
        ref={fileInput}
        type='file'
        accept='.png,.jpg,.jpeg,.webp,.gif'
        className='hidden'
        aria-label={t('Upload avatar')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) upload.mutate(file)
        }}
      />
    </div>
  )
}
