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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { PaymentSettingsSection } from '../payment-settings-section'

function Fixture(props: { enabled: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <PaymentSettingsSection
          defaultValues={{
            PayAddress: '',
            EpayId: '',
            EpayKey: '',
            Price: 1,
            MinTopUp: 1,
            MonthlyTopUpLimitEnabled: props.enabled,
            MonthlyTopUpLimit: 1000,
            CustomCallbackAddress: '',
            PayMethods: '[]',
            AmountOptions: '[]',
            AmountDiscount: '{}',
            StripeApiSecret: '',
            StripeWebhookSecret: '',
            StripePriceId: '',
            StripeUnitPrice: 1,
            StripeMinTopUp: 1,
            StripePromotionCodesEnabled: false,
            CreemApiKey: '',
            CreemWebhookSecret: '',
            CreemTestMode: false,
            CreemProducts: '[]',
          }}
          waffoDefaultValues={{
            WaffoEnabled: false,
            WaffoApiKey: '',
            WaffoPrivateKey: '',
            WaffoPublicCert: '',
            WaffoSandboxPublicCert: '',
            WaffoSandboxApiKey: '',
            WaffoSandboxPrivateKey: '',
            WaffoSandbox: false,
            WaffoMerchantId: '',
            WaffoCurrency: 'USD',
            WaffoUnitPrice: 1,
            WaffoMinTopUp: 1,
            WaffoNotifyUrl: '',
            WaffoReturnUrl: '',
            WaffoPayMethods: '[]',
          }}
          waffoPancakeDefaultValues={{
            WaffoPancakeMerchantID: '',
            WaffoPancakePrivateKey: '',
            WaffoPancakeReturnURL: '',
          }}
          complianceDefaults={{
            confirmed: true,
            termsVersion: 'v1',
            confirmedAt: 0,
            confirmedBy: 1,
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings(enabled = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <Fixture enabled={enabled} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('spinbutton', {
    name: 'Monthly top-up limit per user (USD)',
  })
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

test('enabling the monthly limit by keyboard unlocks the input and saves the amount before the switch', async () => {
  const user = userEvent.setup()
  const input = await renderSettings()
  expect(input).toBeDisabled()
  const toggle = screen.getByRole('switch', {
    name: 'Limit monthly top-ups per user',
  })
  expect(toggle).not.toBeChecked()
  toggle.focus()
  await user.keyboard('[Space]')
  expect(toggle).toBeChecked()
  expect(input).toBeEnabled()
  fireEvent.change(input, { target: { value: '250.50' } })
  await user.click(screen.getByRole('button', { name: 'Save all settings' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenLastCalledWith('/api/option/', {
      key: 'payment_setting.monthly_topup_limit_enabled',
      value: true,
    })
  )
  expect(api.put).toHaveBeenNthCalledWith(1, '/api/option/', {
    key: 'payment_setting.monthly_topup_limit',
    value: 250.5,
  })
})

test.each(['0', '-1'])(
  'an enabled limit of %s shows validation and does not save',
  async (value) => {
    const input = await renderSettings(true)
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save all settings' }))
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(
      screen.getByText(
        'Monthly top-up limit must be a finite amount greater than 0'
      )
    ).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  }
)

test('disabling a saved monthly limit preserves the configured amount', async () => {
  const user = userEvent.setup()
  const input = await renderSettings(true)
  expect(input).toBeEnabled()
  expect(input).toHaveValue(1000)
  await user.click(
    screen.getByRole('switch', { name: 'Limit monthly top-ups per user' })
  )
  expect(input).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save all settings' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'payment_setting.monthly_topup_limit_enabled',
      value: false,
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})
