import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { TicketsPage } from '@/features/tickets'

export const Route = createFileRoute('/_authenticated/tickets')({
  validateSearch: z.object({
    ticket: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  component: TicketsRoute,
})

function TicketsRoute() {
  const { ticket } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TicketsPage
      selected={ticket}
      onSelect={(id) => void navigate({ search: { ticket: id } })}
    />
  )
}
