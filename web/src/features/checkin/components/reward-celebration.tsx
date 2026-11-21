import { Crown, Flame, PartyPopper, Sparkles, Trophy, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { evaluateCheckinRoll } from '../lib/leaderboard-utils'

export interface CheckinSuccessPayload {
  quotaAwarded: number
  minQuota?: number
  maxQuota?: number
}

type ConfettiShape = 'ribbon' | 'coin' | 'star'

interface ConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  vr: number
  wobble: number
  wobbleSpeed: number
  color: string
  shape: ConfettiShape
  age: number
  maxAge: number
}

const CONFETTI_COLORS = [
  '#f59e0b',
  '#fbbf24',
  '#fde047',
  '#10b981',
  '#34d399',
  '#0ea5e9',
  '#f43f5e',
  '#8b5cf6',
] as const

const JACKPOT_COLORS = [
  '#f59e0b',
  '#fbbf24',
  '#fde047',
  '#fef08a',
  '#fb923c',
  '#10b981',
  '#f43f5e',
] as const

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  outerRadius: number,
  innerRadius: number
) {
  ctx.beginPath()
  for (let idx = 0; idx < 8; idx += 1) {
    const angle = (idx * Math.PI) / 4
    const radius = idx % 2 === 0 ? outerRadius : innerRadius
    const px = Math.cos(angle) * radius
    const py = Math.sin(angle) * radius
    if (idx === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.lineTo(px, py)
    }
  }
  ctx.closePath()
  ctx.fill()
}

export function CheckinConfettiBurst(props: {
  burstKey: number
  intensity?: 'standard' | 'jackpot'
}) {
  const shouldReduce = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [active, setActive] = useState(false)
  const intensity = props.intensity ?? 'standard'

  useEffect(() => {
    if (props.burstKey <= 0 || shouldReduce) {
      setActive(false)
      return
    }
    setActive(true)
  }, [props.burstKey, shouldReduce])

  useEffect(() => {
    if (!active || props.burstKey <= 0 || shouldReduce) return
    const canvas = canvasRef.current
    if (!canvas) return

    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      ctx = null
    }
    if (!ctx) {
      setActive(false)
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = Math.max(window.innerWidth, 320)
    let height = Math.max(window.innerHeight, 320)

    const syncSize = () => {
      width = Math.max(window.innerWidth, 320)
      height = Math.max(window.innerHeight, 320)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    syncSize()

    const palette = intensity === 'jackpot' ? JACKPOT_COLORS : CONFETTI_COLORS
    const totalCount = intensity === 'jackpot' ? 140 : 96
    const particles: ConfettiParticle[] = []

    for (let idx = 0; idx < totalCount; idx += 1) {
      const bucket = idx % 3
      let originX = width * 0.5
      let originY = height * 0.34
      let baseAngle = -Math.PI / 2
      let spread = Math.PI * 0.72
      let minSpeed = 6.5
      let maxSpeed = 15

      if (bucket === 0) {
        originX = width * 0.12
        originY = height * 0.8
        baseAngle = -Math.PI * 0.36
        spread = Math.PI * 0.26
        minSpeed = 11
        maxSpeed = 20
      } else if (bucket === 1) {
        originX = width * 0.88
        originY = height * 0.8
        baseAngle = -Math.PI * 0.64
        spread = Math.PI * 0.26
        minSpeed = 11
        maxSpeed = 20
      }

      const angle = baseAngle + (Math.random() - 0.5) * spread
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed)
      const shapeRoll = idx % 7
      let shape: ConfettiShape = 'ribbon'
      if (shapeRoll === 0) {
        shape = 'star'
      } else if (shapeRoll === 1) {
        shape = 'coin'
      }

      particles.push({
        x: originX + (Math.random() - 0.5) * 28,
        y: originY + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 5.5,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.22,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.08 + Math.random() * 0.09,
        color: shape === 'coin' ? '#fbbf24' : palette[idx % palette.length],
        shape,
        age: 0,
        maxAge: 125 + Math.random() * 65,
      })
    }

    let frameId = 0
    let lastTime = performance.now()

    const renderFrame = (now: number) => {
      const dt = Math.min(Math.max((now - lastTime) / 16.667, 0.4), 2.2)
      lastTime = now

      ctx.clearRect(0, 0, width, height)
      let aliveCount = 0

      for (const particle of particles) {
        particle.age += dt
        if (particle.age >= particle.maxAge) continue

        particle.vx *= Math.pow(0.986, dt)
        particle.vy = particle.vy * Math.pow(0.99, dt) + 0.26 * dt
        particle.wobble += particle.wobbleSpeed * dt
        particle.x += (particle.vx + Math.sin(particle.wobble) * 0.7) * dt
        particle.y += particle.vy * dt
        particle.rotation += particle.vr * dt

        if (particle.y > height + 40) continue
        aliveCount += 1

        const lifeRatio = particle.age / particle.maxAge
        const alpha = lifeRatio > 0.72 ? Math.max(0, (1 - lifeRatio) / 0.28) : 1

        ctx.save()
        ctx.translate(particle.x, particle.y)
        ctx.rotate(particle.rotation)
        ctx.globalAlpha = alpha
        ctx.fillStyle = particle.color

        if (particle.shape === 'star') {
          const twinkle = 0.75 + 0.25 * Math.sin(particle.wobble * 2)
          ctx.globalAlpha = alpha * twinkle
          drawFourPointStar(ctx, particle.size * 1.15, particle.size * 0.4)
        } else if (particle.shape === 'coin') {
          const tiltScale = Math.max(0.28, Math.abs(Math.cos(particle.wobble)))
          ctx.scale(tiltScale, 1)
          ctx.beginPath()
          ctx.arc(0, 0, particle.size * 0.72, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#fef08a'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(0, 0, particle.size * 0.45, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          const flipY = Math.cos(particle.wobble)
          ctx.scale(1, Math.abs(flipY) < 0.18 ? 0.18 : flipY)
          ctx.fillRect(
            -particle.size * 0.8,
            -particle.size * 0.42,
            particle.size * 1.6,
            particle.size * 0.84
          )
        }

        ctx.restore()
      }

      if (aliveCount > 0) {
        frameId = window.requestAnimationFrame(renderFrame)
      } else {
        ctx.clearRect(0, 0, width, height)
        setActive(false)
      }
    }

    window.addEventListener('resize', syncSize)
    frameId = window.requestAnimationFrame(renderFrame)

    return () => {
      window.removeEventListener('resize', syncSize)
      window.cancelAnimationFrame(frameId)
    }
  }, [active, intensity, props.burstKey, shouldReduce])

  if (!active || shouldReduce || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden='true'
      data-testid='checkin-confetti-canvas'
      className='pointer-events-none fixed inset-0 z-80 h-full w-full'
    />,
    document.body
  )
}

interface CheckinRewardRevealBannerProps {
  quotaAwarded: number
  minQuota?: number
  maxQuota?: number
  streakDays?: number
  actionLabel?: string
  onAction?: () => void
  onReplayConfetti?: () => void
  onDismiss?: () => void
  className?: string
}

export function CheckinRewardRevealBanner(
  props: CheckinRewardRevealBannerProps
) {
  const { t, i18n } = useTranslation()
  const shouldReduce = useReducedMotion()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [displayedQuota, setDisplayedQuota] = useState(() =>
    shouldReduce ? props.quotaAwarded : 0
  )

  useEffect(() => {
    if (shouldReduce) {
      setDisplayedQuota(props.quotaAwarded)
      return
    }
    const target = props.quotaAwarded
    const durationMs = 680
    const startTime = performance.now()
    let frameId = 0

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayedQuota(Math.round(target * eased))
      if (progress < 1) {
        frameId = window.requestAnimationFrame(step)
      } else {
        setDisplayedQuota(target)
      }
    }

    frameId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frameId)
  }, [props.quotaAwarded, shouldReduce])

  const roll = evaluateCheckinRoll(
    props.quotaAwarded,
    props.minQuota,
    props.maxQuota
  )

  let badgeToneClass =
    'border-sky-500/30 bg-sky-500/12 text-sky-800 dark:text-sky-300'
  let cardToneClass =
    'border-sky-500/30 from-sky-500/12 via-primary/5 to-card ring-sky-500/20'
  let glowClass = 'from-sky-400/24 to-transparent'
  let barClass = 'from-sky-500 to-cyan-400'
  let iconTone: IconBadgeTone = 'primary'
  let RollIcon = PartyPopper
  let rollLabel = t('Reward claimed')

  if (roll.tone === 'jackpot') {
    badgeToneClass =
      'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-200'
    cardToneClass =
      'border-amber-500/40 from-amber-500/16 via-amber-400/6 to-card ring-amber-500/25'
    glowClass = 'from-amber-400/30 to-transparent'
    barClass = 'from-amber-500 via-amber-400 to-yellow-300'
    iconTone = 'warning'
    RollIcon = Crown
    rollLabel = t('Jackpot roll')
  } else if (roll.tone === 'lucky') {
    badgeToneClass =
      'border-emerald-500/30 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'
    cardToneClass =
      'border-emerald-500/35 from-emerald-500/14 via-emerald-500/5 to-card ring-emerald-500/20'
    glowClass = 'from-emerald-400/25 to-transparent'
    barClass = 'from-emerald-500 to-teal-400'
    iconTone = 'success'
    RollIcon = Sparkles
    rollLabel = t('Lucky roll')
  }

  const content = (
    <div
      role='status'
      data-testid='checkin-reward-reveal'
      className={cn(
        'relative overflow-hidden rounded-xl border bg-gradient-to-r p-3.5 ring-1 sm:p-4',
        cardToneClass,
        props.className
      )}
    >
      {roll.tone === 'jackpot' && (
        <div
          aria-hidden='true'
          className='leaderboard-champion-border pointer-events-none absolute inset-0'
        />
      )}
      <div
        aria-hidden='true'
        className={cn(
          'pointer-events-none absolute -top-12 -left-10 size-36 rounded-full bg-radial blur-2xl',
          glowClass
        )}
      />

      <div className='relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex min-w-0 items-center gap-3'>
          <IconBadge tone={iconTone} size='lg' className='size-11 shrink-0'>
            <RollIcon className='size-5' />
          </IconBadge>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-1.5'>
              <Badge
                variant='outline'
                className={cn(
                  'h-5 px-2 text-[11px] font-semibold',
                  badgeToneClass
                )}
              >
                {rollLabel}
              </Badge>
              {props.streakDays !== undefined && props.streakDays >= 2 && (
                <Badge
                  variant='outline'
                  className='h-5 border-orange-500/30 bg-orange-500/10 px-1.5 text-[11px] text-orange-800 tabular-nums dark:text-orange-300'
                >
                  <Flame
                    data-icon='inline-start'
                    aria-hidden='true'
                    className='size-2.5 text-orange-500'
                  />
                  {t('{{count}}-day streak', {
                    count: formatNumber(props.streakDays, locale),
                  })}
                </Badge>
              )}
            </div>
            <p className='mt-1 text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl'>
              +{formatQuotaWithCurrency(displayedQuota)}
            </p>
          </div>
        </div>

        <div className='flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end'>
          {props.onAction && props.actionLabel && (
            <Button
              type='button'
              size='xs'
              variant='secondary'
              className='shadow-2xs'
              onClick={props.onAction}
            >
              <Trophy data-icon='inline-start' aria-hidden='true' />
              {props.actionLabel}
            </Button>
          )}
          {props.onReplayConfetti && (
            <TooltipProvider delay={120}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type='button'
                      size='icon-xs'
                      variant='outline'
                      aria-label={t('Replay confetti')}
                      className='bg-background/75'
                      onClick={props.onReplayConfetti}
                    >
                      <PartyPopper className='size-3.5' />
                    </Button>
                  }
                />
                <TooltipContent>{t('Replay confetti')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {props.onDismiss && (
            <Button
              type='button'
              size='icon-xs'
              variant='ghost'
              aria-label={t('Close')}
              onClick={props.onDismiss}
            >
              <X className='size-3.5' />
            </Button>
          )}
        </div>
      </div>

      {roll.hasRange &&
        roll.luckPercent !== null &&
        props.minQuota !== undefined &&
        props.maxQuota !== undefined && (
          <div className='border-border/50 relative mt-3 space-y-1.5 border-t pt-2.5'>
            <div className='text-muted-foreground flex items-center justify-between text-[11px] tabular-nums'>
              <span>{formatQuotaWithCurrency(props.minQuota)}</span>
              <span className='text-foreground/90 font-semibold'>
                {t('Luck {{percent}}%', {
                  percent: formatNumber(roll.luckPercent, locale),
                })}
              </span>
              <span>{formatQuotaWithCurrency(props.maxQuota)}</span>
            </div>
            <div
              aria-hidden='true'
              className='bg-muted/85 ring-foreground/8 relative h-2 w-full overflow-hidden rounded-full ring-1'
            >
              {shouldReduce ? (
                <div
                  className={cn(
                    'h-full rounded-full bg-gradient-to-r',
                    barClass
                  )}
                  style={{ width: `${Math.max(4, roll.luckPercent)}%` }}
                />
              ) : (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(4, roll.luckPercent)}%` }}
                  transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                  className={cn(
                    'h-full rounded-full bg-gradient-to-r',
                    barClass
                  )}
                />
              )}
            </div>
          </div>
        )}
    </div>
  )

  if (shouldReduce) {
    return content
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    >
      {content}
    </motion.div>
  )
}
