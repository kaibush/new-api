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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { CheckinGrantStatus } from '../components/grant-status'
import type { CheckinGrantSummary } from '../types'

const grants: CheckinGrantSummary = {
  available: 40,
  reserved: 10,
  used: 30,
  expired: 20,
  as_of: 1792838400,
  records: Array.from({ length: 21 }, (_, index) => ({
    checkin_id: index + 1,
    quota: 100,
    available: 40,
    reserved: 10,
    used: 30,
    expired: 20,
    created_at: Date.UTC(2026, 9, index + 1) / 1000,
    expires_at: Date.UTC(2026, 9, index + 1, 1) / 1000,
  })),
}

test('21 rewards display ten per page and allow keyboard navigation to the partial last page', async () => {
  const user = userEvent.setup()
  render(<CheckinGrantStatus grants={grants} />)
  const table = within(screen.getByRole('table'))
  expect(table.getAllByRole('row')).toHaveLength(11)
  expect(table.getByText('2026-10-01 00:00:00')).toBeVisible()
  expect(table.queryByText('2026-10-11 00:00:00')).not.toBeInTheDocument()
  expect(screen.getByText('1 / 3')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()

  screen.getByRole('button', { name: 'Go to next page' }).focus()
  await user.keyboard('{Enter}')
  expect(screen.getByText('2 / 3')).toBeVisible()
  expect(table.getAllByRole('row')).toHaveLength(11)
  expect(table.getByText('2026-10-11 00:00:00')).toBeVisible()
  expect(table.queryByText('2026-10-01 00:00:00')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(screen.getByText('3 / 3')).toBeVisible()
  expect(table.getAllByRole('row')).toHaveLength(2)
  expect(table.getByText('2026-10-21 00:00:00')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Go to previous page' }))
  expect(screen.getByText('2 / 3')).toBeVisible()
  expect(table.getByText('2026-10-11 00:00:00')).toBeVisible()
})

test.each([
  { name: 'null', records: null, empty: true },
  { name: 'empty', records: [], empty: true },
  {
    name: 'single reward',
    records: grants.records?.slice(0, 1) ?? [],
    empty: false,
  },
])(
  '$name records display a single page with navigation disabled',
  (fixture) => {
    render(
      <CheckinGrantStatus grants={{ ...grants, records: fixture.records }} />
    )
    expect(screen.getByText('1 / 1')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Go to previous page' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeDisabled()
    if (fixture.empty) {
      expect(screen.getByText('No records')).toBeVisible()
    } else {
      expect(screen.getByText('2026-10-01 00:00:00')).toBeVisible()
    }
  }
)

test('refreshing rewards keeps the current page while it remains available', async () => {
  const user = userEvent.setup()
  const view = render(<CheckinGrantStatus grants={grants} />)
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  view.rerender(
    <CheckinGrantStatus
      grants={{ ...grants, records: [...(grants.records ?? [])] }}
    />
  )
  expect(screen.getByText('2 / 3')).toBeVisible()
  expect(screen.getByText('2026-10-11 00:00:00')).toBeVisible()
})

test('fewer rewards after a refresh return to an available page', async () => {
  const user = userEvent.setup()
  const view = render(<CheckinGrantStatus grants={grants} />)
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  view.rerender(
    <CheckinGrantStatus
      grants={{ ...grants, records: grants.records?.slice(0, 1) ?? [] }}
    />
  )
  expect(screen.getByText('1 / 1')).toBeVisible()
  expect(screen.getByText('2026-10-01 00:00:00')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})
