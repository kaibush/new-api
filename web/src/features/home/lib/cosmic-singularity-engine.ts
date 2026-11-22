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

export interface CosmicUniverseField {
  stars: readonly Star3D[]
  filaments: readonly AccretionFilament[]
  satellites: readonly OrbitalSatellite[]
}

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

  return { stars, filaments, satellites }
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
  const clampedAlpha = Math.max(0.03, Math.min(0.96, alpha))
  if (doppler > 0.28 && heat > 0.48) {
    if (isLoaf) {
      return `rgba(254, 243, 199, ${clampedAlpha.toFixed(3)})`
    }
    return `rgba(224, 242, 254, ${clampedAlpha.toFixed(3)})`
  }
  if (doppler > -0.1) {
    if (isLoaf) {
      return `rgba(251, 191, 36, ${clampedAlpha.toFixed(3)})`
    }
    return `rgba(56, 189, 248, ${clampedAlpha.toFixed(3)})`
  }
  if (heat > 0.4) {
    return `rgba(245, 158, 11, ${clampedAlpha.toFixed(3)})`
  }
  if (isLoaf) {
    return `rgba(167, 139, 250, ${clampedAlpha.toFixed(3)})`
  }
  return `rgba(251, 113, 133, ${clampedAlpha.toFixed(3)})`
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
  const beamGrad = ctx.createLinearGradient(0, -210, 0, 170)
  beamGrad.addColorStop(0, 'rgba(186, 230, 253, 0)')
  beamGrad.addColorStop(
    0.45,
    isLoaf ? 'rgba(253, 230, 138, 0.085)' : 'rgba(125, 211, 252, 0.075)'
  )
  beamGrad.addColorStop(0.55, 'rgba(255, 255, 255, 0.11)')
  beamGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
  ctx.fillStyle = beamGrad
  ctx.fillRect(-18, -210, 36, 380)
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

export function renderCosmicSingularityFrame(
  ctx: CanvasRenderingContext2D,
  field: CosmicUniverseField,
  input: CosmicSceneInput
): void {
  const { width, height, timeSec } = input
  if (width <= 0 || height <= 0) return

  const isLoaf = input.mood === 'loaf'
  const speedFactor = isLoaf ? 0.56 : 1.08
  const warp = Math.max(0, Math.min(1.5, input.warpEnergy))
  const simTime = timeSec * speedFactor

  const cx = width * 0.41
  const cy = height * 0.51
  const obsX = width * 0.81 + Math.sin(input.yaw - 0.08) * 18
  const obsY = height * 0.63 + Math.sin(input.pitch - 0.31) * 14

  const minDim = Math.min(width, height)
  const fov = minDim * 1.18
  const camDist = 6.2
  const roll = -0.155
  const rsWorld = 0.72
  const horizonScreenR = (rsWorld * fov) / camDist

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

  const pointerPx = input.pointerNormX * width
  const pointerPy = input.pointerNormY * height

  for (let i = 0; i < field.stars.length; i += 1) {
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
    const rPx = Math.max(0.45, star.radius * (proj.scale / (fov / camDist)))

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

  const drawOrbitalRingPass = (frontPass: boolean): void => {
    const segCount = 84
    for (let rIdx = 0; rIdx < ORBITAL_RINGS.length; rIdx += 1) {
      const ring = ORBITAL_RINGS[rIdx]
      if (!ring) continue
      const worldR = rsWorld * ring.radiusMult
      ctx.strokeStyle = ring.strokeColor
      ctx.lineWidth = rIdx === 0 ? 1.15 : 0.9
      ctx.beginPath()
      let penDown = false
      for (let s = 0; s <= segCount; s += 1) {
        const ang = (s / segCount) * Math.PI * 2
        const pt3 = rotateRingPoint(worldR, ang, ring.incX, ring.incZ)
        const proj = project(pt3.x, pt3.y, pt3.z)
        const isFront = proj.zRot <= 0
        if (!proj.visible || isFront !== frontPass) {
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

    for (let i = 0; i < field.satellites.length; i += 1) {
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
      const isFront = proj.zRot <= 0
      if (!proj.visible || isFront !== frontPass) continue
      const satColor = SATELLITE_COLORS[sat.hueIndex] ?? '#38bdf8'
      const dotR = Math.max(0.9, sat.size * (proj.scale / (fov / camDist)))
      ctx.fillStyle = satColor
      ctx.globalAlpha = isFront ? 0.88 : 0.46
      ctx.beginPath()
      ctx.arc(proj.sx, proj.sy, dotR, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  const drawPolarJet = (signY: 1 | -1, frontPass: boolean): void => {
    const tipWorldY = signY * rsWorld * 3.6
    const tipProj = project(0, tipWorldY, 0)
    const baseProj = project(0, signY * rsWorld * 0.92, 0)
    if (!tipProj.visible || !baseProj.visible) return
    const isFront = tipProj.zRot <= 0
    if (isFront !== frontPass) return

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const jetGrad = ctx.createLinearGradient(
      baseProj.sx,
      baseProj.sy,
      tipProj.sx,
      tipProj.sy
    )
    jetGrad.addColorStop(
      0,
      isLoaf ? 'rgba(251, 191, 36, 0.42)' : 'rgba(125, 211, 252, 0.5)'
    )
    jetGrad.addColorStop(0.45, 'rgba(129, 140, 248, 0.2)')
    jetGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.strokeStyle = jetGrad
    ctx.lineWidth = horizonScreenR * 0.34
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(baseProj.sx, baseProj.sy)
    ctx.lineTo(tipProj.sx, tipProj.sy)
    ctx.stroke()
    ctx.restore()
  }

  const drawAccretionPass = (frontPass: boolean): void => {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'

    for (let i = 0; i < field.filaments.length; i += 1) {
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
        (0.18 + fil.heat * 0.42) * (1 + doppler * 0.52) * boost

      ctx.strokeStyle = pickFilamentStroke(
        fil.heat,
        doppler,
        isLoaf,
        dopplerAlpha
      )
      ctx.lineWidth = Math.max(
        0.65,
        fil.thickness * (pMid.scale / (fov / camDist))
      )
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.quadraticCurveTo(mx, my, bx, by)
      ctx.stroke()

      // Secondary relativistic underside Einstein-ring arc
      if (!frontPass && fil.heat > 0.42 && i % 2 === 0) {
        const mirrorScale = 0.78
        const uAx = cx + (ax - cx) * mirrorScale
        const uAy = cy - (ay - cy) * mirrorScale
        const uMx = cx + (mx - cx) * mirrorScale
        const uMy = cy - (my - cy) * mirrorScale
        const uBx = cx + (bx - cx) * mirrorScale
        const uBy = cy - (by - cy) * mirrorScale
        const uDist = Math.hypot(uMx - cx, uMy - cy)
        if (uDist > horizonScreenR * 1.03 && uDist < horizonScreenR * 1.72) {
          ctx.strokeStyle = pickFilamentStroke(
            fil.heat,
            doppler,
            isLoaf,
            dopplerAlpha * 0.58
          )
          ctx.lineWidth = Math.max(0.55, fil.thickness * 0.62)
          ctx.beginPath()
          ctx.moveTo(uAx, uAy)
          ctx.quadraticCurveTo(uMx, uMy, uBx, uBy)
          ctx.stroke()
        }
      }
    }

    ctx.restore()
  }

  drawOrbitalRingPass(false)
  drawPolarJet(-1, false)
  drawPolarJet(1, false)
  drawAccretionPass(false)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const coronaGrad = ctx.createRadialGradient(
    cx,
    cy,
    horizonScreenR * 0.92,
    cx,
    cy,
    horizonScreenR * 2.35
  )
  coronaGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)')
  coronaGrad.addColorStop(
    0.14,
    isLoaf ? 'rgba(251, 191, 36, 0.62)' : 'rgba(125, 211, 252, 0.62)'
  )
  coronaGrad.addColorStop(0.42, 'rgba(245, 158, 11, 0.24)')
  coronaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = coronaGrad
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR * 2.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#010206'
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = isLoaf
    ? 'rgba(254, 243, 199, 0.88)'
    : 'rgba(224, 242, 254, 0.9)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR * 1.02, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = isLoaf
    ? 'rgba(251, 191, 36, 0.34)'
    : 'rgba(56, 189, 248, 0.36)'
  ctx.lineWidth = 0.95
  ctx.beginPath()
  ctx.arc(cx, cy, horizonScreenR * 1.11, 0, Math.PI * 2)
  ctx.stroke()

  drawAccretionPass(true)
  drawPolarJet(-1, true)
  drawPolarJet(1, true)
  drawOrbitalRingPass(true)

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
      const ctrlX = (cx + relayProj.sx) * 0.5
      const ctrlY = Math.min(cy, relayProj.sy) - horizonScreenR * 0.85

      ctx.save()
      ctx.strokeStyle = input.activeAccent
      ctx.globalAlpha = 0.58
      ctx.lineWidth = 1.7
      ctx.setLineDash([7, 8])
      ctx.lineDashOffset = -timeSec * 46
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(ctrlX, ctrlY, relayProj.sx, relayProj.sy)
      ctx.stroke()

      ctx.globalAlpha = 0.28
      ctx.lineWidth = 1.05
      ctx.setLineDash([4, 9])
      ctx.lineDashOffset = -timeSec * 28
      ctx.beginPath()
      ctx.moveTo(relayProj.sx, relayProj.sy)
      ctx.quadraticCurveTo(
        (relayProj.sx + obsX) * 0.52,
        Math.min(relayProj.sy, obsY) - 34,
        obsX,
        obsY
      )
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = input.activeAccent
      ctx.beginPath()
      ctx.arc(relayProj.sx, relayProj.sy, 4.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = input.activeAccent
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(
        relayProj.sx,
        relayProj.sy,
        9 + Math.sin(timeSec * 3.2) * 2,
        0,
        Math.PI * 2
      )
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  if (input.stormActive) {
    const shieldX = cx + horizonScreenR * 1.95
    const shieldY = cy - horizonScreenR * 1.15
    ctx.save()
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.78)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(shieldX, shieldY, 28, -Math.PI * 0.72, Math.PI * 0.28)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(251, 113, 133, 0.72)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 6])
    ctx.lineDashOffset = -timeSec * 68
    ctx.beginPath()
    ctx.moveTo(width * 0.14, height * 0.08)
    ctx.lineTo(shieldX - 4, shieldY - 6)
    ctx.lineTo(width * 0.31, height * 0.04)
    ctx.stroke()
    ctx.restore()
  }

  const scaleLineY = obsY + 26
  const scaleStartX = cx + horizonScreenR * 1.35
  if (obsX - scaleStartX > 90) {
    ctx.save()
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)'
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 6])
    ctx.beginPath()
    ctx.moveTo(scaleStartX, scaleLineY)
    ctx.lineTo(obsX - 18, scaleLineY)
    ctx.stroke()
    ctx.restore()
  }

  drawPaleBlueDotAndAstronaut(
    ctx,
    obsX,
    obsY,
    timeSec,
    isLoaf,
    input.stormActive
  )

  if (input.pointerInside) {
    ctx.save()
    ctx.strokeStyle = isLoaf
      ? 'rgba(251, 191, 36, 0.28)'
      : 'rgba(125, 211, 252, 0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(pointerPx, pointerPy, 22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}
