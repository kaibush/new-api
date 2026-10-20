import { createFileRoute } from '@tanstack/react-router'

import { CommunityChat } from '@/features/community'

export const Route = createFileRoute('/_authenticated/community/')({
  component: CommunityChat,
})
