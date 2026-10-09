import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import {
  parseHeaderNavModules as parseSettings,
  serializeHeaderNavModules,
} from '@/features/system-settings/maintenance/config'
import { api } from '@/lib/api'
import { parseHeaderNavModules } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

import { RechargeNavButton } from '../components/recharge-nav-button'

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.setUser(null)
})

it('preserves the recharge visibility switch through saved navigation settings', () => {
  expect(parseHeaderNavModules('{}').topup).toBe(true)
  const config = parseSettings('{"topup":false}')
  expect(parseHeaderNavModules(serializeHeaderNavModules(config)).topup).toBe(
    false
  )
})

it('opens wallet recharge on keyboard activation and closes with Escape', async () => {
  await import('../index')
  useAuthStore.getState().auth.setUser({ id: 1, username: 'user', role: 10 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = {}
    if (url === '/api/user/self') data = { id: 1, username: 'user', role: 10 }
    if (url === '/api/user/topup/info') {
      data = {
        enable_online_topup: false,
        enable_redemption: true,
        amount_options: [],
        pay_methods: [],
        discount: {},
        min_topup: 1,
      }
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: 1 } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {})
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <RechargeNavButton />
    </QueryClientProvider>
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(
    await screen.findByRole('dialog', { name: 'Online Top-up' })
  ).toBeVisible()
  expect(
    await screen.findByPlaceholderText('Enter your redemption code')
  ).toBeVisible()
  expect(screen.queryByText('Affiliate Rewards')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'Online Top-up' })).toHaveFocus()
  client.clear()
})
