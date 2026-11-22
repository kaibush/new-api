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
  Compass,
  Orbit,
  Radio,
  Rocket,
  RotateCcw,
  Sparkles,
  Sun,
  Telescope,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  COSMIC_LANDMARKS,
  COSMIC_RADIO_WHISPERS,
  TIDAL_PROTOCOLS,
  TIDAL_UPSTREAMS,
  type CosmicLandmarkSpec,
  type HomeMood,
  type ProtocolId,
  type TidalUpstreamBuoy,
} from '../constants'
import {
  COSMIC_CAMERA_PRESETS,
  COSMIC_CAM_DIST_MAX,
  COSMIC_CAM_DIST_MIN,
  computeCosmicViewBlends,
  createCosmicUniverseField,
  renderCosmicSingularityFrame,
  resolveCosmicCameraView,
  type CosmicCameraView,
} from '../lib/cosmic-singularity-engine'

interface CosmicSingularityStageProps {
  className?: string
  mood: HomeMood
  selectedProtocolId?: ProtocolId
  onProtocolChange?: (id: ProtocolId) => void
}

interface ShockwaveBurst {
  id: number
  x: number
  y: number
}

const DEFAULT_YAW = 0.08
const DEFAULT_PITCH = 0.31
const FLIGHT_DURATION_SEC = 2.4

const CAMERA_VIEW_OPTIONS: readonly {
  id: CosmicCameraView
  labelKey: string
  captionKey: string
  whisperKey: string
  icon: typeof Orbit
}[] = [
  {
    id: 'cabin',
    labelKey: 'Inside the Pod',
    captionKey: 'Zero-G cabin · tea floating · the singularity works outside',
    whisperKey:
      'Pod Cabin: Tea floats past the canopy while the singularity relays every request outside.',
    icon: Rocket,
  },
  {
    id: 'orbit',
    labelKey: 'Orbit View',
    captionKey: '1.7m Human · Drag to Orbit 3D',
    whisperKey:
      'Across 93 billion light-years of cosmos, your busywork is a single photon—let the gateway carry it.',
    icon: Orbit,
  },
  {
    id: 'galaxy',
    labelKey: 'Galaxy Scale',
    captionKey: '100,000 LY spiral · your pod is one pixel',
    whisperKey:
      'Galaxy Scale: Four spiral arms, one blinking pixel of you—the routes still settle themselves.',
    icon: Telescope,
  },
]

function clampPitch(value: number): number {
  return Math.max(-0.58, Math.min(1.2, value))
}

function CosmicLandmarkBeacon(props: {
  spec: CosmicLandmarkSpec
  selected: boolean
  boosted: boolean
  onSelect: (spec: CosmicLandmarkSpec) => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  const spec = props.spec
  const active = hovered || focused || props.selected || props.boosted

  return (
    <button
      type='button'
      aria-label={t(spec.labelKey)}
      aria-pressed={props.selected}
      data-orbiting={active}
      style={{ left: spec.left, top: spec.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(event) => {
        event.stopPropagation()
        props.onSelect(spec)
      }}
      className={cn(
        'cosmic-landmark-btn group z-20 flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-left backdrop-blur-md transition-all duration-300 select-none outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        spec.isHumanObserver
          ? 'border-emerald-300/45 bg-emerald-950/70 text-emerald-100 shadow-[0_0_24px_rgba(52,211,153,0.28)] hover:border-emerald-300/80'
          : 'border-sky-200/20 bg-slate-950/62 text-slate-200 hover:border-sky-300/55 hover:bg-slate-900/80',
        props.selected &&
          'border-amber-300/75 bg-slate-900/88 text-amber-100 shadow-[0_0_26px_rgba(251,191,36,0.32)]'
      )}
    >
      <span className='relative flex size-2 shrink-0 items-center justify-center'>
        <span
          aria-hidden='true'
          className='cosmic-beacon-ping absolute inline-flex size-full rounded-full'
          style={{ backgroundColor: spec.accentColor }}
        />
        <span
          aria-hidden='true'
          className='relative inline-flex size-1.5 rounded-full'
          style={{ backgroundColor: spec.accentColor }}
        />
      </span>
      <span className='font-mono text-[10px] tracking-wider text-sky-200/75 uppercase'>
        {spec.code}
      </span>
      <span className='hidden text-[11px] font-medium sm:inline'>
        {t(spec.shortTagKey)}
      </span>
    </button>
  )
}

export function CosmicSingularityStage(props: CosmicSingularityStageProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const chassisRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const burstSeqRef = useRef(1)

  const universeField = useMemo(() => createCosmicUniverseField(), [])

  const [internalProtocolId, setInternalProtocolId] =
    useState<ProtocolId>('openai-chat')
  const [selectedBuoyId, setSelectedBuoyId] = useState<string>('openai')
  const [stormActive, setStormActive] = useState(false)
  const [pulseCount, setPulseCount] = useState(0)
  const [warpBoosted, setWarpBoosted] = useState(false)
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(
    null
  )
  const [whisperKey, setWhisperKey] = useState<string>(
    COSMIC_RADIO_WHISPERS[0] ?? ''
  )
  const [bursts, setBursts] = useState<ShockwaveBurst[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [hasCustomOrbit, setHasCustomOrbit] = useState(false)
  const [attitudeReadout, setAttitudeReadout] = useState({
    pitchDeg: 18,
    yawDeg: 5,
  })
  const [cameraView, setCameraView] = useState<CosmicCameraView>('orbit')
  const [inFlight, setInFlight] = useState(false)

  const simRef = useRef({
    yaw: DEFAULT_YAW,
    pitch: DEFAULT_PITCH,
    targetYaw: DEFAULT_YAW,
    targetPitch: DEFAULT_PITCH,
    warpEnergy: 0,
    pointerNormX: 0.5,
    pointerNormY: 0.5,
    pointerInside: false,
    pulseStartTimes: [] as number[],
    dragActive: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginYaw: DEFAULT_YAW,
    dragOriginPitch: DEFAULT_PITCH,
    dragMoved: false,
    camDist: COSMIC_CAMERA_PRESETS.orbit.camDist,
    targetCamDist: COSMIC_CAMERA_PRESETS.orbit.camDist,
    flightFrom: COSMIC_CAMERA_PRESETS.orbit.camDist,
    flightTo: COSMIC_CAMERA_PRESETS.orbit.camDist,
    flightStartSec: -1,
    lastViewId: 'orbit' as CosmicCameraView,
  })
  const hereLabel = t('You are here')

  const activeProtocolId = props.selectedProtocolId ?? internalProtocolId
  const activeProtocol =
    TIDAL_PROTOCOLS.find((item) => item.id === activeProtocolId) ??
    TIDAL_PROTOCOLS[0]

  const effectiveBuoyId =
    stormActive && selectedBuoyId === 'openai' ? 'claude' : selectedBuoyId
  const activeBuoy: TidalUpstreamBuoy =
    TIDAL_UPSTREAMS.find((item) => item.id === effectiveBuoyId) ??
    TIDAL_UPSTREAMS[0]
  const activeAccent = activeBuoy.accentDark

  useEffect(() => {
    if (!warpBoosted) return
    const timer = window.setTimeout(() => setWarpBoosted(false), 1600)
    return () => window.clearTimeout(timer)
  }, [warpBoosted, pulseCount])

  useEffect(() => {
    if (hasCustomOrbit || cameraView !== 'orbit') return
    const nextPitch = props.mood === 'loaf' ? 0.23 : DEFAULT_PITCH
    const nextYaw = props.mood === 'loaf' ? 0.22 : DEFAULT_YAW
    simRef.current.targetPitch = nextPitch
    simRef.current.targetYaw = nextYaw
  }, [props.mood, hasCustomOrbit, cameraView])

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return

    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      ctx = null
    }
    if (!ctx) return

    let width = Math.max(viewport.clientWidth, 320)
    let height = Math.max(viewport.clientHeight, 260)

    const syncCanvasSize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(viewport.clientWidth, 320)
      height = Math.max(viewport.clientHeight, 260)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    syncCanvasSize()
    const resizeObserver = new ResizeObserver(() => {
      syncCanvasSize()
    })
    resizeObserver.observe(viewport)

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    if (reducedMotion) {
      renderCosmicSingularityFrame(ctx, universeField, {
        width,
        height,
        timeSec: 12.4,
        yaw: simRef.current.targetYaw,
        pitch: simRef.current.targetPitch,
        mood: props.mood,
        stormActive,
        warpEnergy: 0,
        activeRelayId: activeBuoy.id,
        activeAccent,
        pointerNormX: 0.5,
        pointerNormY: 0.5,
        pointerInside: false,
        pulseWaves: [],
        camDist: simRef.current.targetCamDist,
        ...computeCosmicViewBlends(simRef.current.targetCamDist),
        hereLabel,
      })
      return () => {
        resizeObserver.disconnect()
      }
    }

    let frameId = 0
    let lastHudSyncMs = 0

    const renderLoop = (nowMs: number): void => {
      // Shared absolute clock so flight/pulse timestamps survive effect restarts
      const timeSec = nowMs / 1000
      const sim = simRef.current

      // Gentle cosmic drift when not actively dragging
      const idleYawDrift = sim.dragActive ? 0 : Math.sin(timeSec * 0.19) * 0.035
      const desiredYaw = sim.targetYaw + idleYawDrift
      sim.yaw += (desiredYaw - sim.yaw) * 0.09
      sim.pitch += (sim.targetPitch - sim.pitch) * 0.09
      sim.warpEnergy *= 0.94

      // Cinematic fly-through: eased dolly with a hyperspace warp spike mid-flight
      if (sim.flightStartSec >= 0) {
        const progress = Math.min(
          1,
          (timeSec - sim.flightStartSec) / FLIGHT_DURATION_SEC
        )
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
        const logFrom = Math.log(sim.flightFrom)
        const logTo = Math.log(sim.flightTo)
        sim.camDist = Math.exp(logFrom + (logTo - logFrom) * eased)
        sim.warpEnergy = Math.max(
          sim.warpEnergy,
          Math.sin(progress * Math.PI) * 1.35
        )
        if (progress >= 1) {
          sim.flightStartSec = -1
          sim.targetCamDist = sim.flightTo
          setInFlight(false)
        }
      } else {
        sim.camDist += (sim.targetCamDist - sim.camDist) * 0.12
      }

      const liveView = resolveCosmicCameraView(sim.camDist)
      if (liveView !== sim.lastViewId) {
        sim.lastViewId = liveView
        setCameraView(liveView)
      }

      const activeWaves: number[] = []
      const keptStarts: number[] = []
      for (const startSec of sim.pulseStartTimes) {
        const age = (timeSec - startSec) / 1.85
        if (age >= 0 && age < 1) {
          activeWaves.push(age)
          keptStarts.push(startSec)
        }
      }
      sim.pulseStartTimes = keptStarts

      renderCosmicSingularityFrame(ctx, universeField, {
        width,
        height,
        timeSec,
        yaw: sim.yaw,
        pitch: sim.pitch,
        mood: props.mood,
        stormActive,
        warpEnergy: sim.warpEnergy,
        activeRelayId: activeBuoy.id,
        activeAccent,
        pointerNormX: sim.pointerNormX,
        pointerNormY: sim.pointerNormY,
        pointerInside: sim.pointerInside,
        pulseWaves: activeWaves,
        camDist: sim.camDist,
        ...computeCosmicViewBlends(sim.camDist),
        hereLabel,
      })

      if (viewportRef.current) {
        const rxDeg = (-sim.pitch * 36).toFixed(2)
        const ryDeg = (sim.yaw * 28).toFixed(2)
        viewportRef.current.style.setProperty('--cam-rx', `${rxDeg}deg`)
        viewportRef.current.style.setProperty('--cam-ry', `${ryDeg}deg`)
      }

      if (nowMs - lastHudSyncMs > 180) {
        lastHudSyncMs = nowMs
        const pDeg = Math.round((sim.pitch * 180) / Math.PI)
        const yDeg = ((Math.round((sim.yaw * 180) / Math.PI) % 360) + 360) % 360
        setAttitudeReadout((prev) => {
          if (prev.pitchDeg === pDeg && prev.yawDeg === yDeg) return prev
          return { pitchDeg: pDeg, yawDeg: yDeg }
        })
      }

      frameId = window.requestAnimationFrame(renderLoop)
    }

    frameId = window.requestAnimationFrame(renderLoop)
    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [
    universeField,
    props.mood,
    stormActive,
    activeBuoy.id,
    activeAccent,
    hereLabel,
  ])

  // Google-Earth style wheel zoom; at either end the page scrolls normally
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent): void => {
      const sim = simRef.current
      const zoomingIn = event.deltaY < 0
      const atLimit = zoomingIn
        ? sim.targetCamDist <= COSMIC_CAM_DIST_MIN + 0.01
        : sim.targetCamDist >= COSMIC_CAM_DIST_MAX - 0.01
      if (sim.flightStartSec >= 0) {
        event.preventDefault()
        return
      }
      if (atLimit) return
      event.preventDefault()
      const factor = Math.exp(
        Math.max(-60, Math.min(60, event.deltaY)) * 0.0042
      )
      sim.targetCamDist = Math.max(
        COSMIC_CAM_DIST_MIN,
        Math.min(COSMIC_CAM_DIST_MAX, sim.targetCamDist * factor)
      )
      sim.warpEnergy = Math.max(sim.warpEnergy, 0.35)
      setHasCustomOrbit(true)
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  const flyToView = (view: CosmicCameraView): void => {
    const sim = simRef.current
    const preset = COSMIC_CAMERA_PRESETS[view]
    sim.flightFrom = sim.camDist
    sim.flightTo = preset.camDist
    sim.flightStartSec = performance.now() / 1000
    sim.targetYaw = preset.yaw
    sim.targetPitch = preset.pitch
    setCameraView(view)
    sim.lastViewId = view
    setInFlight(true)
    setSelectedLandmarkId(null)
    setHasCustomOrbit(view !== 'orbit')
    const option = CAMERA_VIEW_OPTIONS.find((item) => item.id === view)
    if (option) setWhisperKey(option.whisperKey)
  }

  const triggerCosmicPulse = (
    xPct: number,
    yPct: number,
    customWhisper?: string
  ): void => {
    const id = burstSeqRef.current++
    setBursts((prev) => [...prev.slice(-4), { id, x: xPct, y: yPct }])
    simRef.current.warpEnergy = 1.05
    const nowSec = performance.now() / 1000
    simRef.current.pulseStartTimes = [
      ...simRef.current.pulseStartTimes.slice(-3),
      nowSec,
    ]
    setPulseCount((prev) => {
      const next = prev + 1
      if (customWhisper) {
        setWhisperKey(customWhisper)
      } else {
        const fallback =
          COSMIC_RADIO_WHISPERS[next % COSMIC_RADIO_WHISPERS.length] ?? ''
        setWhisperKey(fallback)
      }
      return next
    })
    setWarpBoosted(true)
  }

  const handlePulseButtonClick = (): void => {
    const spots = [
      { x: 41, y: 50 },
      { x: 76, y: 60 },
      { x: 56, y: 26 },
      { x: 24, y: 58 },
    ]
    const picked = spots[pulseCount % spots.length] ?? { x: 41, y: 50 }
    triggerCosmicPulse(picked.x, picked.y)
  }

  const handleResetOrbit = (): void => {
    const orbitDrift = Math.abs(
      simRef.current.camDist - COSMIC_CAMERA_PRESETS.orbit.camDist
    )
    if (cameraView !== 'orbit' || orbitDrift > 0.4) {
      flyToView('orbit')
    }
    const resetPitch = props.mood === 'loaf' ? 0.23 : DEFAULT_PITCH
    const resetYaw = props.mood === 'loaf' ? 0.22 : DEFAULT_YAW
    simRef.current.targetYaw = resetYaw
    simRef.current.targetPitch = resetPitch
    setHasCustomOrbit(false)
    setSelectedLandmarkId(null)
  }

  const handleViewportPointerDown = (
    event: PointerEvent<HTMLDivElement>
  ): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events in test environments may omit active pointer registration.
    }
    simRef.current.dragActive = true
    simRef.current.dragMoved = false
    simRef.current.dragStartX = event.clientX
    simRef.current.dragStartY = event.clientY
    simRef.current.dragOriginYaw = simRef.current.targetYaw
    simRef.current.dragOriginPitch = simRef.current.targetPitch
    setIsDragging(true)
  }

  const handleViewportPointerMove = (
    event: PointerEvent<HTMLDivElement>
  ): void => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const nx = (event.clientX - rect.left) / rect.width
      const ny = (event.clientY - rect.top) / rect.height
      simRef.current.pointerNormX = nx
      simRef.current.pointerNormY = ny
      simRef.current.pointerInside = true
      chassisRef.current?.style.setProperty('--mx', `${(nx * 100).toFixed(1)}%`)
      chassisRef.current?.style.setProperty('--my', `${(ny * 100).toFixed(1)}%`)
    }

    if (!simRef.current.dragActive) return
    const dx = event.clientX - simRef.current.dragStartX
    const dy = event.clientY - simRef.current.dragStartY
    if (Math.hypot(dx, dy) > 6) {
      simRef.current.dragMoved = true
      setHasCustomOrbit(true)
    }
    simRef.current.targetYaw = simRef.current.dragOriginYaw + dx * 0.0062
    simRef.current.targetPitch = clampPitch(
      simRef.current.dragOriginPitch + dy * 0.0048
    )
  }

  const handleViewportPointerEnd = (
    event: PointerEvent<HTMLDivElement>
  ): void => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore synthetic pointer capture release errors.
    }
    simRef.current.dragActive = false
    setIsDragging(false)
  }

  const handleViewportPointerLeave = (): void => {
    simRef.current.dragActive = false
    simRef.current.pointerInside = false
    setIsDragging(false)
  }

  const handleCosmosClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (simRef.current.dragMoved) {
      simRef.current.dragMoved = false
      return
    }
    const el = viewportRef.current
    if (!el) {
      handlePulseButtonClick()
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      handlePulseButtonClick()
      return
    }
    const xPct = Math.min(
      90,
      Math.max(10, ((event.clientX - rect.left) / rect.width) * 100)
    )
    const yPct = Math.min(
      85,
      Math.max(15, ((event.clientY - rect.top) / rect.height) * 100)
    )
    triggerCosmicPulse(xPct, yPct)
  }

  const handleSelectProtocol = (protocolId: ProtocolId): void => {
    setInternalProtocolId(protocolId)
    props.onProtocolChange?.(protocolId)
    simRef.current.warpEnergy = 0.72
    const preset = TIDAL_PROTOCOLS.find((item) => item.id === protocolId)
    if (preset) {
      if (stormActive && preset.defaultNodeId === 'openai') {
        setSelectedBuoyId('claude')
      } else {
        setSelectedBuoyId(preset.defaultNodeId)
      }
    }
  }

  const handleSelectBuoy = (buoyId: string): void => {
    if (stormActive && buoyId === 'openai') {
      setStormActive(false)
    }
    simRef.current.warpEnergy = 0.65
    setSelectedBuoyId(buoyId)
  }

  const handleToggleStorm = (): void => {
    simRef.current.warpEnergy = 0.95
    setStormActive((prev) => {
      const next = !prev
      if (next && selectedBuoyId === 'openai') {
        setSelectedBuoyId('claude')
      }
      return next
    })
  }

  const handleCosmosDoubleClick = (): void => {
    if (cameraView === 'galaxy') {
      flyToView('orbit')
      return
    }
    if (cameraView === 'orbit') flyToView('cabin')
  }

  const activeViewOption =
    CAMERA_VIEW_OPTIONS.find((option) => option.id === cameraView) ??
    CAMERA_VIEW_OPTIONS[1]

  let headerBannerText = t('Singularity Roaring · Tiny Speck Unwinding')
  if (stormActive) {
    headerBannerText = t('429 Solar Flare Deflected · Zero-G Pod Untouched')
  } else if (props.mood === 'loaf') {
    headerBannerText = t('Time Dilation On · AI Starfleet Running the Shift')
  }

  let beaconColorClass = 'bg-sky-400'
  if (stormActive) {
    beaconColorClass = 'bg-amber-400'
  } else if (props.mood === 'loaf') {
    beaconColorClass = 'bg-emerald-400'
  }

  return (
    <div
      ref={chassisRef}
      className={cn(
        'cosmic-observatory-chassis overflow-hidden rounded-3xl',
        props.className
      )}
    >
      {/* Top Deep-Space Mission Control Bezel */}
      <div className='cosmic-hud-divider flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-slate-100 sm:px-6'>
        <div className='flex flex-wrap items-center gap-2.5'>
          <span className='relative flex size-2.5 items-center justify-center'>
            <span
              className={cn(
                'cosmic-beacon-ping absolute inline-flex size-full rounded-full',
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
          <span className='text-xs font-medium tracking-wide text-slate-100'>
            {headerBannerText}
          </span>
          <span className='hidden rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 font-mono text-[10px] text-sky-200/85 md:inline-flex md:items-center md:gap-1'>
            <Compass aria-hidden='true' className='size-3' />
            {attitudeReadout.pitchDeg}° / {attitudeReadout.yawDeg}°
          </span>
        </div>

        <div className='flex flex-wrap items-center gap-1.5'>
          {hasCustomOrbit && (
            <Button
              type='button'
              variant='outline'
              size='xs'
              onClick={handleResetOrbit}
              className='rounded-full border-slate-400/30 bg-white/5 font-mono text-[11px] text-slate-200 hover:bg-white/12 hover:text-white'
            >
              <RotateCcw aria-hidden='true' className='size-3' />
              {t('Reset 3D View')}
            </Button>
          )}

          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={handlePulseButtonClick}
            className='rounded-full border-amber-400/40 bg-amber-400/14 font-mono text-[11px] text-amber-200 hover:bg-amber-400/24 hover:text-amber-100'
          >
            <Sparkles aria-hidden='true' className='size-3' />
            {t('Pulse Cosmos')}
            {pulseCount > 0 && (
              <span className='ml-0.5 tabular-nums'>
                {' · '}
                {formatNumber(pulseCount, locale)}
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
                ? 'border-rose-400/55 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 hover:text-white'
                : 'border-sky-300/25 bg-white/6 text-slate-200 hover:bg-white/14 hover:text-white'
            )}
          >
            {stormActive ? (
              <>
                <Sun aria-hidden='true' className='size-3' />
                {t('Restore Calm Orbit')}
              </>
            ) : (
              <>
                <CloudLightning aria-hidden='true' className='size-3' />
                {t('Simulate 429 Flare')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Upper Orbital Star-Gate Relay Strip */}
      <div className='cosmic-hud-divider bg-[#050915]/92 px-4 py-3 sm:px-6'>
        <div className='mb-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-[0.15em] uppercase'>
          <span className='text-slate-400'>
            {t('Event Horizon · Orbital AI Star-Gates')}
          </span>
          <span className='text-emerald-300'>
            {stormActive
              ? t('Magnetosphere Shield Engaged')
              : t('Zero Manual Babysitting')}
          </span>
        </div>

        <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
          <div className='col-span-2 flex items-center justify-between rounded-xl border border-sky-200/15 bg-slate-900/80 px-3 py-2 text-slate-100 sm:col-span-1'>
            <div className='min-w-0'>
              <div className='font-mono text-[9px] tracking-wider text-slate-400 uppercase'>
                {t('Ingress')}
              </div>
              <div className='truncate font-mono text-xs font-semibold text-white'>
                {activeProtocol.shortLabel}
              </div>
            </div>
            <Orbit
              aria-hidden='true'
              className='size-3.5 shrink-0 text-sky-400'
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
              const accent = buoy.accentDark

              return (
                <button
                  key={buoy.id}
                  type='button'
                  aria-pressed={isSelected}
                  onClick={() => handleSelectBuoy(buoy.id)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-1.5 rounded-xl border px-3 py-2 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                    isDegraded &&
                      'border-rose-400/50 bg-rose-500/14 text-rose-200',
                    !isDegraded &&
                      isSelected &&
                      'bg-slate-900/95 text-white shadow-xs',
                    !isDegraded &&
                      !isSelected &&
                      'border-white/10 bg-slate-900/45 text-slate-300 hover:border-white/25 hover:bg-slate-900/80 hover:text-white'
                  )}
                  style={
                    isSelected && !isDegraded
                      ? {
                          borderColor: `${accent}88`,
                          boxShadow: `0 8px 24px -12px ${accent}`,
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
                      className='size-3.5 shrink-0 text-rose-400'
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
       * PANORAMIC 21:9 3D COSMIC SINGULARITY × PALE BLUE DOT OBSERVATORY
       * ===================================================================== */}
      <div
        ref={viewportRef}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerEnd}
        onPointerCancel={handleViewportPointerEnd}
        onPointerLeave={handleViewportPointerLeave}
        onClick={handleCosmosClick}
        onDoubleClick={handleCosmosDoubleClick}
        data-dragging={isDragging}
        data-view={cameraView}
        data-flight={inFlight}
        className='cosmic-imax-viewport relative h-[350px] w-full overflow-hidden select-none sm:h-[430px] lg:h-[500px]'
      >
        <canvas
          ref={canvasRef}
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 size-full'
        />

        {/* True CSS 3D preserve-3d Holographic Astrolabe Horizon Rings */}
        <div
          aria-hidden='true'
          className='cosmic-gyro-scene pointer-events-none absolute inset-0 flex items-center justify-center'
        >
          <div className='cosmic-gyro-assembly relative size-[340px] sm:size-[460px] lg:size-[580px]'>
            <div className='cosmic-gyro-ring-primary absolute inset-0 rounded-full border border-sky-300/14' />
            <div className='cosmic-gyro-ring-secondary absolute inset-8 rounded-full border border-dashed border-amber-300/14' />
          </div>
        </div>

        {/* Top-Left Macroscopic Scale Contrast Telemetry */}
        <div className='pointer-events-none absolute top-3.5 right-3.5 left-3.5 z-20 flex flex-wrap items-start justify-between gap-2 sm:right-5 sm:left-5'>
          <div className='flex flex-col gap-2'>
            <div
              role='group'
              aria-label={t('Camera view')}
              className='pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/14 bg-slate-950/70 p-0.5 backdrop-blur-md'
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {CAMERA_VIEW_OPTIONS.map((option) => {
                const Icon = option.icon
                const active = option.id === cameraView
                return (
                  <button
                    key={option.id}
                    type='button'
                    aria-pressed={active}
                    onClick={() => flyToView(option.id)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium tracking-wide transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                      active
                        ? 'bg-sky-400 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    )}
                  >
                    <Icon aria-hidden='true' className='size-3' />
                    {t(option.labelKey)}
                  </button>
                )
              })}
            </div>
            <div className='rounded-xl border border-white/12 bg-slate-950/62 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-slate-200/90 uppercase backdrop-blur-md'>
              <span className='text-sky-300'>93B LY</span>
              <span className='mx-1.5 text-slate-500'>vs</span>
              <span className='text-amber-300'>
                {t(activeViewOption.captionKey)}
              </span>
            </div>
          </div>

          {stormActive && (
            <span className='rounded-full border border-emerald-400/35 bg-emerald-950/75 px-3 py-1 font-mono text-[10px] font-medium text-emerald-200 backdrop-blur-md'>
              {t('Flares Outside · Zero-G Peace Inside')}
            </span>
          )}
        </div>

        {/* 4 Interactive Accessible Deep-Space Scale Landmarks */}
        {inFlight && (
          <div
            aria-hidden='true'
            className='cosmic-flight-banner pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/40 bg-slate-950/70 px-4 py-1.5 font-mono text-[11px] tracking-[0.3em] text-sky-100 uppercase backdrop-blur-md'
          >
            {t('Warp Transit')}
          </div>
        )}

        {cameraView === 'orbit' &&
          !inFlight &&
          COSMIC_LANDMARKS.map((spec) => (
            <CosmicLandmarkBeacon
              key={spec.id}
              spec={spec}
              selected={selectedLandmarkId === spec.id}
              boosted={warpBoosted || props.mood === 'loaf'}
              onSelect={(picked) => {
                const isTogglingOff = selectedLandmarkId === picked.id
                setSelectedLandmarkId(isTogglingOff ? null : picked.id)
                simRef.current.targetYaw = picked.targetYaw
                simRef.current.targetPitch = picked.targetPitch
                setHasCustomOrbit(true)
                triggerCosmicPulse(
                  Number.parseFloat(picked.left) || 50,
                  Number.parseFloat(picked.top) || 50,
                  picked.whisperKey
                )
              }}
            />
          ))}

        {/* Click-Spawned Gravitational Wave Shockwave Reticles */}
        {bursts.map((burst) => (
          <div
            key={burst.id}
            aria-hidden='true'
            style={{ left: `${burst.x}%`, top: `${burst.y}%` }}
            className='pointer-events-none absolute z-20'
          >
            <span className='cosmic-shockwave-inner absolute size-20 rounded-full border border-sky-300/80' />
            <span className='cosmic-shockwave-outer absolute size-32 rounded-full border border-amber-300/55' />
            <span className='cosmic-photon-spark absolute size-2 rounded-full bg-amber-300 shadow-[0_0_16px_#fbbf24]' />
          </div>
        ))}

        {/* Bottom Deep-Space Loafing Radio Transmission Bar */}
        <div className='pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-xl border border-white/14 bg-slate-950/76 px-4 py-2.5 text-xs text-slate-100 shadow-lg backdrop-blur-md sm:inset-x-5'>
          <div className='flex min-w-0 items-center gap-2'>
            <Radio
              aria-hidden='true'
              className='size-3.5 shrink-0 text-amber-300'
            />
            <span className='truncate'>{t(whisperKey)}</span>
          </div>
          <span className='hidden shrink-0 font-mono text-[10px] text-sky-300/90 md:inline'>
            {t('Drag in 3D · Scroll to zoom · Double-click to dive')}
          </span>
        </div>
      </div>

      {/* Protocol Switcher & Live Deep-Space Telemetry Footer */}
      <div className='cosmic-hud-divider flex flex-wrap items-center justify-between gap-2 border-t bg-[#060b18] px-4 py-2.5 text-slate-200 sm:px-6'>
        <span className='font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase'>
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
                  'cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                  active
                    ? 'bg-sky-400 text-slate-950 shadow-2xs'
                    : 'text-slate-400 hover:bg-white/8 hover:text-white'
                )}
              >
                {protocol.shortLabel}
              </button>
            )
          })}
        </div>
      </div>

      <div className='cosmic-hud-divider grid grid-cols-1 divide-y border-t bg-[#040813] text-xs text-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
        <div className='px-4 py-3 sm:px-6'>
          <div className='font-mono text-[10px] tracking-[0.14em] text-slate-400 uppercase'>
            {t('Endpoint')}
          </div>
          <code className='mt-1 block truncate font-mono text-[11px] font-medium text-slate-100'>
            POST {activeProtocol.endpoint}
          </code>
        </div>
        <div className='px-4 py-3 sm:px-6'>
          <div className='font-mono text-[10px] tracking-[0.14em] text-slate-400 uppercase'>
            {t('On-Duty Star System')}
          </div>
          <div className='mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] font-medium text-slate-100'>
            <span
              className='size-1.5 shrink-0 rounded-full'
              style={{ backgroundColor: activeAccent }}
            />
            <span className='truncate'>
              {activeBuoy.name} · {activeBuoy.sampleModel}
            </span>
          </div>
        </div>
        <div className='px-4 py-3 sm:px-6'>
          <div className='font-mono text-[10px] tracking-[0.14em] text-slate-400 uppercase'>
            {t('Zero-G Peace of Mind')}
          </div>
          <div className='mt-1 font-mono text-[11px] leading-snug font-medium'>
            {stormActive ? (
              <span className='text-amber-300'>
                {t('429 Bypassed → Backup Smooth')}
              </span>
            ) : (
              <span className='text-emerald-300'>{t(activeBuoy.dutyKey)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
