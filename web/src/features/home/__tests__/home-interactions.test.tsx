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
import { describe, expect, it, vi } from 'vitest'

import { Hero } from '../components/sections/hero'
import { ProtocolWorkbench } from '../components/sections/protocol-workbench'
import { ProviderConstellation } from '../components/sections/provider-constellation'
import { TidalAquariumStage } from '../components/tidal-aquarium-stage'
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

describe('TidalAquariumStage', () => {
  it('switches upstream buoys, deflects 429 storm to backup, feeds koi, and syncs protocol', () => {
    const onProtocolChange = vi.fn()
    render(
      <TidalAquariumStage mood='work' onProtocolChange={onProtocolChange} />
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

    fireEvent.click(screen.getByRole('button', { name: 'Simulate 429 Storm' }))
    expect(
      screen.getByRole('button', { name: 'Restore Calm' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(routeGroup).getByRole('button', { name: 'Claude' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Claude · claude-sonnet-4')).toBeVisible()
    expect(screen.getByText('429 Bypassed → Backup Smooth')).toBeVisible()
    expect(screen.getByText('Storms Above · Pure Zen Below')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Restore Calm' }))
    expect(screen.getByText('Zero Manual Babysitting')).toBeVisible()

    const koiBtn = screen.getByRole('button', {
      name: 'Swim with the coral koi',
    })
    expect(koiBtn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(koiBtn)
    expect(koiBtn).toHaveAttribute('aria-pressed', 'true')
    expect(koiBtn).toHaveAttribute('data-swimming', 'true')
    expect(
      screen.getByRole('button', { name: /Feed Koi\s*·\s*1/i })
    ).toBeVisible()

    const protocolGroup = screen.getByRole('group', {
      name: 'Select ingress protocol',
    })
    fireEvent.click(
      within(protocolGroup).getByRole('button', { name: 'Claude' })
    )
    expect(onProtocolChange).toHaveBeenCalledWith('claude')
    expect(screen.getByText('POST /v1/messages')).toBeVisible()
  })
})

describe('Hero', () => {
  it('switches between Work Mode and Loaf Mode and updates sanctuary copy', () => {
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
    expect(screen.getByText('40+ Models Standing By')).toBeVisible()

    fireEvent.click(loafBtn)
    expect(loafBtn).toHaveAttribute('aria-pressed', 'true')
    expect(workBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Paid Daydreaming Cleared')).toBeVisible()
    expect(
      screen.getByText('Loafing Sanctuary On · AI Running the Shift')
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
