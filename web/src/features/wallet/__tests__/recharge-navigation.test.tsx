import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import {
  parseHeaderNavModules as parseSettings,
  serializeHeaderNavModules,
} from '@/features/system-settings/maintenance/config'
import { api } from '@/lib/api'
import { parseHeaderNavModules } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

import '../index'
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
        monthly_topup_limit: {
          enabled: true,
          limit_quota: 500_000_000,
          used_quota: 0,
          pending_quota: 11_000_000,
          remaining_quota: 489_000_000,
        },
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
  expect(screen.getByText('Remaining top-up allowance this month: $978')).toBeVisible()
  expect(screen.getByText('Monthly limit: $1,000 · Credited: $0 · Pending orders: $22')).toBeVisible()
  expect(screen.queryByText('Affiliate Rewards')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'Online Top-up' })).toHaveFocus()
  client.clear()
})

it('an over-limit top-up shows the remaining allowance and accepts a reduced amount', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'user', role: 10 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = {}
    if (url === '/api/user/self') data = { id: 1, username: 'user', role: 10 }
    if (url === '/api/user/topup/info') {
      data = {
        enable_online_topup: true,
        enable_redemption: true,
        amount_options: [],
        pay_methods: [{ name: 'Test Pay', type: 'alipay' }],
        discount: {},
        min_topup: 1,
      }
    }
    return { data: { success: true, data } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (_url, request) => {
    const amount = (request as { amount: number }).amount
    if (amount <= 978) {
      return { data: { message: 'success', data: amount.toFixed(2) } }
    }
    return { data: {
      message: 'error',
      data: 'monthly limit exceeded',
      code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED',
      monthly_topup_limit: {
        enabled: true,
        limit_quota: 500_000_000,
        used_quota: 0,
        pending_quota: 11_000_000,
        remaining_quota: 489_000_000,
      },
    } }
  })
  const notify = vi.spyOn(toast, 'error').mockReturnValue('monthly-limit')
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
  await user.click(screen.getByRole('button', { name: 'Online Top-up' }))
  const amount = await screen.findByRole('spinbutton', { name: 'Custom Amount' })
  await user.clear(amount)
  await user.type(amount, '1000')
  await user.click(await screen.findByRole('button', { name: 'Test Pay' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Test Pay' })).toBeEnabled()
  )
  expect(notify).toHaveBeenCalledWith(
    'This top-up exceeds your remaining monthly allowance. You can still add $978; $0 credited and $22 reserved by pending orders this month.'
  )
  expect(
    screen.queryByRole('alertdialog', { name: 'Confirm Payment' })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalledWith(
    '/api/user/pay',
    expect.anything(),
    expect.anything()
  )
  const reducedAmount = await screen.findByRole('spinbutton', { name: 'Custom Amount' })
  await user.clear(reducedAmount)
  await user.type(reducedAmount, '978')
  await user.click(screen.getByRole('button', { name: 'Test Pay' }))
  expect(await screen.findByRole('alertdialog', { name: 'Confirm Payment' })).toBeVisible()
  client.clear()
})
