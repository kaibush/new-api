import { z } from 'zod'

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .refine((value) => [...value].length <= 80),
  description: z
    .string()
    .trim()
    .refine((value) => [...value].length <= 2000),
  kind: z.enum(['event', 'red_packet']),
  starts_at: z.date(),
  ends_at: z.date(),
})

export type CommunityEventFormValues = z.infer<typeof schema>

export function communityEventFormSchema(
  originalStart?: number
): typeof schema {
  return schema.refine((value) => {
    const now = Date.now()
    const start = value.starts_at.getTime()
    const end = value.ends_at.getTime()
    if (originalStart && originalStart <= now && start !== originalStart) {
      return false
    }
    return (
      (start > now || start === originalStart) && end > Math.max(now, start)
    )
  })
}
