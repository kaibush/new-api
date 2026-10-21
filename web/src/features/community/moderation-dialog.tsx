import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { clearChatMessages, deleteChatMessage, type ChatMessage } from './api'

export function ChatModerationDialog(props: {
  target: ChatMessage | 'all' | null
  onClose: () => void
  onCleared?: (throughId: number) => void
  onDeleted?: (id: number) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const clearing = props.target === 'all'
  const mutation = useMutation({
    mutationFn: async (target: ChatMessage | 'all') => {
      if (target === 'all') return clearChatMessages()
      await deleteChatMessage(target.id)
      return null
    },
    onSuccess: (result, target) => {
      if (result) props.onCleared?.(result.cleared_through_id)
      if (target !== 'all') props.onDeleted?.(target.id)
      toast.success(
        target === 'all' ? t('Conversations cleared') : t('Message deleted')
      )
      props.onClose()
      void client.invalidateQueries({ queryKey: ['community-history'] })
    },
  })
  return (
    <ConfirmDialog
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={clearing ? t('Clear all conversations') : t('Delete message')}
      desc={
        clearing
          ? t(
              'All existing messages will disappear for everyone in the chat. Administrators can still view the original messages and bot feedback in chat records. New messages will not be affected.'
            )
          : t(
              'This message will be removed from the chat. Administrators can still view the original in chat records.'
            )
      }
      confirmText={clearing ? t('Clear all conversations') : t('Delete')}
      destructive
      handleConfirm={() => {
        if (props.target && !mutation.isPending) mutation.mutate(props.target)
      }}
      isLoading={mutation.isPending}
    />
  )
}
