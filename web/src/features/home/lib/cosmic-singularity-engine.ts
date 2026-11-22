import type { HomeMood } from '../constants'

export interface CosmicSceneInput {
  width: number
  height: number
  timeSec: number
  yaw: number
  pitch: number
  mood: HomeMood
  stormActive: boolean
  warpEnergy: number
  activeRelayId: string
  activeAccent: string
  pointerNormX: number
  pointerNormY: number
  pointerInside: boolean
  pulseWaves: readonly number[]
  /** Camera distance from the singularity in world units (cabin ≈ 3, orbit ≈ 6, galaxy ≈ 34). */
  camDist: number
  /** 0 → outside the pod, 1 → fully inside the cockpit looking through the canopy. */
  cabinBlend: number
  /** 0 → local singularity system, 1 → whole spiral galaxy macro view. */
  galaxyBlend: number
  /** Localized "you are here" tag drawn next to the Pale Blue Dot in macro views. */
  hereLabel: string
}

export type CosmicCameraView = 'cabin' | 'orbit' | 'galaxy'

export interface CosmicCameraPreset {
  camDist: number
  yaw: number
  pitch: number
}

export const COSMIC_CAMERA_PRESETS: Record<
  CosmicCameraView,
  CosmicCameraPreset
> = {
  cabin: { camDist: 3.15, yaw: -0.26, pitch: 0.21 },
  orbit: { camDist: 6.2, yaw: 0.08, pitch: 0.31 },
  galaxy: { camDist: 36, yaw: 0.34, pitch: 0.92 },
}

export const COSMIC_CAM_DIST_MIN = 2.6
export const COSMIC_CAM_DIST_MAX = 46

/** Resolves which named view a continuous camera distance belongs to. */
export function resolveCosmicCameraView(camDist: number): CosmicCameraView {
  if (camDist < 4.2) return 'cabin'
  if (camDist < 15) return 'orbit'
  return 'galaxy'
}

/** Smooth 0..1 blends derived from camera distance so zooming morphs the scene continuously. */
export function computeCosmicViewBlends(camDist: number): {
  cabinBlend: number
  galaxyBlend: number
} {
  const smooth = (edge0: number, edge1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }
  return {
    cabinBlend: 1 - smooth(3.3, 4.6, camDist),
    galaxyBlend: smooth(9, 26, camDist),
  }
}

export interface CosmicCameraLayout {
  width: number
  height: number
  minDim: number
  isCompact: boolean
  isLoaf: boolean
  simTime: number
  warp: number
  cabin: number
  galaxy: number
  outside: number
  local: number
  cx: number
  cy: number
  fov: number
  camDist: number
  refScale: number
  roll: number
  rsWorld: number
  horizonScreenR: number
}

export function computeCosmicCameraLayout(
  input: CosmicSceneInput
): CosmicCameraLayout {
  const { width, height, timeSec } = input
  const isLoaf = input.mood === 'loaf'
  const speedFactor = isLoaf ? 0.56 : 1.04
  const warp = Math.max(0, Math.min(1.5, input.warpEnergy))
  const simTime = timeSec * speedFactor

  const cabin = Math.max(0, Math.min(1, input.cabinBlend))
  const galaxy = Math.max(0, Math.min(1, input.galaxyBlend))
  const outside = 1 - cabin
  const local = 1 - galaxy

  const isCompact = width < 640
  const aspect = height > 0 ? width / height : 1.6
  const narrowFactor = Math.max(0, Math.min(1, (1.45 - aspect) / 0.65))

  const orbitCenterX = isCompact ? 0.5 : 0.42
  const cx =
    width * (orbitCenterX + (0.5 - orbitCenterX) * Math.max(cabin, galaxy))
  const cy = height * (0.5 - 0.075 * cabin - 0.01 * galaxy)

  const minDim = Math.min(width, height)
  const fov = minDim * 1.18
  const baseCamDist = Math.max(COSMIC_CAM_DIST_MIN * 0.9, input.camDist)
  const camDist =
    baseCamDist +
    cabin * (0.72 + narrowFactor * 1.65) +
    outside * local * narrowFactor * 0.65

  const refScale = fov / 6.2
  const roll =
    -0.135 * outside * local + Math.sin(timeSec * 0.34) * 0.018 * cabin
  const rsWorld = 0.72
  const horizonScreenR = (rsWorld * fov) / camDist

  return {
    width,
    height,
    minDim,
    isCompact,
    isLoaf,
    simTime,
    warp,
    cabin,
    galaxy,
    outside,
    local,
    cx,
    cy,
    fov,
    camDist,
    refScale,
    roll,
    rsWorld,
    horizonScreenR,
  }
}

interface Star3D {
  x: number
  y: number
  z: number
  radius: number
  color: string
  alpha: number
  twinkleSpeed: number
  twinklePhase: number
}

interface AccretionFilament {
  radiusRatio: number
  angle0: number
  angularSpeed: number
  arcSpan: number
  heightOffset: number
  thickness: number
  heat: number
}

interface OrbitalSatellite {
  ringIndex: number
  angle0: number
  speed: number
  size: number
  hueIndex: number
}

interface ProjectedPoint {
  sx: number
  sy: number
  scale: number
  zRot: number
  visible: boolean
}

interface OrbitalRingSpec {
  radiusMult: number
  incX: number
  incZ: number
  speed: number
  strokeColor: string
}

const STAR_PALETTE = [
  '#e0f2fe',
  '#bae6fd',
  '#f8fafc',
  '#fef3c7',
  '#fde68a',
  '#ddd6fe',
  '#fecdd3',
] as const

const SATELLITE_COLORS = [
  '#38bdf8',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#fb7185',
] as const

const ORBITAL_RINGS: readonly OrbitalRingSpec[] = [
  {
    radiusMult: 2.65,
    incX: 0.24,
    incZ: -0.18,
    speed: 0.16,
    strokeColor: 'rgba(56, 189, 248, 0.24)',
  },
  {
    radiusMult: 3.75,
    incX: -0.34,
    incZ: 0.28,
    speed: -0.11,
    strokeColor: 'rgba(251, 191, 36, 0.2)',
  },
  {
    radiusMult: 5.05,
    incX: 0.12,
    incZ: 0.42,
    speed: 0.075,
    strokeColor: 'rgba(167, 139, 250, 0.18)',
  },
] as const

const RELAY_RING_ANGLES: Record<
  string,
  { ringIndex: number; baseAngle: number }
> = {
  openai: { ringIndex: 0, baseAngle: -0.68 },
  claude: { ringIndex: 1, baseAngle: -1.42 },
  gemini: { ringIndex: 1, baseAngle: 0.58 },
  deepseek: { ringIndex: 2, baseAngle: -0.18 },
}

interface GalaxyParticle {
  x: number
  y: number
  z: number
  radius: number
  color: string
  alpha: number
}

interface DistantGalaxy {
  x: number
  y: number
  z: number
  size: number
  tilt: number
  flatten: number
  hue: string
}

export interface CosmicUniverseField {
  stars: readonly Star3D[]
  filaments: readonly AccretionFilament[]
  satellites: readonly OrbitalSatellite[]
  galaxyArms: readonly GalaxyParticle[]
  distantGalaxies: readonly DistantGalaxy[]
}

const GALAXY_ARM_PALETTE = [
  '#bae6fd',
  '#93c5fd',
  '#c4b5fd',
  '#f9a8d4',
  '#fde68a',
  '#e0f2fe',
] as const

// World position of the Pale Blue Dot inside the macro spiral (Orion-spur analogue).
const PALE_BLUE_DOT_GALACTIC = { x: 17.5, y: 0.25, z: 9.2 } as const

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createCosmicUniverseField(): CosmicUniverseField {
  const rand = createSeededRandom(20261122)
  const stars: Star3D[] = []
  for (let i = 0; i < 680; i += 1) {
    const u = rand() * 2 - 1
    const theta = rand() * Math.PI * 2
    const radial = 2.6 + Math.pow(rand(), 0.58) * 11.5
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - u * u))
    const colorIdx = Math.floor(rand() * STAR_PALETTE.length)
    stars.push({
      x: radial * sqrtTerm * Math.cos(theta) * 1.45,
      y: radial * u * 0.88,
      z: radial * sqrtTerm * Math.sin(theta),
      radius: 0.45 + Math.pow(rand(), 2.3) * 1.9,
      color: STAR_PALETTE[colorIdx] ?? '#f8fafc',
      alpha: 0.26 + rand() * 0.72,
      twinkleSpeed: 0.7 + rand() * 2.4,
      twinklePhase: rand() * Math.PI * 2,
    })
  }

  // Sweeping 3D Milky Way galactic-plane star-dust band for wide depth parallax
  for (let i = 0; i < 240; i += 1) {
    const theta = rand() * Math.PI * 2
    const radial = 5.4 + rand() * 10.6
    const planeSpread = (rand() - 0.5) * (rand() - 0.5) * 2.9
    const colorIdx = Math.floor(rand() * STAR_PALETTE.length)
    stars.push({
      x: radial * Math.cos(theta) * 1.65,
      y: planeSpread,
      z: radial * Math.sin(theta),
      radius: 0.4 + rand() * 0.95,
      color: STAR_PALETTE[colorIdx] ?? '#bae6fd',
      alpha: 0.16 + rand() * 0.34,
      twinkleSpeed: 0.5 + rand() * 1.3,
      twinklePhase: rand() * Math.PI * 2,
    })
  }

  const filaments: AccretionFilament[] = []
  for (let i = 0; i < 460; i += 1) {
    const radialBias = Math.pow(rand(), 1.52)
    const radiusRatio = 1.24 + radialBias * 3.35
    const keplerSpeed = 1.35 / Math.pow(radiusRatio, 1.18)
    filaments.push({
      radiusRatio,
      angle0: rand() * Math.PI * 2,
      angularSpeed: keplerSpeed * (0.88 + rand() * 0.24),
      arcSpan: 0.11 + (1 - radialBias) * 0.2 + rand() * 0.08,
      heightOffset: (rand() - 0.5) * 0.09 * radiusRatio,
      thickness: 0.7 + (1 - radialBias) * 1.65 + rand() * 0.65,
      heat: 1 - radialBias * 0.82,
    })
  }

  const satellites: OrbitalSatellite[] = []
  for (let i = 0; i < 42; i += 1) {
    const ringIndex = i % ORBITAL_RINGS.length
    satellites.push({
      ringIndex,
      angle0: (i / 42) * Math.PI * 2 + rand() * 0.25,
      speed: (ringIndex === 1 ? -1 : 1) * (0.12 + rand() * 0.1),
      size: 1.35 + (i % 4 === 0 ? 1.15 : 0.45),
      hueIndex: i % SATELLITE_COLORS.length,
    })
  }

  // Logarithmic spiral galaxy: four arms of dust and young blue stars around the singularity core
  const galaxyArms: GalaxyParticle[] = []
  const armCount = 4
  for (let i = 0; i < 3200; i += 1) {
    const arm = i % armCount
    const along = Math.pow(rand(), 0.8)
    const radius = 3.6 + along * 33
    const twist = Math.log(radius / 3.6) * 2.6
    // Gaussian-ish falloff keeps arms crisp near their ridge line
    const spread = (rand() + rand() + rand() - 1.5) * 0.16
    const theta = (arm / armCount) * Math.PI * 2 + twist + spread
    const jitter = (rand() + rand() - 1) * (0.35 + along * 0.9)
    const thickness = (rand() - 0.5) * (rand() - 0.5) * (2.2 - along * 1.4)
    const isYoung = rand() > 0.82
    const colorIdx = Math.floor(rand() * GALAXY_ARM_PALETTE.length)
    galaxyArms.push({
      x: Math.cos(theta) * radius + jitter,
      y: thickness,
      z: Math.sin(theta) * radius + jitter * 0.6,
      radius: isYoung ? 1.1 + rand() * 1.3 : 0.5 + rand() * 0.8,
      color: isYoung ? '#bfdbfe' : (GALAXY_ARM_PALETTE[colorIdx] ?? '#e0f2fe'),
      alpha: (isYoung ? 0.55 : 0.22) + rand() * 0.38,
    })
  }
  // Dense golden bulge around the galactic core
  for (let i = 0; i < 700; i += 1) {
    const u = rand() * 2 - 1
    const theta = rand() * Math.PI * 2
    const radius = Math.pow(rand(), 1.9) * 6.4 + 1.2
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - u * u))
    galaxyArms.push({
      x: radius * sqrtTerm * Math.cos(theta),
      y: radius * u * 0.38,
      z: radius * sqrtTerm * Math.sin(theta),
      radius: 0.5 + rand() * 0.9,
      color: rand() > 0.5 ? '#fde68a' : '#fed7aa',
      alpha: 0.24 + rand() * 0.4,
    })
  }

  const distantGalaxies: DistantGalaxy[] = []
  const galaxyHues = ['#a5b4fc', '#f9a8d4', '#fcd34d', '#7dd3fc'] as const
  for (let i = 0; i < 26; i += 1) {
    const u = rand() * 1.6 - 0.8
    const theta = rand() * Math.PI * 2
    const radius = 70 + rand() * 90
    const sqrtTerm = Math.sqrt(Math.max(0, 1 - u * u))
    distantGalaxies.push({
      x: radius * sqrtTerm * Math.cos(theta),
      y: radius * u,
      z: radius * sqrtTerm * Math.sin(theta),
      size: 1.6 + rand() * 4.2,
      tilt: rand() * Math.PI,
      flatten: 0.22 + rand() * 0.6,
      hue: galaxyHues[i % galaxyHues.length] ?? '#a5b4fc',
    })
  }

  return { stars, filaments, satellites, galaxyArms, distantGalaxies }
}

function rotateRingPoint(
  radius: number,
  angle: number,
  incX: number,
  incZ: number
): { x: number; y: number; z: number } {
  const x0 = Math.cos(angle) * radius
  const z0 = Math.sin(angle) * radius
  const cosX = Math.cos(incX)
  const sinX = Math.sin(incX)
  const y1 = -z0 * sinX
  const z1 = z0 * cosX
  const cosZ = Math.cos(incZ)
  const sinZ = Math.sin(incZ)
  return {
    x: x0 * cosZ - y1 * sinZ,
    y: x0 * sinZ + y1 * cosZ,
    z: z1,
  }
}

function createProjector(
  cx: number,
  cy: number,
  fov: number,
  camDist: number,
  yaw: number,
  pitch: number,
  roll: number
): (x: number, y: number, z: number) => ProjectedPoint {
  const cyaw = Math.cos(yaw)
  const syaw = Math.sin(yaw)
  const cpitch = Math.cos(pitch)
  const spitch = Math.sin(pitch)
  const croll = Math.cos(roll)
  const sroll = Math.sin(roll)

  return (x: number, y: number, z: number): ProjectedPoint => {
    const x1 = x * cyaw + z * syaw
    const z1 = -x * syaw + z * cyaw
    const y2 = y * cpitch - z1 * spitch
    const z2 = y * spitch + z1 * cpitch
    const x3 = x1 * croll - y2 * sroll
    const y3 = x1 * sroll + y2 * croll

    const depth = z2 + camDist
    if (depth <= 0.35) {
      return { sx: cx, sy: cy, scale: 0, zRot: z2, visible: false }
    }
    const scale = fov / depth
    return {
      sx: cx + x3 * scale,
      sy: cy + y3 * scale,
      scale,
      zRot: z2,
      visible: true,
    }
  }
}

function applyBlackHoleLens(
  sx: number,
  sy: number,
  zRot: number,
  cx: number,
  cy: number,
  horizonScreenR: number
): { lx: number; ly: number; boost: number } {
  if (zRot <= 0) {
    return { lx: sx, ly: sy, boost: 1 }
  }
  const dx = sx - cx
  const dy = sy - cy
  const dist = Math.hypot(dx, dy)
  const einsteinR = horizonScreenR * 1.56
  const safeDist = Math.max(dist, 0.001)
  const nx = dist > 0.001 ? dx / safeDist : 0
  const ny = dist > 0.001 ? dy / safeDist : -1
  const depthFactor = Math.min(1.25, zRot / 2.2)
  const deflection =
    ((einsteinR * einsteinR) / (safeDist + horizonScreenR * 0.42)) *
    0.66 *
    depthFactor
  const newDist = Math.max(horizonScreenR * 1.04, dist + deflection)
  const ringProximity = Math.exp(
    -Math.pow((newDist - horizonScreenR * 1.24) / (horizonScreenR * 0.65), 2)
  )
  return {
    lx: cx + nx * newDist,
    ly: cy + ny * newDist,
    boost: 1 + ringProximity * 0.85,
  }
}

function pickFilamentStroke(
  heat: number,
  doppler: number,
  isLoaf: boolean,
  alpha: number
): string {
  const clampedAlpha = Math.max(0.02, Math.min(0.62, alpha))
  const temp = Math.max(0, Math.min(1, heat * 0.78 + (doppler + 1) * 0.22))
  const lerp = (a: number, b: number, t: number): number =>
    Math.round(a + (b - a) * t)

  const low: readonly [number, number, number] = isLoaf
    ? [168, 72, 28]
    : [36, 94, 178]
  const mid: readonly [number, number, number] = isLoaf
    ? [246, 173, 62]
    : [76, 188, 248]
  const high: readonly [number, number, number] = isLoaf
    ? [255, 243, 214]
    : [238, 248, 255]

  let r = 0
  let g = 0
  let b = 0
  if (temp < 0.55) {
    const blend = temp / 0.55
    r = lerp(low[0], mid[0], blend)
    g = lerp(low[1], mid[1], blend)
    b = lerp(low[2], mid[2], blend)
  } else {
    const blend = (temp - 0.55) / 0.45
    r = lerp(mid[0], high[0], blend)
    g = lerp(mid[1], high[1], blend)
    b = lerp(mid[2], high[2], blend)
  }
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha.toFixed(3)})`
}

function drawPaleBlueDotAndAstronaut(
  ctx: CanvasRenderingContext2D,
  obsX: number,
  obsY: number,
  timeSec: number,
  isLoaf: boolean,
  stormActive: boolean
): void {
  ctx.save()

  ctx.save()
  ctx.translate(obsX, obsY)
  ctx.rotate(-0.46)
  ctx.scale(1, 5.2)
  const beamGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 26)
  beamGrad.addColorStop(
    0,
    isLoaf ? 'rgba(253, 230, 138, 0.09)' : 'rgba(186, 230, 253, 0.085)'
  )
  beamGrad.addColorStop(0.45, 'rgba(125, 211, 252, 0.03)')
  beamGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
  ctx.fillStyle = beamGrad
  ctx.beginPath()
  ctx.arc(0, 0, 26, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (isLoaf || stormActive) {
    const sanctuaryR = 36 + Math.sin(timeSec * 1.6) * 2.5
    const auraGrad = ctx.createRadialGradient(
      obsX + 6,
      obsY - 4,
      4,
      obsX + 6,
      obsY - 4,
      sanctuaryR
    )
    auraGrad.addColorStop(0, 'rgba(45, 212, 191, 0.04)')
    auraGrad.addColorStop(
      0.72,
      stormActive ? 'rgba(52, 211, 153, 0.18)' : 'rgba(251, 191, 36, 0.16)'
    )
    auraGrad.addColorStop(1, 'rgba(45, 212, 191, 0)')
    ctx.fillStyle = auraGrad
    ctx.beginPath()
    ctx.arc(obsX + 6, obsY - 4, sanctuaryR, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = stormActive
      ? 'rgba(52, 211, 153, 0.42)'
      : 'rgba(251, 191, 36, 0.34)'
    ctx.lineWidth = 0.9
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.arc(obsX + 6, obsY - 4, sanctuaryR * 0.86, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const dotGlow = ctx.createRadialGradient(obsX, obsY, 0.5, obsX, obsY, 15)
  dotGlow.addColorStop(0, 'rgba(224, 242, 254, 0.95)')
  dotGlow.addColorStop(0.28, 'rgba(56, 189, 248, 0.62)')
  dotGlow.addColorStop(1, 'rgba(14, 165, 233, 0)')
  ctx.fillStyle = dotGlow
  ctx.beginPath()
  ctx.arc(obsX, obsY, 15, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#7dd3fc'
  ctx.beginPath()
  ctx.arc(obsX, obsY, 3.6, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f0f9ff'
  ctx.beginPath()
  ctx.arc(obsX - 1, obsY - 1, 1.3, 0, Math.PI * 2)
  ctx.fill()

  const bobX = obsX + 18 + Math.sin(timeSec * 0.95) * 2.2
  const bobY = obsY - 11 + Math.cos(timeSec * 1.15) * 2.8

  ctx.strokeStyle = 'rgba(186, 230, 253, 0.42)'
  ctx.lineWidth = 0.85
  ctx.beginPath()
  ctx.moveTo(obsX + 2.5, obsY - 1.5)
  ctx.quadraticCurveTo(
    obsX + 10,
    obsY - 13 + Math.sin(timeSec * 1.3) * 2,
    bobX - 2,
    bobY + 2
  )
  ctx.stroke()

  ctx.save()
  ctx.translate(bobX, bobY)
  ctx.rotate(-0.28 + Math.sin(timeSec * 0.7) * 0.08)

  ctx.fillStyle = 'rgba(226, 232, 240, 0.88)'
  ctx.fillRect(-3.6, -2.2, 2.4, 4.8)
  ctx.fillStyle = '#f8fafc'
  ctx.beginPath()
  ctx.ellipse(0, 0.5, 2.3, 3.4, 0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 1.35
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0.8, 3.2)
  ctx.lineTo(3.4, 5.4)
  ctx.lineTo(5.2, 4.3)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(0.4, -3.6, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(1.1, -3.7, 1.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Zero-G drifting teacup beside the tiny astronaut in Loaf Mode
  if (isLoaf) {
    const cupX = bobX + 9.5 + Math.cos(timeSec * 1.35) * 1.4
    const cupY = bobY - 4.5 + Math.sin(timeSec * 1.55) * 1.6
    ctx.fillStyle = '#fef3c7'
    ctx.fillRect(cupX - 1.4, cupY - 1.4, 2.8, 2.8)
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.7)'
    ctx.lineWidth = 0.75
    ctx.beginPath()
    ctx.moveTo(cupX, cupY - 2.4)
    ctx.quadraticCurveTo(cupX + 1.4, cupY - 4.4, cupX - 0.4, cupY - 6.2)
    ctx.stroke()
  }

  const tickR = 24
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.36)'
  ctx.lineWidth = 0.85
  const corners: readonly [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
  for (const [sxSign, sySign] of corners) {
    const cxCorner = obsX + 8 + sxSign * tickR
    const cyCorner = obsY - 5 + sySign * tickR
    ctx.beginPath()
    ctx.moveTo(cxCorner - sxSign * 5, cyCorner)
    ctx.lineTo(cxCorner, cyCorner)
    ctx.lineTo(cxCorner, cyCorner - sySign * 5)
    ctx.stroke()
  }

  ctx.restore()
}

function drawGalacticMacroLayers(
  ctx: CanvasRenderingContext2D,
  field: CosmicUniverseField,
  project: (x: number, y: number, z: number) => ProjectedPoint,
  view: {
    width: number
    height: number
    cx: number
    cy: number
    galaxy: number
    timeSec: number
    isLoaf: boolean
    refScale: number
  }
): void {
  const { width, height, galaxy } = view

  // Far-field galaxies drift with parallax at every zoom level, brighter when zoomed out
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < field.distantGalaxies.length; i += 1) {
    const g = field.distantGalaxies[i]
    if (!g) continue
    const proj = project(g.x, g.y, g.z)
    if (!proj.visible) continue
    if (proj.sx < -80 || proj.sx > width + 80) continue
    if (proj.sy < -80 || proj.sy > height + 80) continue
    const r = Math.max(3, g.size * proj.scale * 1.2)
    ctx.save()
    ctx.translate(proj.sx, proj.sy)
    ctx.rotate(g.tilt)
    ctx.scale(1, g.flatten)
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    grad.addColorStop(
      0,
      `rgba(255, 255, 255, ${(0.32 + galaxy * 0.4).toFixed(3)})`
    )
    grad.addColorStop(0.25, `${g.hue}55`)
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()

  if (galaxy <= 0.01) return

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  // Diffuse galactic disk haze projected in 3D so it tilts with the camera
  const diskEdge = project(32, 0, 0)
  const diskRadiusPx = diskEdge.visible
    ? Math.hypot(diskEdge.sx - view.cx, diskEdge.sy - view.cy)
    : Math.min(width, height) * 0.5
  const haze = ctx.createRadialGradient(
    view.cx,
    view.cy,
    0,
    view.cx,
    view.cy,
    Math.max(40, diskRadiusPx * 1.1)
  )
  haze.addColorStop(0, `rgba(254, 243, 199, ${(0.42 * galaxy).toFixed(3)})`)
  haze.addColorStop(
    0.12,
    view.isLoaf
      ? `rgba(251, 191, 36, ${(0.2 * galaxy).toFixed(3)})`
      : `rgba(253, 186, 116, ${(0.18 * galaxy).toFixed(3)})`
  )
  haze.addColorStop(0.45, `rgba(99, 102, 241, ${(0.07 * galaxy).toFixed(3)})`)
  haze.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, width, height)

  const rotation = view.timeSec * 0.012
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  for (let i = 0; i < field.galaxyArms.length; i += 1) {
    const p = field.galaxyArms[i]
    if (!p) continue
    const rx = p.x * cosR - p.z * sinR
    const rz = p.x * sinR + p.z * cosR
    const proj = project(rx, p.y, rz)
    if (!proj.visible) continue
    if (proj.sx < -20 || proj.sx > width + 20) continue
    if (proj.sy < -20 || proj.sy > height + 20) continue
    const rPx = Math.min(
      2.4,
      Math.max(0.65, p.radius * (proj.scale / view.refScale) * 2.8)
    )
    ctx.globalAlpha = Math.min(0.82, p.alpha * 1.15) * galaxy
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(proj.sx, proj.sy, rPx * 0.65, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawYouAreHerePin(
  ctx: CanvasRenderingContext2D,
  width: number,
  x: number,
  y: number,
  timeSec: number,
  galaxy: number,
  label: string
): void {
  const strength = Math.min(1, (galaxy - 0.35) / 0.4)
  ctx.save()
  ctx.globalAlpha = strength
  const pulse = (timeSec * 0.8) % 1
  ctx.strokeStyle = `rgba(56, 189, 248, ${(0.8 * (1 - pulse)).toFixed(3)})`
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(x, y, 6 + pulse * 26, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#7dd3fc'
  ctx.beginPath()
  ctx.arc(x, y, 2.6, 0, Math.PI * 2)
  ctx.fill()

  if (label) {
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
    const textW = ctx.measureText(label).width
    const pillW = textW + 16
    const flipLeft = x + 36 + pillW > width - 10
    const dir = flipLeft ? -1 : 1
    const elbowX = x + dir * 16
    const endX = x + dir * 30
    const pillX = flipLeft ? endX - pillW - 2 : endX + 2

    ctx.strokeStyle = 'rgba(186, 230, 253, 0.65)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y - 4)
    ctx.lineTo(elbowX, y - 28)
    ctx.lineTo(endX, y - 28)
    ctx.stroke()

    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)'
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)'
    ctx.beginPath()
    ctx.roundRect(pillX, y - 39, pillW, 22, 11)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#e0f2fe'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, pillX + 8, y - 28)
  }
  ctx.restore()
}

/** Appends the canopy outline as a subpath (caller owns beginPath) for hull mask, frame and glass. */
function traceCanopyPath(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const isCompact = width < 640
  const left = width * (isCompact ? 0.032 : 0.048)
  const right = width * (isCompact ? 0.968 : 0.952)
  const top = height * (isCompact ? 0.048 : 0.056)
  const bottom = height * (isCompact ? 0.8 : 0.79)
  const shoulder = height * (isCompact ? 0.13 : 0.16)
  const inset = width * (isCompact ? 0.03 : 0.045)
  ctx.moveTo(left + inset, bottom)
  ctx.lineTo(left, top + shoulder)
  ctx.quadraticCurveTo(left + width * 0.018, top, left + width * 0.13, top)
  ctx.lineTo(right - width * 0.13, top)
  ctx.quadraticCurveTo(right - width * 0.018, top, right, top + shoulder)
  ctx.lineTo(right - inset, bottom)
  ctx.quadraticCurveTo(
    width * 0.5,
    bottom + height * 0.038,
    left + inset,
    bottom
  )
  ctx.closePath()
}

function drawCabinCockpit(
  ctx: CanvasRenderingContext2D,
  view: {
    width: number
    height: number
    timeSec: number
    cabin: number
    isLoaf: boolean
    stormActive: boolean
    pointerNormX: number
    pointerNormY: number
    accent: string
  }
): void {
  const { width, height, timeSec, cabin } = view
  const isCompact = width < 640
  // Pulling back out of the pod: the canopy frame balloons past the screen edge
  const expand = 1 + Math.pow(1 - cabin, 1.6) * 1.9
  // Interior parallax: the hull shifts against the pointer for a head-tracking depth cue
  const parX = (view.pointerNormX - 0.5) * (isCompact ? -8 : -18)
  const parY = (view.pointerNormY - 0.5) * (isCompact ? -6 : -12)
  const bobY = Math.sin(timeSec * 0.85) * 1.6

  ctx.save()
  ctx.globalAlpha = Math.min(1, cabin * 1.25)
  ctx.translate(width * 0.5 + parX, height * 0.46 + parY + bobY)
  ctx.scale(expand, expand)
  ctx.translate(-width * 0.5, -height * 0.46)

  // Glass sheen + faint reflections on the canopy
  ctx.save()
  ctx.beginPath()
  traceCanopyPath(ctx, width, height)
  ctx.clip()
  const sheen = ctx.createLinearGradient(width * 0.08, 0, width * 0.52, height)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0)')
  sheen.addColorStop(0.44, 'rgba(255, 255, 255, 0)')
  sheen.addColorStop(0.48, 'rgba(186, 230, 253, 0.032)')
  sheen.addColorStop(0.53, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, width, height)

  if (!isCompact) {
    const tickInsetX = width * 0.12
    const tickTopY = height * 0.13
    const tickBottomY = height * 0.71
    const tickLen = 14
    ctx.strokeStyle = view.isLoaf
      ? 'rgba(253, 230, 138, 0.16)'
      : 'rgba(148, 214, 255, 0.16)'
    ctx.lineWidth = 1
    const brackets: readonly [number, number, number, number][] = [
      [tickInsetX, tickTopY, 1, 1],
      [width - tickInsetX, tickTopY, -1, 1],
      [tickInsetX, tickBottomY, 1, -1],
      [width - tickInsetX, tickBottomY, -1, -1],
    ]
    for (const [bx, by, sxSign, sySign] of brackets) {
      ctx.beginPath()
      ctx.moveTo(bx + sxSign * tickLen, by)
      ctx.lineTo(bx, by)
      ctx.lineTo(bx, by + sySign * tickLen)
      ctx.stroke()
    }
  }
  ctx.restore()

  // Hull interior: everything outside the canopy, filled even-odd
  ctx.beginPath()
  ctx.rect(-width, -height, width * 3, height * 3)
  traceCanopyPath(ctx, width, height)
  const hull = ctx.createLinearGradient(0, 0, 0, height)
  hull.addColorStop(0, '#070c17')
  hull.addColorStop(0.55, '#0b1222')
  hull.addColorStop(1, view.isLoaf ? '#1c140e' : '#0a1220')
  ctx.fillStyle = hull
  ctx.fill('evenodd')
  ctx.save()
  ctx.clip('evenodd')

  // Warm cabin light pooling on the lower hull
  const warm = ctx.createRadialGradient(
    width * 0.5,
    height * 1.05,
    10,
    width * 0.5,
    height * 1.05,
    width * 0.58
  )
  warm.addColorStop(
    0,
    view.isLoaf ? 'rgba(251, 191, 36, 0.18)' : 'rgba(56, 189, 248, 0.12)'
  )
  warm.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = warm
  ctx.fillRect(-width, height * 0.5, width * 3, height)
  ctx.restore()

  // Canopy frame: brushed metal rim + mullions converging to a vanishing point
  const rimWidth = Math.max(5, Math.min(11, width * 0.01))
  ctx.beginPath()
  traceCanopyPath(ctx, width, height)
  const rim = ctx.createLinearGradient(0, 0, width, height)
  rim.addColorStop(0, '#334155')
  rim.addColorStop(0.5, '#131d31')
  rim.addColorStop(1, '#263449')
  ctx.strokeStyle = rim
  ctx.lineWidth = rimWidth
  ctx.stroke()
  ctx.strokeStyle = view.stormActive
    ? `rgba(251, 113, 133, ${(0.38 + Math.sin(timeSec * 5) * 0.24).toFixed(3)})`
    : 'rgba(148, 163, 184, 0.32)'
  ctx.lineWidth = 1
  ctx.stroke()

  if (!isCompact) {
    ctx.strokeStyle = 'rgba(22, 32, 51, 0.92)'
    ctx.lineWidth = Math.max(4, Math.min(6.5, width * 0.0052))
    ctx.lineCap = 'round'
    for (const xr of [0.22, 0.78]) {
      ctx.beginPath()
      ctx.moveTo(width * (0.5 + (xr - 0.5) * 0.86), height * 0.056)
      ctx.lineTo(width * (0.5 + (xr - 0.5) * 1.06), height * 0.795)
      ctx.stroke()
    }
  }

  // Dashboard console in perspective
  const dashTop = height * 0.828
  ctx.beginPath()
  ctx.moveTo(-width * 0.2, height * 1.2)
  ctx.lineTo(width * 0.06, dashTop + 5)
  ctx.quadraticCurveTo(width * 0.5, dashTop - 10, width * 0.94, dashTop + 5)
  ctx.lineTo(width * 1.2, height * 1.2)
  ctx.closePath()
  const dash = ctx.createLinearGradient(0, dashTop - 10, 0, height)
  dash.addColorStop(0, '#152036')
  dash.addColorStop(0.18, '#0b1222')
  dash.addColorStop(1, '#030712')
  ctx.fillStyle = dash
  ctx.fill()
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.16)'
  ctx.lineWidth = 1
  ctx.stroke()

  const drawWaveBezel = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    stroke: string,
    freq: number,
    phase: number
  ): void => {
    ctx.fillStyle = 'rgba(3, 8, 20, 0.84)'
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(sx, sy, sw, sh, 5)
    ctx.fill()
    ctx.stroke()

    const midY = sy + sh * 0.52
    const amp = sh * 0.26
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.35
    ctx.beginPath()
    const samples = 24
    for (let s = 0; s <= samples; s += 1) {
      const u = s / samples
      const env = Math.sin(u * Math.PI)
      const wy =
        midY +
        Math.sin(u * Math.PI * freq - timeSec * 2.1 + phase) * amp * env +
        Math.sin(u * Math.PI * (freq * 1.9) + timeSec * 1.3) * amp * 0.28 * env
      const wx = sx + 6 + u * (sw - 12)
      if (s === 0) ctx.moveTo(wx, wy)
      else ctx.lineTo(wx, wy)
    }
    ctx.stroke()
  }

  let waveStroke = 'rgba(56, 189, 248, 0.82)'
  if (view.stormActive) {
    waveStroke = 'rgba(251, 113, 133, 0.85)'
  } else if (view.isLoaf) {
    waveStroke = 'rgba(251, 191, 36, 0.82)'
  }

  if (isCompact) {
    const sw = Math.min(width * 0.58, 220)
    const sh = Math.max(20, height * 0.072)
    drawWaveBezel(
      (width - sw) * 0.5,
      dashTop + height * 0.025,
      sw,
      sh,
      waveStroke,
      3.2,
      0
    )
  } else {
    const sw = Math.min(width * 0.135, 165)
    const sh = Math.max(26, height * 0.074)
    const sy = dashTop + height * 0.026
    drawWaveBezel(width * 0.3 - sw * 0.5, sy, sw, sh, view.accent, 3.0, 0)
    drawWaveBezel(width * 0.5 - sw * 0.5, sy, sw, sh, waveStroke, 4.2, 1.4)
    drawWaveBezel(
      width * 0.7 - sw * 0.5,
      sy,
      sw,
      sh,
      'rgba(251, 191, 36, 0.75)',
      2.4,
      2.8
    )
  }

  const ledCount = isCompact ? 3 : 5
  const ledSpread = isCompact ? 0.18 : 0.24
  for (let k = 0; k < ledCount; k += 1) {
    const u = ledCount > 1 ? k / (ledCount - 1) - 0.5 : 0
    const pulse = 0.45 + 0.55 * Math.sin(timeSec * (1.2 + k * 0.4) + k)
    let ledColor = `rgba(56, 189, 248, ${(0.28 + pulse * 0.45).toFixed(3)})`
    if (view.stormActive) {
      ledColor = `rgba(251, 113, 133, ${(0.35 + pulse * 0.45).toFixed(3)})`
    } else if (view.isLoaf) {
      ledColor = `rgba(251, 191, 36, ${(0.28 + pulse * 0.45).toFixed(3)})`
    }
    ctx.fillStyle = ledColor
    ctx.beginPath()
    ctx.arc(
      width * (0.5 + u * ledSpread),
      dashTop + height * 0.125,
      1.8,
      0,
      Math.PI * 2
    )
    ctx.fill()
  }
  ctx.restore()

  // Zero-G cabin props float in front of the canopy (stronger parallax, nearer the eye)
  ctx.save()
  ctx.globalAlpha = Math.min(1, cabin * 1.25)
  const nearParX = parX * 1.35
  const nearParY = parY * 1.35

  if (width >= 900) {
    const mugX = width * 0.88 + Math.sin(timeSec * 0.52) * 10 + nearParX
    const mugY = height * 0.7 + Math.cos(timeSec * 0.65) * 7 + nearParY
    const mugSpin = Math.sin(timeSec * 0.35) * 0.34
    ctx.save()
    ctx.translate(mugX, mugY)
    ctx.rotate(mugSpin)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)'
    ctx.strokeStyle = view.isLoaf
      ? 'rgba(253, 230, 138, 0.34)'
      : 'rgba(186, 230, 253, 0.32)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.roundRect(-9, -11, 18, 22, 3.5)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(10.5, 0, 4.8, -Math.PI / 2, Math.PI / 2)
    ctx.stroke()
    ctx.restore()
  }

  // Dust motes catching the starlight
  const moteCount = isCompact ? 5 : 10
  for (let k = 0; k < moteCount; k += 1) {
    const mx =
      ((k * 113.7 + timeSec * (4 + (k % 4) * 1.6)) % (width * 1.05)) -
      width * 0.025
    const my =
      height * (0.14 + ((k * 37) % 64) / 100) + Math.sin(timeSec * 0.8 + k) * 6
    ctx.fillStyle = 'rgba(226, 232, 240, 0.22)'
    ctx.beginPath()
    ctx.arc(mx + nearParX * 0.4, my + nearParY * 0.4, 0.85, 0, Math.PI * 2)
    ctx.fill()
  }

  // Edge vignette sells the "inside a helmet/pod" framing
  const vig = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    Math.min(width, height) * 0.38,
    width * 0.5,
    height * 0.45,
    Math.max(width, height) * 0.78
  )
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.44)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

export function renderCosmicHudOverlay(
  ctx: CanvasRenderingContext2D,
  field: CosmicUniverseField,
  input: CosmicSceneInput,
  layout: CosmicCameraLayout = computeCosmicCameraLayout(input),
  clearCanvas = true
): void {
  const {
    width,
    height,
    isCompact,
    isLoaf,
    simTime,
    cabin,
    galaxy,
    outside,
    local,
    cx,
    cy,
    fov,
    camDist,
    refScale,
    roll,
    rsWorld,
    horizonScreenR,
  } = layout
  if (width <= 0 || height <= 0) return

  if (clearCanvas) {
    ctx.clearRect(0, 0, width, height)
  }

  const { timeSec } = input
  const project = createProjector(
    cx,
    cy,
    fov,
    camDist,
    input.yaw,
    input.pitch,
    roll
  )

  const fixedObsX =
    width * (isCompact ? 0.8 : 0.81) + Math.sin(input.yaw - 0.08) * 14
  const fixedObsY =
    height * (isCompact ? 0.76 : 0.63) + Math.sin(input.pitch - 0.31) * 12
  const obsGalactic = project(
    PALE_BLUE_DOT_GALACTIC.x,
    PALE_BLUE_DOT_GALACTIC.y,
    PALE_BLUE_DOT_GALACTIC.z
  )
  const obsX = obsGalactic.visible
    ? fixedObsX + (obsGalactic.sx - fixedObsX) * galaxy
    : fixedObsX
  const obsY = obsGalactic.visible
    ? fixedObsY + (obsGalactic.sy - fixedObsY) * galaxy
    : fixedObsY

  const orbitStrength = outside * local
  if (orbitStrength > 0.04) {
    ctx.save()
    ctx.globalAlpha = orbitStrength * (isCompact ? 0.7 : 0.9)

    const segCount = 72
    for (let rIdx = 0; rIdx < ORBITAL_RINGS.length; rIdx += 1) {
      const ring = ORBITAL_RINGS[rIdx]
      if (!ring) continue
      const worldR = rsWorld * ring.radiusMult
      ctx.strokeStyle = ring.strokeColor
      ctx.lineWidth = rIdx === 0 ? 0.95 : 0.75
      ctx.beginPath()
      let penDown = false
      for (let s = 0; s <= segCount; s += 1) {
        const ang = (s / segCount) * Math.PI * 2
        const pt3 = rotateRingPoint(worldR, ang, ring.incX, ring.incZ)
        const proj = project(pt3.x, pt3.y, pt3.z)
        if (!proj.visible) {
          penDown = false
          continue
        }
        const distToCenter = Math.hypot(proj.sx - cx, proj.sy - cy)
        if (proj.zRot > 0 && distToCenter < horizonScreenR * 1.05) {
          penDown = false
          continue
        }
        if (!penDown) {
          ctx.moveTo(proj.sx, proj.sy)
          penDown = true
        } else {
          ctx.lineTo(proj.sx, proj.sy)
        }
      }
      ctx.stroke()
    }

    const satStep = isCompact ? 3 : 2
    for (let i = 0; i < field.satellites.length; i += satStep) {
      const sat = field.satellites[i]
      if (!sat) continue
      const ring = ORBITAL_RINGS[sat.ringIndex]
      if (!ring) continue
      const ang = sat.angle0 + simTime * sat.speed
      const pt3 = rotateRingPoint(
        rsWorld * ring.radiusMult,
        ang,
        ring.incX,
        ring.incZ
      )
      const proj = project(pt3.x, pt3.y, pt3.z)
      if (!proj.visible) continue
      if (
        proj.zRot > 0 &&
        Math.hypot(proj.sx - cx, proj.sy - cy) < horizonScreenR * 1.05
      ) {
        continue
      }
      const satColor = SATELLITE_COLORS[sat.hueIndex] ?? '#38bdf8'
      const dotR = Math.min(
        2.2,
        Math.max(0.9, sat.size * (proj.scale / refScale) * 0.75)
      )
      ctx.fillStyle = satColor
      ctx.globalAlpha = orbitStrength * (proj.zRot <= 0 ? 0.7 : 0.32)
      ctx.beginPath()
      ctx.arc(proj.sx, proj.sy, dotR, 0, Math.PI * 2)
      ctx.fill()
    }

    const relayCfg = RELAY_RING_ANGLES[input.activeRelayId] ?? {
      ringIndex: 0,
      baseAngle: -0.68,
    }
    const relayRing = ORBITAL_RINGS[relayCfg.ringIndex] ?? ORBITAL_RINGS[0]
    if (relayRing) {
      const relayAngle = relayCfg.baseAngle + simTime * relayRing.speed * 0.45
      const relay3D = rotateRingPoint(
        rsWorld * relayRing.radiusMult,
        relayAngle,
        relayRing.incX,
        relayRing.incZ
      )
      const relayProj = project(relay3D.x, relay3D.y, relay3D.z)
      if (relayProj.visible) {
        const dx = relayProj.sx - cx
        const dy = relayProj.sy - cy
        const dist = Math.max(1, Math.hypot(dx, dy))
        const startR = Math.min(dist * 0.45, horizonScreenR * 1.24)
        const startX = cx + (dx / dist) * startR
        const startY = cy + (dy / dist) * startR
        const ctrlX = (startX + relayProj.sx) * 0.5
        const ctrlY = Math.min(startY, relayProj.sy) - horizonScreenR * 0.55

        ctx.save()
        ctx.strokeStyle = input.activeAccent
        ctx.globalAlpha = 0.52 * orbitStrength
        ctx.lineWidth = 1.4
        ctx.setLineDash([5, 7])
        ctx.lineDashOffset = -timeSec * 38
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.quadraticCurveTo(ctrlX, ctrlY, relayProj.sx, relayProj.sy)
        ctx.stroke()

        if (!isCompact) {
          ctx.globalAlpha = 0.24 * orbitStrength
          ctx.lineWidth = 1
          ctx.setLineDash([4, 9])
          ctx.lineDashOffset = -timeSec * 24
          ctx.beginPath()
          ctx.moveTo(relayProj.sx, relayProj.sy)
          ctx.quadraticCurveTo(
            (relayProj.sx + obsX) * 0.52,
            Math.min(relayProj.sy, obsY) - 28,
            obsX,
            obsY
          )
          ctx.stroke()
        }
        ctx.restore()

        ctx.globalAlpha = orbitStrength
        ctx.fillStyle = input.activeAccent
        ctx.beginPath()
        ctx.arc(relayProj.sx, relayProj.sy, 3.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = input.activeAccent
        ctx.globalAlpha = 0.42 * orbitStrength
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.arc(
          relayProj.sx,
          relayProj.sy,
          8 + Math.sin(timeSec * 3.2) * 1.8,
          0,
          Math.PI * 2
        )
        ctx.stroke()
      }
    }

    if (input.stormActive) {
      const shieldX = cx + horizonScreenR * (isCompact ? 1.45 : 1.9)
      const shieldY = cy - horizonScreenR * (isCompact ? 0.95 : 1.15)
      ctx.save()
      ctx.globalAlpha = orbitStrength
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(shieldX, shieldY, 24, -Math.PI * 0.72, Math.PI * 0.28)
      ctx.stroke()

      ctx.strokeStyle = 'rgba(251, 113, 133, 0.64)'
      ctx.lineWidth = 1.3
      ctx.setLineDash([5, 6])
      ctx.lineDashOffset = -timeSec * 58
      ctx.beginPath()
      ctx.moveTo(width * 0.14, height * 0.09)
      ctx.lineTo(shieldX - 4, shieldY - 5)
      ctx.lineTo(width * 0.3, height * 0.05)
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()
  }

  if (outside > 0.04) {
    ctx.save()
    ctx.globalAlpha = outside * (1 - galaxy * 0.55)
    drawPaleBlueDotAndAstronaut(
      ctx,
      obsX,
      obsY,
      timeSec,
      isLoaf,
      input.stormActive
    )
    ctx.restore()
  }

  if (galaxy > 0.35) {
    drawYouAreHerePin(ctx, width, obsX, obsY, timeSec, galaxy, input.hereLabel)
  }

  if (cabin > 0.01) {
    drawCabinCockpit(ctx, {
      width,
      height,
      timeSec,
      cabin,
      isLoaf,
      stormActive: input.stormActive,
      pointerNormX: input.pointerInside ? input.pointerNormX : 0.5,
      pointerNormY: input.pointerInside ? input.pointerNormY : 0.5,
      accent: input.activeAccent,
    })
  }
}

export function renderCosmicSingularityFrame(
  ctx: CanvasRenderingContext2D,
  field: CosmicUniverseField,
  input: CosmicSceneInput
): void {
  const { width, height, timeSec } = input
  if (width <= 0 || height <= 0) return

  const layout = computeCosmicCameraLayout(input)
  const {
    minDim,
    isCompact,
    isLoaf,
    simTime,
    warp,
    galaxy,
    local,
    cx,
    cy,
    fov,
    camDist,
    refScale,
    roll,
    rsWorld,
    horizonScreenR,
  } = layout

  const project = createProjector(
    cx,
    cy,
    fov,
    camDist,
    input.yaw,
    input.pitch,
    roll
  )

  const bgGrad = ctx.createRadialGradient(
    cx,
    cy,
    horizonScreenR * 0.25,
    cx,
    cy,
    Math.max(width, height) * 0.92
  )
  if (isLoaf) {
    bgGrad.addColorStop(0, '#130e24')
    bgGrad.addColorStop(0.36, '#070918')
    bgGrad.addColorStop(0.74, '#03050d')
    bgGrad.addColorStop(1, '#010207')
  } else {
    bgGrad.addColorStop(0, '#0a162c')
    bgGrad.addColorStop(0.36, '#050b19')
    bgGrad.addColorStop(0.74, '#02050d')
    bgGrad.addColorStop(1, '#010206')
  }
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const nebulaA = ctx.createRadialGradient(
    cx - horizonScreenR * 0.8,
    cy - horizonScreenR * 0.4,
    horizonScreenR * 0.4,
    cx,
    cy,
    horizonScreenR * 5.2
  )
  nebulaA.addColorStop(
    0,
    isLoaf ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)'
  )
  nebulaA.addColorStop(
    0.45,
    isLoaf ? 'rgba(139, 92, 246, 0.08)' : 'rgba(99, 102, 241, 0.08)'
  )
  nebulaA.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = nebulaA
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  drawGalacticMacroLayers(ctx, field, project, {
    width,
    height,
    cx,
    cy,
    galaxy,
    timeSec,
    isLoaf,
    refScale,
  })

  const pointerPx = input.pointerNormX * width
  const pointerPy = input.pointerNormY * height
  const starStep = isCompact ? 2 : 1

  for (let i = 0; i < field.stars.length; i += starStep) {
    const star = field.stars[i]
    if (!star) continue
    const proj = project(star.x, star.y, star.z)
    if (!proj.visible) continue
    if (
      proj.sx < -60 ||
      proj.sx > width + 60 ||
      proj.sy < -60 ||
      proj.sy > height + 60
    ) {
      continue
    }

    let sx = proj.sx
    let sy = proj.sy
    let lensBoost = 1

    const distHole = Math.hypot(sx - cx, sy - cy)
    if (proj.zRot > 0 && distHole < horizonScreenR * 3.8) {
      const lensed = applyBlackHoleLens(
        sx,
        sy,
        proj.zRot,
        cx,
        cy,
        horizonScreenR
      )
      sx = lensed.lx
      sy = lensed.ly
      lensBoost = lensed.boost
    } else if (distHole < horizonScreenR * 0.98 && proj.zRot > 0) {
      continue
    }

    if (input.pointerInside) {
      const pdx = sx - pointerPx
      const pdy = sy - pointerPy
      const pDist = Math.hypot(pdx, pdy)
      if (pDist > 2 && pDist < 185) {
        const pull = ((185 - pDist) / 185) * 14
        sx += (pdx / pDist) * pull * 0.55
        sy += (pdy / pDist) * pull * 0.55
        lensBoost += ((185 - pDist) / 185) * 0.45
      }
    }

    const twinkle =
      0.72 + 0.28 * Math.sin(timeSec * star.twinkleSpeed + star.twinklePhase)
    const starAlpha = Math.min(1, star.alpha * twinkle * lensBoost)
    const rPx = Math.max(0.45, star.radius * (proj.scale / refScale))

    if (warp > 0.04) {
      const rdx = sx - cx
      const rdy = sy - cy
      const rLen = Math.max(1, Math.hypot(rdx, rdy))
      const streakLen = warp * (8 + (rLen / minDim) * 38)
      ctx.strokeStyle = star.color
      ctx.globalAlpha = starAlpha * 0.85
      ctx.lineWidth = Math.max(0.7, rPx * 0.9)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + (rdx / rLen) * streakLen, sy + (rdy / rLen) * streakLen)
      ctx.stroke()
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = star.color
      ctx.globalAlpha = starAlpha
      ctx.beginPath()
      ctx.arc(sx, sy, Math.min(2.6, rPx), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  const drawAccretionPass = (frontPass: boolean): void => {
    if (local <= 0.04) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    const filStep = isCompact ? 2 : 1

    for (let i = 0; i < field.filaments.length; i += filStep) {
      const fil = field.filaments[i]
      if (!fil) continue
      const rWorld = rsWorld * fil.radiusRatio
      const thetaA = fil.angle0 + simTime * fil.angularSpeed * (1 + warp * 0.85)
      const thetaB = thetaA + fil.arcSpan
      const thetaMid = (thetaA + thetaB) * 0.5

      const pA = project(
        Math.cos(thetaA) * rWorld,
        fil.heightOffset,
        Math.sin(thetaA) * rWorld
      )
      const pMid = project(
        Math.cos(thetaMid) * rWorld,
        fil.heightOffset,
        Math.sin(thetaMid) * rWorld
      )
      const pB = project(
        Math.cos(thetaB) * rWorld,
        fil.heightOffset,
        Math.sin(thetaB) * rWorld
      )
      if (!pA.visible || !pB.visible || !pMid.visible) continue

      const isFront = pMid.zRot <= 0
      if (isFront !== frontPass) continue

      let ax = pA.sx
      let ay = pA.sy
      let mx = pMid.sx
      let my = pMid.sy
      let bx = pB.sx
      let by = pB.sy
      let boost = 1

      if (!frontPass) {
        const lA = applyBlackHoleLens(ax, ay, pA.zRot, cx, cy, horizonScreenR)
        const lM = applyBlackHoleLens(mx, my, pMid.zRot, cx, cy, horizonScreenR)
        const lB = applyBlackHoleLens(bx, by, pB.zRot, cx, cy, horizonScreenR)
        ax = lA.lx
        ay = lA.ly
        mx = lM.lx
        my = lM.ly
        bx = lB.lx
        by = lB.ly
        boost = lM.boost
      }

      const dz = pB.zRot - pA.zRot
      const segArcWorld = Math.max(0.001, rWorld * fil.arcSpan)
      const doppler = Math.max(-1, Math.min(1, -dz / segArcWorld))
      const dopplerAlpha =
        (0.08 + fil.heat * 0.22) * (1 + doppler * 0.46) * boost * local

      ctx.strokeStyle = pickFilamentStroke(
        fil.heat,
        doppler,
        isLoaf,
        dopplerAlpha
      )
      ctx.lineWidth = Math.min(
        2.1,
        Math.max(0.55, fil.thickness * 0.55 * (pMid.scale / refScale))
      )
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.quadraticCurveTo(mx, my, bx, by)
      ctx.stroke()
    }

    ctx.restore()
  }

  if (local > 0.04) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.translate(cx, cy)
    ctx.rotate(roll)
    ctx.scale(1, Math.max(0.24, Math.abs(Math.sin(input.pitch)) * 0.72 + 0.14))
    const diskBase = ctx.createRadialGradient(
      0,
      0,
      horizonScreenR * 0.95,
      0,
      0,
      horizonScreenR * 3.4
    )
    diskBase.addColorStop(
      0,
      `rgba(255, 255, 255, ${(0.24 * local).toFixed(3)})`
    )
    diskBase.addColorStop(
      0.24,
      isLoaf
        ? `rgba(246, 173, 62, ${(0.28 * local).toFixed(3)})`
        : `rgba(76, 188, 248, ${(0.26 * local).toFixed(3)})`
    )
    diskBase.addColorStop(
      0.62,
      isLoaf
        ? `rgba(180, 83, 9, ${(0.1 * local).toFixed(3)})`
        : `rgba(37, 99, 235, ${(0.09 * local).toFixed(3)})`
    )
    diskBase.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = diskBase
    ctx.beginPath()
    ctx.arc(0, 0, horizonScreenR * 3.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawAccretionPass(false)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const coronaGrad = ctx.createRadialGradient(
    cx,
    cy,
    horizonScreenR * 0.92,
    cx,
    cy,
    horizonScreenR * 2.2
  )
  coronaGrad.addColorStop(
    0,
    `rgba(255, 255, 255, ${(0.55 * local).toFixed(3)})`
  )
  coronaGrad.addColorStop(
    0.18,
    isLoaf
      ? `rgba(251, 191, 36, ${(0.38 * local).toFixed(3)})`
      : `rgba(125, 211, 252, ${(0.38 * local).toFixed(3)})`
  )
  coronaGrad.addColorStop(
    0.48,
    `rgba(148, 163, 184, ${(0.1 * local).toFixed(3)})`
  )
  coronaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = coronaGrad
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR * 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#010206'
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = isLoaf
    ? 'rgba(254, 243, 199, 0.72)'
    : 'rgba(224, 242, 254, 0.72)'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR * 1.02, 0, Math.PI * 2)
  ctx.stroke()

  drawAccretionPass(true)

  for (let w = 0; w < input.pulseWaves.length; w += 1) {
    const progress = input.pulseWaves[w]
    if (progress === undefined || progress <= 0 || progress >= 1) continue
    const waveWorldR = rsWorld * (1.15 + progress * 5.8)
    const waveAlpha = (1 - progress) * 0.68
    ctx.strokeStyle = isLoaf
      ? `rgba(251, 191, 36, ${waveAlpha.toFixed(3)})`
      : `rgba(56, 189, 248, ${waveAlpha.toFixed(3)})`
    ctx.lineWidth = 1.8 * (1 - progress * 0.5)
    ctx.beginPath()
    let started = false
    for (let s = 0; s <= 72; s += 1) {
      const ang = (s / 72) * Math.PI * 2
      const proj = project(
        Math.cos(ang) * waveWorldR,
        0,
        Math.sin(ang) * waveWorldR
      )
      if (!proj.visible) continue
      if (!started) {
        ctx.moveTo(proj.sx, proj.sy)
        started = true
      } else {
        ctx.lineTo(proj.sx, proj.sy)
      }
    }
    ctx.stroke()
  }

  renderCosmicHudOverlay(ctx, field, input, layout, false)
}
