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

const quota = z.number().int().min(0).max(2147483647)
const key = z.string().regex(/^[a-z0-9_-]{1,32}$/)
const name = z.string().trim().min(1).max(32)
const weight = z.number().int().min(0).max(10000)
const multiplier = z.number().int().min(1000).max(50000)

export const checkinPoolSchema = z
  .object({
    reward_mode: z.enum(['uniform', 'tiered']),
    timezone: z
      .string()
      .min(1)
      .refine((value) => {
        if (value === 'Local') return true
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, 'Invalid check-in timezone'),
    stats_retention_days: z.number().int().min(1).max(30),
    // Keep inactive configuration editable without validating hidden controls.
    tiers: z.array(
      z.object({
        key: z.string(),
        name: z.string().trim(),
        min_quota: z.number(),
        max_quota: z.number(),
        weight_bps: z.number(),
        daily_max_count: z.number(),
      })
    ),
    time_slots_enabled: z.boolean(),
    default_slot_quota_bps: z.number(),
    time_slots: z.array(
      z.object({
        key: z.string(),
        name: z.string().trim(),
        start_minute: z.number(),
        end_minute: z.number(),
        quota_bps: z.number(),
        override_tiers: z.boolean(),
        tier_weights: z.array(
          z.object({ tier_key: z.string(), weight_bps: z.number() })
        ),
      })
    ),
    daily_pool: z.object({
      enabled: z.boolean(),
      daily_bonus_cap: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }),
    leaderboard: z.object({
      enabled: z.boolean(),
      top_n: z.number().int().min(5).max(50),
      mask_username: z.boolean(),
      show_my_rank: z.boolean(),
      show_recent_jackpots: z.boolean(),
    }),
  })
  .superRefine((pool, context) => {
    const fail = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: 'custom', message, path })
    if (pool.reward_mode === 'tiered') {
      if (pool.tiers.length < 2 || pool.tiers.length > 6) {
        fail('Check-in reward pool requires 2 to 6 tiers', ['tiers'])
      }
      if (
        new Set(pool.tiers.map((tier) => tier.key)).size !== pool.tiers.length
      ) {
        fail('Invalid check-in reward tier', ['tiers'])
      }
      if (
        pool.tiers.reduce((sum, tier) => sum + tier.weight_bps, 0) !== 10000
      ) {
        fail('Check-in reward tier probabilities must total 100%', [
          'tiers',
          0,
          'weight_bps',
        ])
      }
      pool.tiers.forEach((tier, index) => {
        const result = z
          .object({
            key,
            name,
            min_quota: quota,
            max_quota: quota,
            weight_bps: weight,
            daily_max_count: z
              .number()
              .int()
              .min(0)
              .max(Number.MAX_SAFE_INTEGER),
          })
          .safeParse(tier)
        if (!result.success) {
          for (const issue of result.error.issues) {
            context.addIssue({
              ...issue,
              path: ['tiers', index, ...issue.path],
            })
          }
        }
        if (tier.max_quota < tier.min_quota) {
          fail('Maximum must be at least the minimum', [
            'tiers',
            index,
            'max_quota',
          ])
        }
        if (index === 0 && tier.daily_max_count !== 0) {
          fail('The fallback check-in tier cannot have a daily limit', [
            'tiers',
            index,
            'daily_max_count',
          ])
        }
      })
    }
    if (!pool.time_slots_enabled) return
    const defaultMultiplier = multiplier.safeParse(pool.default_slot_quota_bps)
    if (!defaultMultiplier.success) {
      for (const issue of defaultMultiplier.error.issues) {
        context.addIssue({ ...issue, path: ['default_slot_quota_bps'] })
      }
    }
    if (pool.time_slots.length < 1 || pool.time_slots.length > 8) {
      fail('Invalid check-in time slot settings', ['time_slots'])
    }
    if (
      new Set(pool.time_slots.map((slot) => slot.key)).size !==
      pool.time_slots.length
    ) {
      fail('Invalid check-in time slot', ['time_slots'])
    }
    pool.time_slots.forEach((slot, index) => {
      const result = z
        .object({
          key,
          name,
          start_minute: z.number().int().min(0).max(1439),
          end_minute: z.number().int().min(1).max(1440),
          quota_bps: multiplier,
        })
        .safeParse(slot)
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            ...issue,
            path: ['time_slots', index, ...issue.path],
          })
        }
      }
      if (slot.start_minute >= slot.end_minute) {
        fail('Invalid check-in time slot', ['time_slots', index, 'end_minute'])
      }
      if (
        pool.time_slots.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            slot.start_minute < other.end_minute &&
            other.start_minute < slot.end_minute
        )
      ) {
        fail('Check-in time slots must not overlap', [
          'time_slots',
          index,
          'start_minute',
        ])
      }
      if (slot.override_tiers) {
        const weights = z
          .array(z.object({ tier_key: key, weight_bps: weight }))
          .safeParse(slot.tier_weights)
        if (!weights.success) {
          for (const issue of weights.error.issues) {
            context.addIssue({
              ...issue,
              path: ['time_slots', index, 'tier_weights', ...issue.path],
            })
          }
        }
        const keys = new Set(slot.tier_weights.map((entry) => entry.tier_key))
        if (
          pool.reward_mode !== 'tiered' ||
          keys.size !== pool.tiers.length ||
          slot.tier_weights.length !== keys.size ||
          pool.tiers.some((tier) => !keys.has(tier.key))
        ) {
          fail('Invalid check-in time slot tier weights', [
            'time_slots',
            index,
            'tier_weights',
          ])
        }
        if (
          slot.tier_weights.reduce(
            (sum, entry) => sum + entry.weight_bps,
            0
          ) !== 10000
        ) {
          fail('Check-in time slot probabilities must total 100%', [
            'time_slots',
            index,
            'tier_weights',
            0,
            'weight_bps',
          ])
        }
      }
    })
  })
