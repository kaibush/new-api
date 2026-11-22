import { useRef, type PointerEvent, type ReactNode } from 'react'

import { AnimateInView } from '@/components/animate-in-view'
import { cn } from '@/lib/utils'

interface CosmicTiltCardProps {
  children: ReactNode
  className?: string
  wrapperClassName?: string
  delay?: number
  maxTiltDeg?: number
}

export function CosmicTiltCard(props: CosmicTiltCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const maxTilt = props.maxTiltDeg ?? 4.5

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const el = cardRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const nx = (event.clientX - rect.left) / rect.width
    const ny = (event.clientY - rect.top) / rect.height
    const rotateY = (nx - 0.5) * maxTilt * 2
    const rotateX = (0.5 - ny) * maxTilt * 2
    el.style.setProperty('--rx', `${rotateX.toFixed(2)}deg`)
    el.style.setProperty('--ry', `${rotateY.toFixed(2)}deg`)
    el.style.setProperty('--gx', `${(nx * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${(ny * 100).toFixed(1)}%`)
    el.dataset.tilting = 'true'
  }

  const handlePointerLeave = (): void => {
    const el = cardRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    delete el.dataset.tilting
  }

  return (
    <AnimateInView
      animation='fade-up'
      delay={props.delay}
      className={props.wrapperClassName}
    >
      <div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={cn('cosmic-tilt-card h-full', props.className)}
      >
        {props.children}
      </div>
    </AnimateInView>
  )
}
