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
import { z } from 'zod'

export const helpItemSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(['markdown', 'html', 'link']),
    content: z.string(),
    enabled: z.boolean(),
    htmlViewMode: z.enum(['preview', 'split', 'both']).optional(),
  })
  .refine((item) => {
    if (item.kind !== 'link') return true
    try {
      const url = new URL(item.content)
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  })

export const helpCenterSchema = z
  .object({
    version: z.literal(1),
    items: z.array(helpItemSchema).max(100),
  })
  .refine(
    (config) =>
      new Set(config.items.map((item) => item.id)).size === config.items.length
  )
  .refine(
    (config) =>
      new TextEncoder().encode(JSON.stringify(config)).length <= 2 * 1024 * 1024
  )

export type HelpItem = z.infer<typeof helpItemSchema>
export type HelpCenterConfig = z.infer<typeof helpCenterSchema>

export function buildPreviewDocument(content: string): string {
  const document = new DOMParser().parseFromString(content, 'text/html')
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
  document.head.prepend(policy)
  return `<!doctype html>${document.documentElement.outerHTML}`
}
