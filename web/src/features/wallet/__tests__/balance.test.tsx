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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import { WalletStatsCard } from '../components/wallet-stats-card'
import type { UserWalletData } from '../types'

const user: UserWalletData = {
  id: 1,
  username: 'wallet-user',
  quota: 5500000,
  used_quota: 0,
  request_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  aff_count: 0,
  group: 'default',
}

test('wallet shows recharged and check-in balances separately without a combined balance', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { wallet_quota: 5000000, checkin_quota: 500000 },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <WalletStatsCard user={user} />
    </QueryClientProvider>
  )
  expect(
    await within(
      screen.getByRole('group', { name: 'Recharged quota' })
    ).findByText(formatQuota(5000000))
  ).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'Check-in quota' })).getByText(
      formatQuota(500000)
    )
  ).toBeVisible()
  expect(screen.queryByText(formatQuota(5500000))).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/api/user/checkin?balance_only=true')
  client.clear()
})

test('unknown check-in balances do not relabel the combined wallet amount as recharged quota', () => {
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}))
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <WalletStatsCard user={user} />
    </QueryClientProvider>
  )
  expect(
    within(screen.getByRole('group', { name: 'Recharged quota' })).getByText(
      '—'
    )
  ).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'Check-in quota' })).getByText('—')
  ).toBeVisible()
  expect(screen.queryByText(formatQuota(5500000))).not.toBeInTheDocument()
  client.clear()
})
