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
import { t } from 'i18next'
import { z } from 'zod'

import { pluginExpressionsEqual } from '@/features/pricing/lib/plugin-pricing'

import type { ModelPricingEntry } from './api'
import { PRICING_KEYS, type PricingValues } from './pricing'

const price = z.number().nonnegative()
const pricingSchema = z
  .strictObject({
    ModelPrice: price.optional(),
    ModelRatio: price.optional(),
    CompletionRatio: price.optional(),
    CacheRatio: price.optional(),
    CreateCacheRatio: price.optional(),
    ImageRatio: price.optional(),
    AudioRatio: price.optional(),
    AudioCompletionRatio: price.optional(),
    'billing_setting.billing_mode': z.enum(['ratio', 'tiered_expr']).optional(),
    'billing_setting.billing_expr': z
      .string()
      .refine((value) => Boolean(value.trim()))
      .optional(),
    'billing_setting.plugin_billing_expr': z
      .record(
        z.string().min(1),
        z.string().refine((value) => Boolean(value.trim()))
      )
      .optional(),
  })
  .refine((values) => Object.keys(values).length > 0)
  .refine(
    (values) =>
      values['billing_setting.billing_mode'] !== 'tiered_expr' ||
      Boolean(values['billing_setting.billing_expr'])
  )

const transferSchema = z.strictObject({
  format: z.literal('new-api/model-pricing'),
  version: z.literal(1),
  source_model: z.string(),
  pricing: pricingSchema,
})

export const MAX_PRICING_IMPORT_BYTES = 1024 * 1024

export function parsePricingImport(json: string): PricingValues {
  if (new TextEncoder().encode(json).length >= MAX_PRICING_IMPORT_BYTES) {
    throw new Error(t('Pricing JSON must be smaller than 1 MB'))
  }
  let value: unknown
  try {
    value = JSON.parse(json.trim())
  } catch {
    throw new Error(t('Pricing must be a JSON object'))
  }
  if (value && typeof value === 'object' && 'format' in value) {
    const result = transferSchema.safeParse(value)
    if (result.success) return result.data.pricing
  } else {
    const result = pricingSchema.safeParse(value)
    if (result.success) return result.data
  }
  throw new Error(
    t(
      'Invalid pricing JSON. Check the format version, field names, and non-negative numeric prices.'
    )
  )
}

export function exportModelPricing(
  entry: Pick<ModelPricingEntry, 'model_name' | 'configured' | 'effective'>
): string {
  const pricing = { ...entry.configured }
  // Built-in expressions are not stored overrides, but must travel with the
  // export or a different target would silently pick its own built-in price.
  if (entry.effective['billing_setting.billing_mode'] === 'tiered_expr') {
    pricing['billing_setting.billing_mode'] = 'tiered_expr'
    pricing['billing_setting.billing_expr'] =
      entry.effective['billing_setting.billing_expr']
  } else {
    // Legacy wildcard/default prices can be effective without an exact-name
    // override. Carry their base price and model-dependent multipliers too.
    for (const key of [
      'ModelPrice',
      'ModelRatio',
      'CompletionRatio',
      'AudioRatio',
      'AudioCompletionRatio',
    ] as const) {
      delete pricing[key]
      if (entry.effective[key] !== undefined) {
        pricing[key] = entry.effective[key]
      }
    }
  }
  return JSON.stringify(
    {
      format: 'new-api/model-pricing',
      version: 1,
      source_model: entry.model_name,
      pricing,
    },
    null,
    2
  )
}

// The existing form projects pricing into editable fields. Merge only actual
// edits back, retaining raw expressions, inactive legacy values and omission.
export function mergePricingEditorDraft(
  original: PricingValues,
  baseline: PricingValues,
  draft: PricingValues
): PricingValues {
  if (
    baseline['billing_setting.billing_mode'] !==
    draft['billing_setting.billing_mode']
  ) {
    return draft
  }
  const result = { ...original }
  for (const key of PRICING_KEYS) {
    const unchanged =
      key === 'billing_setting.plugin_billing_expr'
        ? pluginExpressionsEqual(baseline[key], draft[key])
        : baseline[key] === draft[key]
    if (unchanged) continue
    delete result[key]
    if (draft[key] !== undefined) Object.assign(result, { [key]: draft[key] })
  }
  return result
}
