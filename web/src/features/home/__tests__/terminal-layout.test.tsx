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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HeroTerminalDemo } from '../components/hero-terminal-demo'

describe('homepage API panel', () => {
  it('lets narrow-screen request and response rows grow with wrapped content', () => {
    render(<HeroTerminalDemo />)
    const request = screen.getByText('Request').parentElement
    const response = screen.getByText('Response').parentElement
    expect(request?.parentElement).toBe(response?.parentElement)
    expect(request?.parentElement).toHaveClass('grid-rows-[auto_auto]')
    expect(request?.parentElement).not.toHaveClass('h-[400px]')
    expect(request?.parentElement).toHaveClass('sm:h-[400px]')
  })

  it('shows the Claude endpoint and request when its protocol is selected', async () => {
    render(<HeroTerminalDemo />)
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    await waitFor(() =>
      expect(
        screen.getByText('/v1/messages', { selector: 'code' })
      ).toBeVisible()
    )
    expect(screen.getByText(/anthropic-version/)).toBeVisible()
  })
})
