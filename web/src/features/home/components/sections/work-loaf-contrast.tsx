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
import {
  Activity,
  Blocks,
  CheckCircle2,
  Coffee,
  KeyRound,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { CosmicTiltCard } from '../cosmic-tilt-card'

interface WorkLoafContrastProps {
  className?: string
}

const ROUTING_LANES = [
  {
    id: 'primary-pool',
    tier: 'P0',
    nameKey: 'Primary High-Speed Pool',
    weight: '60%',
    barWidth: 'w-3/5',
    statusKey: 'ACTIVE',
    barColor: 'bg-[var(--tidal-jade)]',
    statusColor: 'text-sky-700 dark:text-sky-300',
  },
  {
    id: 'balanced-pool',
    tier: 'P0',
    nameKey: 'Weighted Load-Balance Pool',
    weight: '40%',
    barWidth: 'w-2/5',
    statusKey: 'ACTIVE',
    barColor: 'bg-[var(--tidal-indigo)]',
    statusColor: 'text-indigo-700 dark:text-indigo-300',
  },
  {
    id: 'fallback-pool',
    tier: 'P1',
    nameKey: 'Auto-Failover Safety Net',
    weight: '100%',
    barWidth: 'w-full',
    statusKey: 'STANDBY',
    barColor: 'bg-[var(--tidal-gold)]',
    statusColor: 'text-amber-700 dark:text-amber-300',
  },
] as const

const SECURITY_CONTROLS = [
  { id: 'model-allowlist', labelKey: 'Model Allowlist' },
  { id: 'ip-allowlist', labelKey: 'IP Restrictions' },
  { id: 'quota-cap', labelKey: 'Quota Budget Cap' },
  { id: 'passkeys', labelKey: 'WebAuthn Passkeys' },
  { id: 'oidc', labelKey: 'OAuth / OIDC' },
  { id: 'rbac', labelKey: 'Casbin RBAC' },
] as const

const TASK_STAGES = [
  {
    id: 'submit',
    step: '01',
    titleKey: 'Fire & Walk Away',
    detailKey: 'Submit prompt & pre-lock quota in milliseconds',
  },
  {
    id: 'poll',
    step: '02',
    titleKey: 'Background Polling',
    detailKey: 'Sandboxed JS plugin tracks progress while you grab tea',
  },
  {
    id: 'settle',
    step: '03',
    titleKey: 'Settle or Auto-Refund',
    detailKey: 'Exact usage billed on success; instant refund on failure',
  },
] as const

const TASK_ADAPTERS = [
  'Midjourney',
  'Kling',
  'Vidu',
  'Suno',
  'Flux',
  'moejs Plugins',
] as const

export function WorkLoafContrast(props: WorkLoafContrastProps) {
  const { t } = useTranslation()

  return (
    <section
      aria-labelledby='work-loaf-heading'
      className={cn('relative py-20 lg:py-28', props.className)}
    >
      <div className='mx-auto max-w-7xl px-6 sm:px-8'>
        {/* Section Header */}
        <AnimateInView
          animation='fade-up'
          className='mb-12 flex flex-col justify-between gap-6 lg:mb-16 lg:flex-row lg:items-end'
        >
          <div className='max-w-2xl'>
            <p className='text-muted-foreground mb-4 font-mono text-[11px] font-medium tracking-[0.2em] uppercase'>
              <span className='text-[var(--tidal-coral)]'>01</span>
              <span className='mx-2 opacity-40'>//</span>
              {t('Cosmic Division of Labor')}
            </p>
            <h2
              id='work-loaf-heading'
              className='text-3xl leading-[1.15] font-semibold tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]'
            >
              <span className='block'>
                {t('Leave the galactic roar to the gateway.')}
              </span>
              <span className='tidal-serif tidal-loaf-headline mt-1 block font-normal italic'>
                {t('Keep the unhurried hours for yourself.')}
              </span>
            </h2>
          </div>
          <p className='text-muted-foreground max-w-md text-sm leading-6 text-balance lg:text-right'>
            {t(
              'Across 93 billion light-years of scale, production AI headaches shrink to stardust—handled automatically in orbit while you lean back on Earth.'
            )}
          </p>
        </AnimateInView>

        {/* Asymmetric 12-Col Dual-World Bento (7+5 / 5+7) */}
        <div className='grid gap-5 lg:grid-cols-12'>
          {/* Card 1 (7 cols): Auto-Failover so your tea never gets cold */}
          <CosmicTiltCard
            wrapperClassName='lg:col-span-7'
            className='tidal-surface flex flex-col justify-between rounded-2xl border p-6 sm:p-7'
          >
            <div>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='text-muted-foreground flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase'>
                  <Activity
                    aria-hidden='true'
                    className='size-3.5 text-[var(--tidal-jade)]'
                  />
                  <span>01.1 // {t('Resilient Routing')}</span>
                </div>
                <Badge
                  variant='outline'
                  className='rounded-full border-[var(--tidal-jade)]/30 bg-[var(--tidal-jade-soft)] font-mono text-[10px] text-sky-800 dark:text-sky-200'
                >
                  <Coffee aria-hidden='true' className='mr-1 size-3' />
                  {t('Tea Stays Warm')}
                </Badge>
              </div>
              <h3 className='mt-3 text-xl font-semibold tracking-tight'>
                {t('429 Storms Upstairs, Zero Panic Downstairs')}
              </h3>
              <p className='text-muted-foreground mt-2 max-w-xl text-sm leading-6'>
                {t(
                  'Weighted priority pools detect upstream rate-limits or timeouts and retry across healthy channels mid-flight—no manual firefighting.'
                )}
              </p>
            </div>

            <div className='tidal-hairline-border bg-background/75 mt-7 space-y-3 rounded-xl border p-4 dark:bg-[#060b18]'>
              <div className='text-muted-foreground flex items-center justify-between font-mono text-[10px] tracking-[0.14em] uppercase'>
                <span>{t('Channel Pool Allocation')}</span>
                <span>{t('Priority · Weight')}</span>
              </div>
              {ROUTING_LANES.map((lane) => (
                <div
                  key={lane.id}
                  className='tidal-hairline-border bg-muted/25 rounded-lg border p-3'
                >
                  <div className='flex items-center justify-between gap-2 text-xs'>
                    <div className='flex items-center gap-2 font-medium'>
                      <span className='bg-foreground/8 rounded px-1.5 py-0.5 font-mono text-[10px]'>
                        {lane.tier}
                      </span>
                      <span>{t(lane.nameKey)}</span>
                    </div>
                    <div className='flex items-center gap-2.5 font-mono text-[11px]'>
                      <span className={lane.statusColor}>
                        {t(lane.statusKey)}
                      </span>
                      <span className='text-muted-foreground tabular-nums'>
                        {lane.weight}
                      </span>
                    </div>
                  </div>
                  <div className='bg-foreground/8 mt-2 h-1.5 w-full overflow-hidden rounded-full'>
                    <div
                      className={cn(
                        'h-full rounded-full',
                        lane.barWidth,
                        lane.barColor
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CosmicTiltCard>

          {/* Card 2 (5 cols): Atomic Ledger so no end-of-month Excel misery */}
          <CosmicTiltCard
            delay={60}
            wrapperClassName='lg:col-span-5'
            className='tidal-surface flex flex-col justify-between rounded-2xl border p-6 sm:p-7'
          >
            <div>
              <div className='flex items-center justify-between gap-2'>
                <div className='text-muted-foreground flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase'>
                  <ReceiptText
                    aria-hidden='true'
                    className='size-3.5 text-[var(--tidal-coral)]'
                  />
                  <span>01.2 // {t('Clear Accounting')}</span>
                </div>
                <span className='font-mono text-[10px] text-[var(--tidal-coral)]'>
                  {t('NO EXCEL NIGHTS')}
                </span>
              </div>
              <h3 className='mt-3 text-xl font-semibold tracking-tight'>
                {t('Atomic Quota & Cache-Aware Billing')}
              </h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(
                  'Pre-consume, streaming settlement, prompt-cache discounts, and tiered expressions reconcile automatically to the micro-unit.'
                )}
              </p>
            </div>

            <div className='tidal-hairline-border bg-background/75 mt-7 rounded-xl border p-4 font-mono text-xs dark:bg-[#060b18]'>
              <div className='tidal-hairline-border text-muted-foreground flex items-center justify-between border-b pb-2.5 text-[10px] tracking-[0.14em] uppercase'>
                <span>{t('Auto-Settled Receipt')}</span>
                <span className='text-emerald-700 dark:text-emerald-300'>
                  ATOMIC
                </span>
              </div>

              <div className='mt-3 space-y-2.5 text-[11px]'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>
                    {t('Prompt Tokens')}
                  </span>
                  <span className='tabular-nums'>1,240</span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>
                    {t('Cache Read Hit')}
                  </span>
                  <span className='text-emerald-700 tabular-nums dark:text-emerald-300'>
                    980 · -75%
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>
                    {t('Completion Tokens')}
                  </span>
                  <span className='tabular-nums'>640</span>
                </div>
              </div>

              <div className='tidal-hairline-border mt-3.5 flex items-center justify-between border-t pt-3 text-[11px]'>
                <span className='text-muted-foreground'>
                  {t('Rule Engine')}
                </span>
                <span className='font-medium text-[var(--tidal-coral)]'>
                  {t('Group Ratio × Tiered Expr')}
                </span>
              </div>
            </div>
          </CosmicTiltCard>

          {/* Card 3 (5 cols): One Scoped Key instead of 15 Vendor Logins */}
          <CosmicTiltCard
            delay={110}
            wrapperClassName='lg:col-span-5'
            className='tidal-surface flex flex-col justify-between rounded-2xl border p-6 sm:p-7'
          >
            <div>
              <div className='text-muted-foreground flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase'>
                <ShieldCheck
                  aria-hidden='true'
                  className='size-3.5 text-[var(--tidal-indigo)]'
                />
                <span>01.3 // {t('Calm Governance')}</span>
              </div>
              <h3 className='mt-3 text-xl font-semibold tracking-tight'>
                {t('One Scoped Key, Zero Credential Sprawl')}
              </h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(
                  'Stop sharing raw vendor keys in group chats. Issue scoped tokens with model allowlists, hard caps, Passkeys, OIDC, and Casbin RBAC.'
                )}
              </p>
            </div>

            <div className='tidal-hairline-border bg-background/75 mt-7 rounded-xl border p-4 dark:bg-[#060b18]'>
              <div className='tidal-hairline-border bg-muted/30 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 font-mono text-xs'>
                <span className='flex items-center gap-2 truncate'>
                  <KeyRound
                    aria-hidden='true'
                    className='size-3.5 shrink-0 text-[var(--tidal-indigo)]'
                  />
                  <span className='truncate'>sk-moyu-••••••••7f9a</span>
                </span>
                <span className='shrink-0 text-[10px] text-emerald-700 dark:text-emerald-300'>
                  {t('SCOPED')}
                </span>
              </div>

              <div className='mt-3.5 grid grid-cols-2 gap-2'>
                {SECURITY_CONTROLS.map((control) => (
                  <div
                    key={control.id}
                    className='tidal-hairline-border flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]'
                  >
                    <CheckCircle2
                      aria-hidden='true'
                      className='size-3 shrink-0 text-[var(--tidal-jade)]'
                    />
                    <span className='truncate'>{t(control.labelKey)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CosmicTiltCard>

          {/* Card 4 (7 cols): Async Multimodal Jobs — Submit & Go Slack Off */}
          <CosmicTiltCard
            delay={150}
            wrapperClassName='lg:col-span-7'
            className='tidal-surface flex flex-col justify-between rounded-2xl border p-6 sm:p-7'
          >
            <div className='flex items-start justify-between gap-4'>
              <div>
                <div className='text-muted-foreground flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase'>
                  <Blocks
                    aria-hidden='true'
                    className='size-3.5 text-[var(--tidal-gold)]'
                  />
                  <span>01.4 // {t('Fire & Unwind')}</span>
                </div>
                <h3 className='mt-3 text-xl font-semibold tracking-tight'>
                  {t('Submit Video & Image Jobs, Walk Away')}
                </h3>
                <p className='text-muted-foreground mt-2 max-w-xl text-sm leading-6'>
                  {t(
                    'Never stare at a slow spinner again. Sandboxed JavaScript task plugins poll long-running image, video, and music jobs and settle quotas automatically.'
                  )}
                </p>
              </div>
              <Badge
                variant='outline'
                className='hidden shrink-0 rounded-md font-mono text-[10px] sm:inline-flex'
              >
                PLUGIN API V1
              </Badge>
            </div>

            <div className='tidal-hairline-border bg-background/75 mt-7 rounded-xl border p-4 dark:bg-[#060b18]'>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                {TASK_STAGES.map((stage) => (
                  <div
                    key={stage.id}
                    className='tidal-hairline-border bg-muted/20 rounded-lg border p-3.5'
                  >
                    <span className='font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--tidal-jade)]'>
                      {stage.step}
                    </span>
                    <div className='mt-1 text-sm font-semibold'>
                      {t(stage.titleKey)}
                    </div>
                    <p className='text-muted-foreground mt-1 text-xs leading-5'>
                      {t(stage.detailKey)}
                    </p>
                  </div>
                ))}
              </div>

              <div
                aria-hidden='true'
                className='bg-foreground/8 relative mt-3.5 h-1 overflow-hidden rounded-full'
              >
                <div className='tidal-pipeline-pulse h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-[var(--tidal-jade)] to-transparent' />
              </div>

              <div className='mt-3.5 flex flex-wrap items-center gap-1.5'>
                {TASK_ADAPTERS.map((adapter) => (
                  <span
                    key={adapter}
                    className='tidal-hairline-border bg-background/80 text-muted-foreground rounded-md border px-2.5 py-1 font-mono text-[11px]'
                  >
                    {adapter}
                  </span>
                ))}
              </div>
            </div>
          </CosmicTiltCard>
        </div>
      </div>
    </section>
  )
}
