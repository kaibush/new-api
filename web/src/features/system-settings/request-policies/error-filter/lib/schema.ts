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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    enabled: z.boolean(),
    channels: z.array(z.number().int().positive()).max(256),
    model_pattern: z.string().max(2048),
    statuses: z.string().max(1024),
    field: z.enum(['message', 'type', 'code']),
    match: z.enum(['any', 'contains', 'exact', 'regex']),
    pattern: z.string().max(2048),
    case_sensitive: z.boolean(),
    action: z.enum(['preserve', 'replace', 'redact']),
    replacement: z.string().max(8192),
    output_type: z.string().max(128).optional(),
    output_code: z.string().max(128).optional(),
  })
  .strict()

export const configSchema = z
  .object({
    enabled: z.boolean(),
    fallback: z.enum(['preserve', 'replace']),
    fallback_message: z.string().max(8192),
    strip_details: z.boolean(),
    remove_headers: z.array(z.string().max(128)).max(32),
    rules: z.array(ruleSchema).max(100),
  })
  .strict()

export type ErrorRule = z.infer<typeof ruleSchema>
export type ErrorFilterConfig = z.infer<typeof configSchema>

export function validateRule(
  rule: ErrorRule,
  ctx: z.RefinementCtx,
  t: TFunction
) {
  if (rule.match !== 'any' && !rule.pattern) {
    ctx.addIssue({
      code: 'custom',
      path: ['pattern'],
      message: t('Match pattern is required'),
    })
  }
  if (rule.action === 'replace' && !rule.replacement.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['replacement'],
      message: t('Replacement message is required'),
    })
  }
  if (
    rule.action === 'redact' &&
    (rule.field !== 'message' || rule.match === 'any')
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['action'],
      message: t('Partial replacement requires a message pattern'),
    })
  }
  if (
    !parseHttpStatusCodeRules(rule.statuses).ok ||
    (rule.statuses.trim() &&
      !/^\s*\d{3}(\s*-\s*\d{3})?\s*(,\s*\d{3}(\s*-\s*\d{3})?\s*)*$/.test(
        rule.statuses
      ))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['statuses'],
      message: t('Invalid HTTP status range'),
    })
  }
}

export function createConfigSchema(t: TFunction) {
  return configSchema
    .extend({
      rules: z
        .array(
          ruleSchema.superRefine((rule, ctx) => validateRule(rule, ctx, t))
        )
        .max(100),
    })
    .superRefine((config, ctx) => {
      if (config.fallback === 'replace' && !config.fallback_message.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['fallback_message'],
          message: t('Replacement message is required'),
        })
      }
    })
}

export function newRule(): ErrorRule {
  return {
    name: '',
    enabled: true,
    channels: [],
    model_pattern: '',
    statuses: '',
    field: 'message',
    match: 'contains',
    pattern: '',
    case_sensitive: false,
    action: 'replace',
    replacement: '',
  }
}

export function createRuleFormSchema(t: TFunction) {
  return ruleSchema
    .omit({ channels: true })
    .extend({ channels_text: z.string() })
    .superRefine((value, ctx) => {
      validateRule({ ...value, channels: [] }, ctx, t)
      if (
        value.channels_text.trim() &&
        !/^\s*[1-9]\d*\s*(,\s*[1-9]\d*\s*)*$/.test(value.channels_text)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['channels_text'],
          message: t('Enter positive channel IDs separated by commas'),
        })
      }
    })
}
export type RuleFormValues = z.infer<ReturnType<typeof createRuleFormSchema>>
