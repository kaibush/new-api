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
import { describe, expect, it } from 'vitest'

import { pricingFromDraft, pricingRow, type PricingValues } from '../pricing'
import {
  exportModelPricing,
  parsePricingImport,
  mergePricingEditorDraft,
} from '../pricing-transfer'

const expression =
  'v1:(len <= 200000 ? tier("short", p * 0 + c * 2 + cr * 0.1 + cc1h * 3) : tier("long", p * 4 + ao * 6)) * (hour("Asia/Shanghai") >= 22 ? 0.5 : 1)'

describe('model pricing transfer', () => {
  it.each<PricingValues>([
    { ModelPrice: 0, ModelRatio: 2, 'billing_setting.billing_mode': 'ratio' },
    {
      ModelRatio: 0,
      CompletionRatio: 2,
      CacheRatio: 0,
      CreateCacheRatio: 1.25,
      ImageRatio: 0,
      AudioRatio: 3,
      AudioCompletionRatio: 4,
    },
    {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': expression,
      ModelPrice: 0,
    },
    {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr':
        'tier("base", u("tokens") * 9.8 / 1000000)',
      'billing_setting.plugin_billing_expr': {
        provider: 'tier("video", u("seconds") * 0.4)',
      },
    },
  ])(
    'round-trips the complete pricing configuration without dropping inactive fields',
    (pricing) => {
      const json = exportModelPricing({
        model_name: 'source',
        configured: pricing,
        effective: pricing,
      })
      expect(parsePricingImport(json)).toEqual(pricing)
      expect(JSON.parse(json)).toMatchObject({
        version: 1,
        source_model: 'source',
      })
    }
  )

  it('materializes a built-in expression so a different target does not inherit its own price', () => {
    const pricing = {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': expression,
    }
    expect(
      parsePricingImport(
        exportModelPricing({
          model_name: 'builtin',
          configured: {},
          effective: pricing,
        })
      )
    ).toEqual(pricing)
  })

  it.each([
    'null',
    '[]',
    '{}',
    '{"ModelPrice":null}',
    '{"ModelPrice":-1}',
    '{"ModelRatio":"1"}',
    '{"ModelPrice":1e999}',
    '{"unknown":1}',
    '{"billing_setting.billing_mode":"unknown"}',
    '{"billing_setting.billing_mode":"tiered_expr"}',
    '{"billing_setting.plugin_billing_expr":{"provider":1}}',
    '{"format":"new-api/model-pricing","version":2,"pricing":{"ModelPrice":1}}',
  ])('rejects malformed or unsupported input: %s', (json) => {
    expect(() => parsePricingImport(json)).toThrow()
  })

  it('preserves the original expression and absent fields after viewing the visual editor', () => {
    const original: PricingValues = {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': expression,
      'billing_setting.plugin_billing_expr': {
        provider: 'tier("base", u("seconds") * 0)',
      },
    }
    const baseline = pricingFromDraft(pricingRow('target', original))
    expect(mergePricingEditorDraft(original, baseline, baseline)).toEqual(
      original
    )
    expect(
      mergePricingEditorDraft(original, baseline, {
        ...baseline,
        ModelRatio: 0,
      })
    ).toEqual({ ...original, ModelRatio: 0 })
  })

  it('applies intentional mode changes without retaining the previous active mode', () => {
    const original: PricingValues = {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': expression,
    }
    const next = { ModelPrice: 0, 'billing_setting.billing_mode': 'ratio' }
    expect(mergePricingEditorDraft(original, original, next)).toEqual(next)
  })
})

it('includes inherited legacy base prices and model-dependent defaults in an export', () => {
  const effective = {
    ModelRatio: 1.25,
    CompletionRatio: 3,
    AudioRatio: 2,
    AudioCompletionRatio: 4,
    CacheRatio: 0,
    CreateCacheRatio: 1.25,
  }
  expect(
    parsePricingImport(
      exportModelPricing({
        model_name: 'wildcard-alias',
        configured: { CacheRatio: 0 },
        effective,
      })
    )
  ).toEqual({
    ModelRatio: 1.25,
    CompletionRatio: 3,
    AudioRatio: 2,
    AudioCompletionRatio: 4,
    CacheRatio: 0,
  })
})

it('exports effective legacy alias prices instead of exact-name values ignored by billing', () => {
  expect(
    parsePricingImport(
      exportModelPricing({
        model_name: 'aliased-model',
        configured: {
          ModelPrice: 0.1,
          ModelRatio: 1,
          CompletionRatio: 10,
          CacheRatio: 0,
        },
        effective: { ModelRatio: 2, CompletionRatio: 3, CacheRatio: 0 },
      })
    )
  ).toEqual({ ModelRatio: 2, CompletionRatio: 3, CacheRatio: 0 })
})
