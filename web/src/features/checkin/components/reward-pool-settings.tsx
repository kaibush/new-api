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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { formatCheckinPercent } from '../format'
import type { CheckinSettingsValues } from './settings-section'

const colors = [
  'bg-slate-400',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
]
const presets = {
  A: [
    [10, 13, 7500],
    [14, 20, 1800],
    [21, 32, 600],
    [33, 50, 100],
  ],
  B: [
    [6, 10, 8000],
    [11, 18, 1400],
    [19, 35, 500],
    [36, 60, 100],
  ],
  C: [
    [3, 7, 8500],
    [8, 15, 1100],
    [16, 35, 350],
    [36, 80, 50],
  ],
} as const

export function RewardPoolSettings(props: { referenceMean: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const form = useFormContext<CheckinSettingsValues>()
  const pool = form.watch('pool')
  const tiers = pool.tiers ?? []
  const slots = pool.time_slots ?? []
  const total = tiers.reduce((sum, tier) => sum + tier.weight_bps, 0)
  const expected = tiers.reduce(
    (sum, tier) =>
      sum + (tier.weight_bps * (tier.min_quota + tier.max_quota)) / 20000,
    0
  )
  const saving =
    props.referenceMean > 0 ? (1 - expected / props.referenceMean) * 100 : 0

  function applyPreset(preset: keyof typeof presets) {
    const scale = props.referenceMean > 0 ? props.referenceMean / 17.5 : 1
    const names = [t('Daily base'), t('Regular'), t('Lucky'), t('Jackpot')]
    const next = presets[preset].map(([minimum, maximum, weight], index) => ({
      key: ['base', 'regular', 'lucky', 'jackpot'][index],
      name: names[index],
      min_quota: Math.round(minimum * scale),
      max_quota: Math.round(maximum * scale),
      weight_bps: weight,
      daily_max_count: 0,
    }))
    form.setValue('pool.tiers', next, { shouldDirty: true })
    form.setValue('pool.reward_mode', 'tiered', { shouldDirty: true })
    form.setValue('minQuota', next[0].min_quota, { shouldDirty: true })
    form.setValue('maxQuota', next[3].max_quota, { shouldDirty: true })
    form.setValue(
      'pool.time_slots',
      slots.map((slot) => ({
        ...slot,
        override_tiers: false,
        tier_weights: [],
      })),
      { shouldDirty: true }
    )
  }

  return (
    <section
      className='space-y-5 rounded-xl border p-4 sm:p-5'
      aria-label={t('Flexible reward pool')}
    >
      <div>
        <h3 className='font-semibold'>{t('Flexible reward pool')}</h3>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t(
            'Most users receive smaller daily rewards; a few receive larger prizes.'
          )}
        </p>
      </div>
      <div className='grid gap-4 sm:grid-cols-3'>
        <FormField
          control={form.control}
          name='pool.reward_mode'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Reward distribution')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value)
                  if (value === 'tiered' && tiers.length === 0) {
                    applyPreset('B')
                  }
                  if (value === 'uniform') {
                    form.setValue('pool.time_slots_enabled', false, {
                      shouldDirty: true,
                    })
                  }
                }}
                items={[
                  { value: 'uniform', label: t('Uniform') },
                  { value: 'tiered', label: t('Tiered pool') },
                ]}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value='uniform'>{t('Uniform')}</SelectItem>
                  <SelectItem value='tiered'>{t('Tiered pool')}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='pool.timezone'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Check-in timezone')}</FormLabel>
              <FormControl>
                <Input placeholder='Asia/Shanghai' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='pool.stats_retention_days'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Statistics retention (days)')}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={1}
                  max={30}
                  value={field.value}
                  onChange={(event) =>
                    field.onChange(Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Statistics and leaderboard history are kept for up to 30 days. Issued balances and monthly caps are preserved.'
        )}
      </p>
      <div className='flex flex-wrap gap-2'>
        {(['A', 'B', 'C'] as const).map((preset) => (
          <Button
            key={preset}
            type='button'
            variant='outline'
            size='sm'
            onClick={() => applyPreset(preset)}
          >
            {t('Preset {{name}}', { name: preset })} ·{' '}
            {t(
              {
                A: 'Gentle transition',
                B: 'Balanced savings',
                C: 'Strong savings',
              }[preset]
            )}
          </Button>
        ))}
      </div>
      {pool.reward_mode === 'tiered' && (
        <>
          <div className='space-y-2'>
            <div
              className='bg-muted flex h-3 overflow-hidden rounded-full'
              aria-hidden='true'
            >
              {tiers.map((tier, index) => (
                <div
                  key={tier.key}
                  className={colors[index % colors.length]}
                  style={{ width: `${tier.weight_bps / 100}%` }}
                />
              ))}
            </div>
            <p
              role='status'
              className={
                total === 10000
                  ? 'text-sm text-emerald-600 dark:text-emerald-400'
                  : 'text-destructive text-sm'
              }
            >
              {t('Total probability')}:{' '}
              {formatCheckinPercent(total / 100, locale)}
            </p>
            {total !== 10000 && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={
                  tiers.length === 0 ||
                  total - (tiers[0]?.weight_bps ?? 0) > 10000
                }
                onClick={() =>
                  form.setValue(
                    'pool.tiers.0.weight_bps',
                    10000 - total + tiers[0].weight_bps,
                    { shouldDirty: true }
                  )
                }
              >
                {t('Fill remaining probability into the base tier')}
              </Button>
            )}
          </div>
          {tiers.map((tier, index) => (
            <div key={tier.key} className='space-y-3 rounded-lg border p-3'>
              <div className='flex items-center justify-between gap-2'>
                <span className='flex items-center gap-2 text-sm font-medium'>
                  <span
                    className={`size-2 rounded-full ${colors[index % colors.length]}`}
                  />
                  {tier.name}
                </span>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  aria-label={t('Remove tier {{name}}', { name: tier.name })}
                  disabled={index === 0 || tiers.length <= 2}
                  onClick={() => {
                    const removed = tiers[index]
                    const next = tiers
                      .filter((_, i) => i !== index)
                      .map((item, i) =>
                        i === 0
                          ? {
                              ...item,
                              weight_bps: item.weight_bps + removed.weight_bps,
                            }
                          : item
                      )
                    form.setValue('pool.tiers', next, { shouldDirty: true })
                    form.setValue(
                      'pool.time_slots',
                      slots.map((slot) => ({
                        ...slot,
                        override_tiers: false,
                        tier_weights: [],
                      })),
                      { shouldDirty: true }
                    )
                  }}
                >
                  {t('Remove')}
                </Button>
              </div>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                <FormField
                  control={form.control}
                  name={`pool.tiers.${index}.name`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Tier name')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(
                  [
                    'min_quota',
                    'max_quota',
                    'weight_bps',
                    'daily_max_count',
                  ] as const
                ).map((property) => (
                  <FormField
                    key={property}
                    control={form.control}
                    name={`pool.tiers.${index}.${property}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t(
                            {
                              min_quota: 'Minimum quota',
                              max_quota: 'Maximum quota',
                              weight_bps: 'Probability (%)',
                              daily_max_count: 'Daily winners limit',
                            }[property]
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={property === 'weight_bps' ? 0.01 : 1}
                            max={property === 'weight_bps' ? 100 : undefined}
                            disabled={
                              property === 'daily_max_count' && index === 0
                            }
                            value={
                              property === 'weight_bps'
                                ? field.value / 100
                                : field.value
                            }
                            onChange={(event) =>
                              field.onChange(
                                property === 'weight_bps'
                                  ? Math.round(Number(event.target.value) * 100)
                                  : Number(event.target.value)
                              )
                            }
                          />
                        </FormControl>
                        {(property === 'min_quota' ||
                          property === 'max_quota') && (
                          <FormDescription>
                            {formatQuotaWithCurrency(field.value)}
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={tiers.length >= 6}
            onClick={() => {
              form.setValue(
                'pool.tiers',
                [
                  ...tiers,
                  {
                    key: `tier-${crypto.randomUUID().slice(0, 8)}`,
                    name: t('Lucky'),
                    min_quota: 1,
                    max_quota: Number(form.getValues('maxQuota')),
                    weight_bps: 0,
                    daily_max_count: 0,
                  },
                ],
                { shouldDirty: true }
              )
              form.setValue(
                'pool.time_slots',
                slots.map((slot) => ({
                  ...slot,
                  override_tiers: false,
                  tier_weights: [],
                })),
                { shouldDirty: true }
              )
            }}
          >
            {t('Add reward tier')}
          </Button>
          <FormField
            control={form.control}
            name='pool.tiers'
            render={() => (
              <FormItem>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='bg-muted/50 grid gap-4 rounded-lg p-4 sm:grid-cols-2'>
            <div>
              <p className='text-muted-foreground text-sm'>
                {t('Expected base reward')}
              </p>
              <p className='mt-1 text-xl font-semibold'>
                {formatQuotaWithCurrency(expected)}
              </p>
            </div>
            <div role='group' aria-label={t('Estimated savings')}>
              <p className='text-muted-foreground text-sm'>
                {t('Estimated savings')}
              </p>
              <p className='mt-1 text-xl font-semibold'>
                {formatCheckinPercent(saving, locale)}
              </p>
            </div>
            <p className='text-muted-foreground text-xs sm:col-span-2'>
              {t(
                'Presets scale from the saved reward range. Estimates exclude time rules, activity adjustments and daily limits.'
              )}
            </p>
          </div>
          <FormField
            control={form.control}
            name='pool.time_slots_enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-3'>
                <div>
                  <FormLabel>{t('Enable time-based rules')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Use different quota multipliers during selected hours.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {pool.time_slots_enabled && (
            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='pool.default_slot_quota_bps'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Default time multiplier (%)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={10}
                        max={500}
                        step={0.01}
                        value={field.value / 100}
                        onChange={(event) =>
                          field.onChange(
                            Math.round(Number(event.target.value) * 100)
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {slots.map((slot, index) => (
                <div key={slot.key} className='space-y-3 rounded-lg border p-3'>
                  <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                    <FormField
                      control={form.control}
                      name={`pool.time_slots.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Time slot name')}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {(['start_minute', 'end_minute'] as const).map(
                      (property) => (
                        <FormField
                          key={property}
                          control={form.control}
                          name={`pool.time_slots.${index}.${property}`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t(
                                  property === 'start_minute'
                                    ? 'Start time'
                                    : 'End time'
                                )}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type='time'
                                  value={`${String(Math.floor((field.value % 1440) / 60)).padStart(2, '0')}:${String(field.value % 60).padStart(2, '0')}`}
                                  onChange={(event) => {
                                    const [hour, minute] = event.target.value
                                      .split(':')
                                      .map(Number)
                                    if (!Number.isFinite(hour + minute)) return
                                    const value = hour * 60 + minute
                                    field.onChange(
                                      property === 'end_minute' && value === 0
                                        ? 1440
                                        : value
                                    )
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )
                    )}
                    <FormField
                      control={form.control}
                      name={`pool.time_slots.${index}.quota_bps`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Quota multiplier (%)')}</FormLabel>
                          <FormControl>
                            <Input
                              type='number'
                              min={10}
                              max={500}
                              step={0.01}
                              value={field.value / 100}
                              onChange={(event) =>
                                field.onChange(
                                  Math.round(Number(event.target.value) * 100)
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name={`pool.time_slots.${index}.override_tiers`}
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between gap-3'>
                        <FormLabel>
                          {t('Use custom tier probabilities')}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked)
                              if (checked) {
                                form.setValue(
                                  `pool.time_slots.${index}.tier_weights`,
                                  tiers.map((tier) => ({
                                    tier_key: tier.key,
                                    weight_bps: tier.weight_bps,
                                  })),
                                  { shouldDirty: true }
                                )
                              }
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {slot.override_tiers && (
                    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                      {slot.tier_weights.map((entry, weightIndex) => (
                        <FormField
                          key={entry.tier_key}
                          control={form.control}
                          name={`pool.time_slots.${index}.tier_weights.${weightIndex}.weight_bps`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {
                                  tiers.find(
                                    (tier) => tier.key === entry.tier_key
                                  )?.name
                                }{' '}
                                · {t('Probability (%)')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type='number'
                                  min={0}
                                  max={100}
                                  step={0.01}
                                  value={field.value / 100}
                                  onChange={(event) =>
                                    field.onChange(
                                      Math.round(
                                        Number(event.target.value) * 100
                                      )
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                  )}
                  <FormField
                    control={form.control}
                    name={`pool.time_slots.${index}.tier_weights`}
                    render={() => (
                      <FormItem>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      form.setValue(
                        'pool.time_slots',
                        slots.filter((_, i) => i !== index),
                        { shouldDirty: true }
                      )
                    }
                  >
                    {t('Remove')}
                  </Button>
                </div>
              ))}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'End time 00:00 means the end of the day. Time slots cannot overlap.'
                )}
              </p>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={slots.length >= 8}
                onClick={() => {
                  const lastEnd = Math.max(
                    0,
                    ...slots.map((slot) => slot.end_minute)
                  )
                  const start = lastEnd < 1440 ? lastEnd : 0
                  form.setValue(
                    'pool.time_slots',
                    [
                      ...slots,
                      {
                        key: `slot-${crypto.randomUUID().slice(0, 8)}`,
                        name: t('Time slot'),
                        start_minute: start,
                        end_minute: Math.min(start + 60, 1440),
                        quota_bps: 10000,
                        override_tiers: false,
                        tier_weights: [],
                      },
                    ],
                    { shouldDirty: true }
                  )
                }}
              >
                {t('Add time slot')}
              </Button>
              <FormField
                control={form.control}
                name='pool.time_slots'
                render={() => (
                  <FormItem>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
          <FormField
            control={form.control}
            name='pool.daily_pool.enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-3'>
                <div>
                  <FormLabel>{t('Limit daily high-tier rewards')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When the budget is reached, later high-tier draws fall back to the first tier.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {pool.daily_pool.enabled && (
            <FormField
              control={form.control}
              name='pool.daily_pool.daily_bonus_cap'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Daily high-tier quota budget')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {formatQuotaWithCurrency(field.value)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </>
      )}
      <FormField
        control={form.control}
        name='pool.leaderboard.enabled'
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-3'>
            <div>
              <FormLabel>{t('Enable public check-in leaderboard')}</FormLabel>
              <FormDescription>
                {t('Show daily winners and recent high rewards to users.')}
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
      {pool.leaderboard.enabled && (
        <div className='space-y-3'>
          <FormField
            control={form.control}
            name='pool.leaderboard.top_n'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Leaderboard size')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={5}
                    max={50}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {(
            ['mask_username', 'show_my_rank', 'show_recent_jackpots'] as const
          ).map((property) => (
            <FormField
              key={property}
              control={form.control}
              name={`pool.leaderboard.${property}`}
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-3'>
                  <FormLabel>
                    {t(
                      {
                        mask_username: 'Mask leaderboard names',
                        show_my_rank: 'Show my daily rank',
                        show_recent_jackpots: 'Show recent jackpots',
                      }[property]
                    )}
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          ))}
        </div>
      )}
    </section>
  )
}
