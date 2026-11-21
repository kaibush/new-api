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
  AlertTriangle,
  CloudLightning,
  Sparkles,
  Sun,
  Waves,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/theme-provider'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  KOI_SPIRITS,
  POND_FEED_WHISPERS,
  TIDAL_PROTOCOLS,
  TIDAL_UPSTREAMS,
  type HomeMood,
  type KoiSpiritSpec,
  type ProtocolId,
  type TidalUpstreamBuoy,
} from '../constants'

interface TidalAquariumStageProps {
  className?: string
  mood: HomeMood
  selectedProtocolId?: ProtocolId
  onProtocolChange?: (id: ProtocolId) => void
}

interface PondRipple {
  id: number
  x: number
  y: number
}

const BUOY_X_POSITIONS: Record<string, number> = {
  openai: 270,
  claude: 410,
  gemini: 550,
  deepseek: 690,
}

function OrnamentalKoi(props: {
  spec: KoiSpiritSpec
  boosted: boolean
  onSelectKoi: (spec: KoiSpiritSpec) => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [playing, setPlaying] = useState(false)

  const spec = props.spec
  const gradBodyId = `koi-body-${spec.id}`
  const clipBodyId = `koi-clip-${spec.id}`
  const swimming = hovered || focused || playing || props.boosted

  return (
    <button
      type='button'
      aria-label={t(spec.labelKey)}
      aria-pressed={playing}
      data-swimming={swimming}
      style={{ left: spec.left, top: spec.top }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(event) => {
        event.stopPropagation()
        setPlaying((prev) => !prev)
        props.onSelectKoi(spec)
      }}
      className={cn(
        'tidal-koi-btn z-10 select-none',
        spec.widthClass,
        spec.glideClass
      )}
    >
      <span className={cn('tidal-koi-body-wrap', spec.flipX && '-scale-x-100')}>
        <svg
          viewBox='0 0 240 120'
          fill='none'
          aria-hidden='true'
          className='h-auto w-full overflow-visible'
        >
          <defs>
            <linearGradient
              id={gradBodyId}
              x1='55'
              y1='60'
              x2='222'
              y2='60'
              gradientUnits='userSpaceOnUse'
            >
              <stop offset='0%' stopColor={spec.bodySecondary} />
              <stop offset='62%' stopColor={spec.bodyPrimary} />
              <stop offset='100%' stopColor='#ffffff' />
            </linearGradient>
            <clipPath id={clipBodyId}>
              <path d='M 62 56 C 95 36, 168 33, 222 60 C 168 87, 95 84, 62 64 Z' />
            </clipPath>
          </defs>

          {/* Soft 3D underwater shadow cast onto pond bed */}
          <g transform='translate(-6, 17)' opacity='0.22'>
            <path
              d='M 64 56 C 96 39, 168 37, 220 60 C 168 83, 96 81, 64 64 Z'
              fill='var(--tidal-pond-shadow)'
            />
            <path
              d='M 66 57 C 42 40, 20 30, 10 38 C 20 52, 28 57, 22 60 C 28 63, 20 68, 10 82 C 20 90, 42 80, 66 63 Z'
              fill='var(--tidal-pond-shadow)'
            />
          </g>

          {/* Gossamer Pectoral & Ventral Fins */}
          <path
            d='M 158 45 C 142 14, 110 16, 120 46 Z'
            fill={spec.finTint}
            fillOpacity='0.58'
          />
          <path
            d='M 158 75 C 142 106, 110 104, 120 74 Z'
            fill={spec.finTint}
            fillOpacity='0.58'
          />
          <path
            d='M 106 49 C 94 31, 78 34, 86 52 Z'
            fill={spec.finTint}
            fillOpacity='0.44'
          />
          <path
            d='M 106 71 C 94 89, 78 86, 86 68 Z'
            fill={spec.finTint}
            fillOpacity='0.44'
          />

          {/* Flowing Bifurcated Veil Tail */}
          <g className='tidal-koi-tail'>
            <path
              d='M 66 56 C 42 34, 17 20, 7 31 C 18 47, 30 56, 21 60 C 30 64, 18 73, 7 89 C 17 100, 42 86, 66 64 Z'
              fill={spec.finTint}
              fillOpacity='0.72'
            />
            <path
              d='M 62 58 C 40 44, 22 36, 14 40 M 62 62 C 40 76, 22 84, 14 80'
              stroke='#ffffff'
              strokeOpacity='0.55'
              strokeWidth='1.3'
              strokeLinecap='round'
            />
          </g>

          {/* Sculpted Streamlined Koi Body */}
          <path
            d='M 62 56 C 95 36, 168 33, 222 60 C 168 87, 95 84, 62 64 Z'
            fill={`url(#${gradBodyId})`}
          />

          {/* Kohaku / Ornamental Dorsal Markings */}
          <g clipPath={`url(#${clipBodyId})`}>
            <ellipse
              cx='193'
              cy='59'
              rx='15'
              ry='11'
              fill={spec.patchColor}
              fillOpacity='0.9'
            />
            <path
              d='M 122 36 C 142 38, 158 52, 146 68 C 132 76, 112 66, 114 48 Z'
              fill={spec.patchColor}
              fillOpacity='0.86'
            />
            <ellipse
              cx='86'
              cy='63'
              rx='13'
              ry='9'
              fill={spec.patchColor}
              fillOpacity='0.82'
            />
          </g>

          {/* Dorsal Silk Fin & Specular Water Highlight */}
          <path
            d='M 164 59 Q 124 47 84 59'
            stroke='#ffffff'
            strokeOpacity='0.75'
            strokeWidth='2.4'
            strokeLinecap='round'
          />
          <path
            d='M 176 49 Q 140 44 108 50'
            stroke='#ffffff'
            strokeOpacity='0.5'
            strokeWidth='1.4'
            strokeLinecap='round'
          />

          {/* Delicate Koi Barbels & Eyes */}
          <path
            d='M 219 56 Q 228 50 232 52 M 219 64 Q 228 70 232 68'
            stroke={spec.patchColor}
            strokeOpacity='0.75'
            strokeWidth='1.4'
            strokeLinecap='round'
          />
          <circle cx='205' cy='50' r='2.1' fill='#0f172a' fillOpacity='0.78' />
          <circle cx='205' cy='70' r='2.1' fill='#0f172a' fillOpacity='0.78' />
        </svg>
      </span>
    </button>
  )
}

export function TidalAquariumStage(props: TidalAquariumStageProps) {
  const { i18n, t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const tankRef = useRef<HTMLDivElement>(null)
  const pondRef = useRef<HTMLDivElement>(null)
  const rippleSeqRef = useRef(1)

  const [internalProtocolId, setInternalProtocolId] =
    useState<ProtocolId>('openai-chat')
  const [selectedBuoyId, setSelectedBuoyId] = useState<string>('openai')
  const [stormActive, setStormActive] = useState(false)
  const [feedCount, setFeedCount] = useState(0)
  const [koiBoosted, setKoiBoosted] = useState(false)
  const [whisperKey, setWhisperKey] = useState<string>(POND_FEED_WHISPERS[0])
  const [ripples, setRipples] = useState<PondRipple[]>([])

  const activeProtocolId = props.selectedProtocolId ?? internalProtocolId
  const activeProtocol =
    TIDAL_PROTOCOLS.find((item) => item.id === activeProtocolId) ??
    TIDAL_PROTOCOLS[0]

  useEffect(() => {
    if (!koiBoosted) return
    const timer = window.setTimeout(() => setKoiBoosted(false), 1800)
    return () => window.clearTimeout(timer)
  }, [koiBoosted, feedCount])

  const effectiveBuoyId =
    stormActive && selectedBuoyId === 'openai' ? 'claude' : selectedBuoyId
  const activeBuoy: TidalUpstreamBuoy =
    TIDAL_UPSTREAMS.find((item) => item.id === effectiveBuoyId) ??
    TIDAL_UPSTREAMS[0]
  const activeAccent = isDark ? activeBuoy.accentDark : activeBuoy.accentLight
  const targetX = BUOY_X_POSITIONS[activeBuoy.id] ?? 270

  const spawnRipple = (xPct: number, yPct: number) => {
    const id = rippleSeqRef.current++
    setRipples((prev) => [...prev.slice(-4), { id, x: xPct, y: yPct }])
    setFeedCount((prev) => {
      const next = prev + 1
      setWhisperKey(POND_FEED_WHISPERS[next % POND_FEED_WHISPERS.length])
      return next
    })
    setKoiBoosted(true)
  }

  const handleFeedButtonClick = () => {
    const presetSpots = [
      { x: 46, y: 44 },
      { x: 64, y: 38 },
      { x: 34, y: 54 },
      { x: 52, y: 60 },
    ]
    const spot = presetSpots[feedCount % presetSpots.length]
    spawnRipple(spot.x, spot.y)
  }

  const handlePondSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = pondRef.current
    if (!el) {
      handleFeedButtonClick()
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      handleFeedButtonClick()
      return
    }
    const xPct = Math.min(
      88,
      Math.max(12, ((event.clientX - rect.left) / rect.width) * 100)
    )
    const yPct = Math.min(
      82,
      Math.max(18, ((event.clientY - rect.top) / rect.height) * 100)
    )
    spawnRipple(xPct, yPct)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = tankRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const xPct = ((event.clientX - rect.left) / rect.width) * 100
    const yPct = ((event.clientY - rect.top) / rect.height) * 100
    el.style.setProperty('--mx', `${xPct.toFixed(1)}%`)
    el.style.setProperty('--my', `${yPct.toFixed(1)}%`)
  }

  const handleSelectProtocol = (protocolId: ProtocolId) => {
    setInternalProtocolId(protocolId)
    props.onProtocolChange?.(protocolId)
    const preset = TIDAL_PROTOCOLS.find((item) => item.id === protocolId)
    if (preset) {
      if (stormActive && preset.defaultNodeId === 'openai') {
        setSelectedBuoyId('claude')
      } else {
        setSelectedBuoyId(preset.defaultNodeId)
      }
    }
  }

  const handleSelectBuoy = (buoyId: string) => {
    if (stormActive && buoyId === 'openai') {
      setStormActive(false)
    }
    setSelectedBuoyId(buoyId)
  }

  const handleToggleStorm = () => {
    setStormActive((prev) => {
      const next = !prev
      if (next && selectedBuoyId === 'openai') {
        setSelectedBuoyId('claude')
      }
      return next
    })
  }

  let headerBannerText = t('Engine Humming Above · Unwind Below')
  if (stormActive) {
    headerBannerText = t('Upstream 429 Absorbed · Pond Undisturbed')
  } else if (props.mood === 'loaf') {
    headerBannerText = t('Loafing Sanctuary On · AI Running the Shift')
  }

  let beaconColorClass = 'bg-emerald-500'
  if (stormActive) {
    beaconColorClass = 'bg-amber-500'
  } else if (props.mood === 'loaf') {
    beaconColorClass = 'bg-teal-400'
  }

  return (
    <div
      ref={tankRef}
      onPointerMove={handlePointerMove}
      className={cn(
        'tidal-aquarium-chassis overflow-hidden rounded-2xl',
        props.className
      )}
    >
      {/* Top Observatory Bezel */}
      <div className='tidal-hairline-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5'>
        <div className='flex items-center gap-2.5'>
          <span className='relative flex size-2.5 items-center justify-center'>
            <span
              className={cn(
                'tidal-beacon-ping absolute inline-flex size-full rounded-full',
                beaconColorClass
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-2 rounded-full',
                beaconColorClass
              )}
            />
          </span>
          <span className='text-xs font-medium tracking-wide'>
            {headerBannerText}
          </span>
        </div>

        <div className='flex flex-wrap items-center gap-1.5'>
          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={handleFeedButtonClick}
            className='rounded-full border-[var(--tidal-gold)]/35 bg-[var(--tidal-gold-soft)] font-mono text-[11px] text-amber-800 hover:bg-[var(--tidal-gold)]/20 dark:text-amber-300'
          >
            <Sparkles aria-hidden='true' className='size-3' />
            {t('Feed Koi')}
            {feedCount > 0 && (
              <span className='ml-0.5 tabular-nums'>
                {' · '}
                {formatNumber(feedCount, locale)}
              </span>
            )}
          </Button>

          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={handleToggleStorm}
            aria-pressed={stormActive}
            className={cn(
              'rounded-full font-mono text-[11px] transition-colors',
              stormActive
                ? 'border-amber-500/45 bg-amber-500/12 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300'
                : 'border-border/80 bg-background/70 hover:bg-muted/80'
            )}
          >
            {stormActive ? (
              <>
                <Sun aria-hidden='true' className='size-3' />
                {t('Restore Calm')}
              </>
            ) : (
              <>
                <CloudLightning aria-hidden='true' className='size-3' />
                {t('Simulate 429 Storm')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* =====================================================================
       * UPPER STRATUM: ABOVE WATERLINE — AUTONOMOUS AI WORK DECK
       * ===================================================================== */}
      <div className='tidal-sky-deck relative px-4 pt-3.5 pb-5 sm:px-5'>
        <div className='mb-3 flex items-center justify-between gap-2 font-mono text-[10px] tracking-[0.15em] uppercase'>
          <span className='text-muted-foreground'>
            {t('Above Water · AI Work Deck')}
          </span>
          <span className='text-emerald-700 dark:text-emerald-400'>
            {stormActive
              ? t('Auto-Failover Shield Engaged')
              : t('Zero Manual Babysitting')}
          </span>
        </div>

        {/* Animated Signal Arc SVG connecting Gateway -> Active Buoy */}
        <svg
          aria-hidden='true'
          viewBox='0 0 800 54'
          preserveAspectRatio='none'
          className='pointer-events-none mb-1 hidden h-8 w-full sm:block'
        >
          <path
            d='M 90 48 L 710 48'
            stroke='currentColor'
            strokeOpacity='0.08'
            strokeDasharray='3 6'
          />
          {stormActive && (
            <path
              d='M 92 48 Q 180 6 270 46'
              fill='none'
              stroke='#f59e0b'
              strokeWidth='1.6'
              strokeDasharray='4 5'
              strokeOpacity='0.65'
            />
          )}
          <path
            d={`M 92 48 Q ${(92 + targetX) / 2} 4 ${targetX} 46`}
            fill='none'
            stroke={activeAccent}
            strokeOpacity='0.3'
            strokeWidth='2'
          />
          <path
            d={`M 92 48 Q ${(92 + targetX) / 2} 4 ${targetX} 46`}
            fill='none'
            stroke={activeAccent}
            strokeWidth='2.8'
            strokeLinecap='round'
            className='tidal-route-stream'
          />
        </svg>

        {/* Gateway Origin + 4 Interactive Upstream Buoys */}
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
          <div className='border-border/75 bg-background/90 col-span-2 flex items-center justify-between rounded-xl border px-3 py-2 shadow-2xs sm:col-span-1 dark:bg-[#0d1826]'>
            <div className='min-w-0'>
              <div className='text-muted-foreground font-mono text-[9px] tracking-wider uppercase'>
                {t('Ingress')}
              </div>
              <div className='truncate font-mono text-xs font-semibold'>
                {activeProtocol.shortLabel}
              </div>
            </div>
            <Waves
              aria-hidden='true'
              className='size-3.5 shrink-0 text-[var(--tidal-jade)]'
            />
          </div>

          <div
            role='group'
            aria-label={t('Upstream provider routes')}
            className='col-span-2 grid grid-cols-2 gap-2 sm:col-span-4 sm:grid-cols-4'
          >
            {TIDAL_UPSTREAMS.map((buoy) => {
              const isSelected = buoy.id === activeBuoy.id
              const isDegraded = stormActive && buoy.id === 'openai'
              const accent = isDark ? buoy.accentDark : buoy.accentLight

              return (
                <button
                  key={buoy.id}
                  type='button'
                  aria-pressed={isSelected}
                  onClick={() => handleSelectBuoy(buoy.id)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isDegraded &&
                      'border-amber-500/45 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                    !isDegraded &&
                      isSelected &&
                      'bg-background dark:bg-[#132235] shadow-xs',
                    !isDegraded &&
                      !isSelected &&
                      'border-border/60 bg-background/60 text-muted-foreground hover:bg-background/90 hover:text-foreground dark:bg-[#0d1826]/70'
                  )}
                  style={
                    isSelected && !isDegraded
                      ? {
                          borderColor: `${accent}80`,
                          boxShadow: `0 6px 18px -10px ${accent}95`,
                        }
                      : undefined
                  }
                >
                  <span className='flex min-w-0 items-center gap-1.5'>
                    <span
                      aria-hidden='true'
                      className='flex size-4 shrink-0 items-center justify-center'
                    >
                      {getLobeIcon(buoy.iconKey, 15)}
                    </span>
                    <span className='truncate text-xs font-medium'>
                      {buoy.name}
                    </span>
                  </span>
                  {isDegraded ? (
                    <AlertTriangle
                      aria-hidden='true'
                      className='size-3.5 shrink-0 text-amber-500'
                    />
                  ) : (
                    <span
                      aria-hidden='true'
                      className='size-1.5 shrink-0 rounded-full'
                      style={{
                        backgroundColor: accent,
                        opacity: isSelected ? 1 : 0.35,
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* =====================================================================
       * LOWER STRATUM: BELOW WATERLINE — SERENE KOI LOAFING SANCTUARY
       * ===================================================================== */}
      <div
        ref={pondRef}
        onClick={handlePondSurfaceClick}
        className='tidal-pond-chamber relative h-[268px] w-full cursor-pointer overflow-hidden select-none sm:h-[304px]'
      >
        {/* Animated Dual-Layer Sine-Wave Waterline Crest */}
        <svg
          aria-hidden='true'
          viewBox='0 0 840 30'
          preserveAspectRatio='none'
          className='pointer-events-none absolute inset-x-0 -top-px -left-[4%] z-20 h-6 w-[108%]'
        >
          <path
            d='M 0 0 L 840 0 L 840 12 Q 735 28 630 13 T 420 14 T 210 12 T 0 15 Z'
            fill={isDark ? '#09131f' : '#f1f8f6'}
            className='tidal-wave-back'
          />
          <path
            d='M 0 14 Q 105 2 210 14 T 420 14 T 630 14 T 840 14'
            fill='none'
            stroke={isDark ? '#2dd4bf' : '#0a8770'}
            strokeOpacity={isDark ? '0.58' : '0.36'}
            strokeWidth='1.8'
            className='tidal-wave-front'
          />
        </svg>

        {/* Pebbled Caustic Pond Floor */}
        <div
          aria-hidden='true'
          className='tidal-pond-bed pointer-events-none absolute inset-0'
        />

        {/* Slanted Tyndall Sunbeams / Moonlight Rays */}
        <div
          aria-hidden='true'
          className='tidal-sunbeam absolute -top-4 left-[18%] h-[120%] w-24 sm:w-32'
        />
        <div
          aria-hidden='true'
          className='tidal-sunbeam tidal-sunbeam-delayed absolute -top-4 left-[58%] h-[115%] w-20 sm:w-28'
        />

        {/* Floating Celadon Lotus Pads & Swaying Sea-Grass */}
        <svg
          aria-hidden='true'
          viewBox='0 0 600 300'
          preserveAspectRatio='none'
          className='pointer-events-none absolute inset-0 size-full'
        >
          {/* Top-right Lotus Pad */}
          <g opacity={isDark ? '0.26' : '0.42'}>
            <path
              d='M 548 56 A 38 34 0 1 1 538 34 L 520 56 Z'
              fill={isDark ? '#115e59' : '#6dc5b3'}
            />
            <circle cx='522' cy='56' r='3' fill='#fef3c7' fillOpacity='0.75' />
          </g>
          {/* Bottom-left Lotus Pad */}
          <g opacity={isDark ? '0.24' : '0.38'}>
            <path
              d='M 64 252 A 44 38 0 1 1 82 222 L 46 244 Z'
              fill={isDark ? '#134e4a' : '#7acbb9'}
            />
          </g>
          {/* Swaying Bottom Aquatic Grass */}
          <g
            className='tidal-kelp-sway'
            stroke={isDark ? '#2dd4bf' : '#0d9488'}
            strokeOpacity={isDark ? '0.28' : '0.32'}
            strokeWidth='3'
            strokeLinecap='round'
          >
            <path d='M 548 302 Q 536 258 552 224' />
            <path d='M 564 302 Q 554 268 568 238' />
            <path d='M 34 302 Q 44 266 28 236' />
          </g>

          {/* Rising Bioluminescent Micro-Bubbles */}
          <circle
            cx='172'
            cy='220'
            r='3.2'
            fill='#ffffff'
            fillOpacity='0.55'
            className='tidal-bubble'
          />
          <circle
            cx='432'
            cy='238'
            r='2.5'
            fill='#ffffff'
            fillOpacity='0.5'
            className='tidal-bubble tidal-bubble-slow'
          />
          <circle
            cx='318'
            cy='248'
            r='3.6'
            fill='#fef08a'
            fillOpacity='0.52'
            className='tidal-bubble'
          />
        </svg>

        {/* Top Underwater Micro-Bar */}
        <div className='pointer-events-none relative z-20 flex items-center justify-between gap-2 px-4 pt-6 sm:px-5'>
          <span className='bg-background/65 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-teal-950 backdrop-blur-md dark:bg-[#071522]/75 dark:text-teal-200'>
            {t('Below Water · Click Pond to Feed Koi')}
          </span>

          {stormActive && (
            <span className='rounded-full border border-emerald-500/35 bg-emerald-500/18 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-950 backdrop-blur-md dark:text-emerald-200'>
              {t('Storms Above · Pure Zen Below')}
            </span>
          )}
        </div>

        {/* 4 Interactive Ornamental Spirit Koi */}
        {KOI_SPIRITS.map((spec) => (
          <OrnamentalKoi
            key={spec.id}
            spec={spec}
            boosted={koiBoosted || props.mood === 'loaf'}
            onSelectKoi={(picked) => {
              setWhisperKey(picked.whisperKey)
              setFeedCount((c) => c + 1)
              setKoiBoosted(true)
            }}
          />
        ))}

        {/* Click-Spawned Golden Treat Pellets & Expanding Concentric Ripples */}
        {ripples.map((ripple) => (
          <div
            key={ripple.id}
            aria-hidden='true'
            style={{ left: `${ripple.x}%`, top: `${ripple.y}%` }}
            className='pointer-events-none absolute z-20'
          >
            <span className='tidal-ripple-ring absolute size-16 rounded-full border-2 border-amber-300/85 dark:border-teal-300/80' />
            <span className='tidal-ripple-ring-outer absolute size-24 rounded-full border border-white/70 dark:border-amber-300/55' />
            <span className='tidal-pellet-drop absolute size-2.5 rounded-full bg-amber-400 shadow-[0_0_12px_#fbbf24]' />
          </div>
        ))}

        {/* Bottom Floating Frosted Zen Whisper Bar */}
        <div className='pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-center justify-between gap-2 rounded-xl border border-white/45 bg-white/72 px-3.5 py-2 text-xs text-slate-800 shadow-xs backdrop-blur-md sm:inset-x-4 dark:border-teal-200/15 dark:bg-[#06121e]/78 dark:text-slate-100'>
          <span className='truncate'>{t(whisperKey)}</span>
          <span className='hidden shrink-0 font-mono text-[10px] text-teal-800 sm:inline dark:text-teal-300'>
            {t('Hover or click a koi')}
          </span>
        </div>
      </div>

      {/* Protocol Switcher & Live Telemetry Footer */}
      <div className='tidal-hairline-border flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 sm:px-5'>
        <span className='text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase'>
          {t('Wire Protocol')}
        </span>
        <div
          role='group'
          aria-label={t('Select ingress protocol')}
          className='flex flex-wrap items-center gap-1'
        >
          {TIDAL_PROTOCOLS.map((protocol) => {
            const active = protocol.id === activeProtocol.id
            return (
              <button
                key={protocol.id}
                type='button'
                onClick={() => handleSelectProtocol(protocol.id)}
                aria-pressed={active}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-foreground text-background shadow-2xs'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                {protocol.shortLabel}
              </button>
            )
          })}
        </div>
      </div>

      <div className='tidal-hairline-border bg-muted/25 grid grid-cols-1 divide-y border-t text-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:bg-white/[0.02]'>
        <div className='px-4 py-3'>
          <div className='text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase'>
            {t('Endpoint')}
          </div>
          <code className='mt-1 block truncate font-mono text-[11px] font-medium'>
            POST {activeProtocol.endpoint}
          </code>
        </div>
        <div className='px-4 py-3'>
          <div className='text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase'>
            {t('On-Duty Upstream')}
          </div>
          <div className='mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] font-medium'>
            <span
              className='size-1.5 shrink-0 rounded-full'
              style={{ backgroundColor: activeAccent }}
            />
            <span className='truncate'>
              {activeBuoy.name} · {activeBuoy.sampleModel}
            </span>
          </div>
        </div>
        <div className='px-4 py-3'>
          <div className='text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase'>
            {t('Peace of Mind')}
          </div>
          <div className='mt-1 font-mono text-[11px] leading-snug font-medium'>
            {stormActive ? (
              <span className='text-amber-700 dark:text-amber-400'>
                {t('429 Bypassed → Backup Smooth')}
              </span>
            ) : (
              <span className='text-emerald-700 dark:text-emerald-400'>
                {t(activeBuoy.dutyKey)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
