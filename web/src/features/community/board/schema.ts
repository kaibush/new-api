import { z } from 'zod'

export const blockTypes = [
  'builtin.checkin',
  'builtin.checkin_leaderboard',
  'builtin.events',
  'builtin.red_packets',
  'builtin.red_packet_rules',
  'custom.action_card',
  'custom.notice',
  'custom.link_grid',
  'custom.banner',
  'custom.copy_card',
] as const
export const boardRoutes = [
  '/checkin',
  '/checkin-leaderboard',
  '/models',
  '/playground',
  '/wallet',
  '/subscriptions',
  '/keys',
  '/channel-status',
  '/profile',
  '/usage-logs',
] as const
export function safeBoardURL(value: string) {
  try {
    const url = new URL(value)
    return (
      /^https?:\/\//.test(value) &&
      /^https?:$/.test(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !/[\\\r\n\t]/.test(value)
    )
  } catch {
    return false
  }
}
export const actionSchema = z
  .object({
    type: z.enum([
      'external_url',
      'internal_route',
      'modal_content',
      'copy_text',
      'modal_widget',
      'chat_prefill',
    ]),
    confirm_leave: z.boolean().optional(),
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(12000),
  })
  .refine(
    (a) =>
      a.type !== 'external_url' ||
      (a.value.length <= 2048 && safeBoardURL(a.value)),
    { path: ['value'] }
  )
  .refine(
    (a) =>
      a.type !== 'internal_route' ||
      boardRoutes.some((route) => route === a.value),
    { path: ['value'] }
  )
  .refine(
    (a) =>
      a.type !== 'modal_widget' ||
      ['checkin', 'checkin_leaderboard'].includes(a.value),
    { path: ['value'] }
  )
  .refine((a) => a.type !== 'chat_prefill' || a.value.length <= 2000, {
    path: ['value'],
  })
export const blockSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(blockTypes),
    enabled: z.boolean(),
    leaderboard_tab: z.enum(['today', 'highlights', 'total']).optional(),
    leaderboard_limit: z.number().int().min(3).max(10).optional(),
    leaderboard_route: z.boolean().optional(),
    title: z.string().max(240),
    body: z.string().max(12000),
    image_url: z
      .string()
      .max(2048)
      .refine((value) => !value || safeBoardURL(value)),
    actions: z.array(actionSchema).max(12),
  })
  .refine((b) => b.type !== 'custom.banner' || !!b.image_url, {
    path: ['image_url'],
  })
  .refine(
    (b) =>
      !b.type.startsWith('builtin.') ||
      (!b.body && !b.image_url && !b.actions.length)
  )
  .refine(
    (b) =>
      new Set(b.actions.map((a) => JSON.stringify(a))).size === b.actions.length
  )
export const boardSchema = z
  .object({
    schema_version: z.literal(1),
    version: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    title: z.string().max(240),
    subtitle: z.string().max(600),
    blocks: z.array(blockSchema).max(30),
  })
  .refine((d) => new Set(d.blocks.map((b) => b.id)).size === d.blocks.length)
  .refine((d) => {
    const types = d.blocks
      .filter(
        (b) =>
          b.type.startsWith('builtin.') &&
          b.type !== 'builtin.checkin_leaderboard'
      )
      .map((b) => b.type)
    return new Set(types).size === types.length
  })
  .refine((d) => new TextEncoder().encode(JSON.stringify(d)).length <= 60000)
export type BoardDocument = z.infer<typeof boardSchema>
export type BoardBlock = z.infer<typeof blockSchema>
export type BoardAction = z.infer<typeof actionSchema>
export function defaultBoard(): BoardDocument {
  return normalizeBoard({
    schema_version: 1,
    version: 0,
    title: '',
    subtitle: '',
    blocks: blockTypes
      .filter((type) => type.startsWith('builtin.'))
      .map((type) => ({
        id: type,
        type,
        enabled: true,
        title: '',
        body: '',
        image_url: '',
        actions: [],
      })),
  })
}

export function normalizeBoard(document: BoardDocument): BoardDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      ...(block.type === 'builtin.checkin_leaderboard'
        ? {
            leaderboard_tab: block.leaderboard_tab ?? 'today',
            leaderboard_limit: block.leaderboard_limit ?? 5,
            leaderboard_route: block.leaderboard_route ?? false,
          }
        : {}),
      actions: block.actions.map((action) => ({
        ...action,
        ...(action.type === 'external_url'
          ? { confirm_leave: action.confirm_leave ?? false }
          : {}),
      })),
    })),
  }
}
