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
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CosmicSingularityStage } from '../components/cosmic-singularity-stage'
import { Hero } from '../components/sections/hero'
import { ProtocolWorkbench } from '../components/sections/protocol-workbench'
import { ProviderConstellation } from '../components/sections/provider-constellation'
import type { HomeMood, ProtocolId } from '../constants'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: ComponentProps<'a'> & { to?: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: {
      system_name: 'New API',
      docs_link: 'https://docs.newapi.pro',
    },
  }),
}))

function ControlledHero() {
  const [mood, setMood] = useState<HomeMood>('work')
  const [protocolId, setProtocolId] = useState<ProtocolId>('openai-chat')
  return (
    <Hero
      isAuthenticated={false}
      baseUrl='https://gateway.example.com'
      mood={mood}
      onMoodChange={setMood}
      selectedProtocolId={protocolId}
      onProtocolChange={setProtocolId}
    />
  )
}

function ControlledWorkbench() {
  const [protocolId, setProtocolId] = useState<ProtocolId>('openai-chat')
  return (
    <ProtocolWorkbench
      baseUrl='https://gateway.example.com'
      selectedProtocolId={protocolId}
      onProtocolChange={setProtocolId}
    />
  )
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CosmicSingularityStage', () => {
  it('switches star-gate relays, deflects 429 solar flares, locks onto the Pale Blue Dot beacon, resets 3D orbit, and syncs protocol', () => {
    const onProtocolChange = vi.fn()
    render(
      <CosmicSingularityStage mood='work' onProtocolChange={onProtocolChange} />
    )

    const routeGroup = screen.getByRole('group', {
      name: 'Upstream provider routes',
    })
    const openaiBtn = within(routeGroup).getByRole('button', {
      name: 'OpenAI',
    })
    const deepseekBtn = within(routeGroup).getByRole('button', {
      name: 'DeepSeek',
    })

    expect(openaiBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('OpenAI · gpt-5')).toBeVisible()

    fireEvent.click(deepseekBtn)
    expect(deepseekBtn).toHaveAttribute('aria-pressed', 'true')
    expect(openaiBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('DeepSeek · deepseek-reasoner')).toBeVisible()

    fireEvent.click(openaiBtn)
    expect(openaiBtn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Simulate 429 Flare' }))
    expect(
      screen.getByRole('button', { name: 'Restore Calm Orbit' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(routeGroup).getByRole('button', { name: 'Claude' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Claude · claude-sonnet-4')).toBeVisible()
    expect(screen.getByText('429 Bypassed → Backup Smooth')).toBeVisible()
    expect(
      screen.getByText('Flares Outside · Zero-G Peace Inside')
    ).toBeVisible()
    expect(screen.getByText('Magnetosphere Shield Engaged')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Restore Calm Orbit' }))
    expect(screen.getByText('Zero Manual Babysitting')).toBeVisible()

    const paleBlueDotBtn = screen.getByRole('button', {
      name: 'Focus on tiny you on the Pale Blue Dot',
    })
    expect(paleBlueDotBtn).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('button', { name: 'Reset 3D View' })
    ).not.toBeInTheDocument()

    fireEvent.click(paleBlueDotBtn)
    expect(paleBlueDotBtn).toHaveAttribute('aria-pressed', 'true')
    expect(paleBlueDotBtn).toHaveAttribute('data-orbiting', 'true')
    expect(
      screen.getByRole('button', { name: /Pulse Cosmos\s*·\s*1/i })
    ).toBeVisible()
    expect(
      screen.getByText(
        'Pale Blue Dot Capsule: Across 93 billion light-years, 429 rate-limits vanish at the shield—float back and daydream.'
      )
    ).toBeVisible()

    const resetOrbitBtn = screen.getByRole('button', { name: 'Reset 3D View' })
    expect(resetOrbitBtn).toBeVisible()
    fireEvent.click(resetOrbitBtn)
    expect(paleBlueDotBtn).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('button', { name: 'Reset 3D View' })
    ).not.toBeInTheDocument()

    const protocolGroup = screen.getByRole('group', {
      name: 'Select ingress protocol',
    })
    fireEvent.click(
      within(protocolGroup).getByRole('button', { name: 'Claude' })
    )
    expect(onProtocolChange).toHaveBeenCalledWith('claude')
    expect(screen.getByText('POST /v1/messages')).toBeVisible()
  })

  it('flies between cabin, orbit and galaxy camera views and hides orbit-only beacons outside orbit', () => {
    const { container } = render(<CosmicSingularityStage mood='work' />)
    const viewport = container.querySelector('.cosmic-imax-viewport')
    const viewGroup = screen.getByRole('group', { name: 'Camera view' })
    const cabinBtn = within(viewGroup).getByRole('button', {
      name: 'Inside the Pod',
    })
    const orbitBtn = within(viewGroup).getByRole('button', {
      name: 'Orbit View',
    })
    const galaxyBtn = within(viewGroup).getByRole('button', {
      name: 'Galaxy Scale',
    })

    expect(orbitBtn).toHaveAttribute('aria-pressed', 'true')
    expect(viewport).toHaveAttribute('data-view', 'orbit')
    expect(
      screen.getByRole('button', {
        name: 'Focus on tiny you on the Pale Blue Dot',
      })
    ).toBeVisible()

    fireEvent.click(cabinBtn)
    expect(cabinBtn).toHaveAttribute('aria-pressed', 'true')
    expect(orbitBtn).toHaveAttribute('aria-pressed', 'false')
    expect(viewport).toHaveAttribute('data-view', 'cabin')
    expect(viewport).toHaveAttribute('data-flight', 'true')
    expect(
      screen.queryByRole('button', {
        name: 'Focus on tiny you on the Pale Blue Dot',
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Pod Cabin: Tea floats past the canopy while the singularity relays every request outside.'
      )
    ).toBeVisible()

    fireEvent.click(galaxyBtn)
    expect(galaxyBtn).toHaveAttribute('aria-pressed', 'true')
    expect(viewport).toHaveAttribute('data-view', 'galaxy')
    expect(
      screen.getByText('100,000 LY spiral · your pod is one pixel')
    ).toBeVisible()
  })

  it('enters custom 3D camera orbit when dragging across the cosmic viewport', () => {
    const { container } = render(<CosmicSingularityStage mood='work' />)
    const viewport = container.querySelector('.cosmic-imax-viewport')
    expect(viewport).not.toBeNull()
    if (!viewport) return

    expect(
      screen.queryByRole('button', { name: 'Reset 3D View' })
    ).not.toBeInTheDocument()

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    })
    expect(viewport).toHaveAttribute('data-dragging', 'true')

    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 268,
      clientY: 172,
    })
    fireEvent.pointerUp(viewport, { pointerId: 1 })

    expect(viewport).toHaveAttribute('data-dragging', 'false')
    expect(screen.getByRole('button', { name: 'Reset 3D View' })).toBeVisible()
  })
})

describe('Hero', () => {
  it('switches between Work Mode and Loaf Mode and updates cosmic observatory copy', () => {
    render(<ControlledHero />)

    const moodGroup = screen.getByRole('group', {
      name: 'Switch homepage mood',
    })
    const workBtn = within(moodGroup).getByRole('button', {
      name: 'Work Mode',
    })
    const loafBtn = within(moodGroup).getByRole('button', {
      name: 'Loaf Mode',
    })

    expect(workBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('40+ Star Systems Standing By')).toBeVisible()
    expect(
      screen.getByText('Singularity Roaring · Tiny Speck Unwinding')
    ).toBeVisible()

    fireEvent.click(loafBtn)
    expect(loafBtn).toHaveAttribute('aria-pressed', 'true')
    expect(workBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Paid Daydreaming Cleared')).toBeVisible()
    expect(
      screen.getByText('Time Dilation On · AI Starfleet Running the Shift')
    ).toBeVisible()
  })
})

describe('ProtocolWorkbench', () => {
  it('keeps request and response panes auto-sized on narrow screens and switches protocols and SDKs', async () => {
    const user = userEvent.setup()
    render(<ControlledWorkbench />)

    const requestPane = screen.getByText('Request').parentElement?.parentElement
    const responsePane =
      screen.getByText('Response').parentElement?.parentElement
    expect(requestPane?.parentElement).toBe(responsePane?.parentElement)
    expect(requestPane?.parentElement).toHaveClass('grid-rows-[auto_auto]')

    fireEvent.click(screen.getByRole('button', { name: /Claude Messages/i }))
    expect(screen.getByText('/v1/messages', { selector: 'code' })).toBeVisible()
    expect(requestPane).toHaveTextContent('anthropic-version')
    expect(requestPane).toHaveTextContent(
      'https://gateway.example.com/v1/messages'
    )

    await user.click(screen.getByRole('tab', { name: 'TypeScript' }))
    expect(requestPane).toHaveTextContent(
      "baseURL: 'https://gateway.example.com'"
    )

    await user.click(screen.getByRole('tab', { name: 'Python' }))
    expect(requestPane).toHaveTextContent(
      'base_url="https://gateway.example.com"'
    )
  })
})

describe('ProviderConstellation', () => {
  it('filters featured provider cards by modality tab and updates the adapter count', async () => {
    const user = userEvent.setup()
    render(<ProviderConstellation />)

    expect(screen.getByText('Showing 16 featured adapters')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Image' }))
    expect(screen.getByText('Showing 3 featured adapters')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Midjourney' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Flux' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'OpenAI' })
    ).not.toBeInTheDocument()
  })
})
