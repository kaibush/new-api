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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { useStatus } from '@/hooks/use-status'
import { api } from '@/lib/api'

import { OAuthProviders } from '../components/oauth-providers'
import { SignUpForm } from '../sign-up/components/sign-up-form'

vi.mock('@/hooks/use-status', () => ({ useStatus: vi.fn() }))
vi.mock('../hooks/use-auth-redirect', () => ({
  useAuthRedirect: () => ({
    redirectToLogin: vi.fn(),
    handleLoginResult: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.mocked(useStatus).mockReturnValue({
    status: { oauth_register_enabled: false },
    loading: false,
    error: null,
  })
})

test.each([true, false])(
  'registration invitation input follows the global switch: %s',
  async (enabled) => {
    vi.mocked(useStatus).mockReturnValue({
      status: {
        registration_invitation_enabled: enabled,
        oauth_register_enabled: false,
      },
      loading: false,
      error: null,
    })
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const user = userEvent.setup()
    render(<SignUpForm />)
    const invitation = screen.queryByRole('textbox', {
      name: /Registration invitation code/,
    })
    if (enabled) {
      expect(invitation).toBeRequired()
      expect(invitation).toHaveAttribute('aria-invalid', 'true')
      await user.type(
        screen.getByRole('textbox', { name: /Registration invitation code/ }),
        ' registration-code-123456 '
      )
      expect(invitation).not.toHaveAttribute('aria-invalid')
    } else {
      expect(invitation).not.toBeInTheDocument()
    }
    await user.type(
      screen.getByRole('textbox', { name: 'Username' }),
      'invited-user'
    )
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'registered-password'
    )
    await user.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'registered-password'
    )
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/user/register',
        expect.objectContaining({
          username: 'invited-user',
          invitation_code: enabled ? 'registration-code-123456' : undefined,
        }),
        expect.anything()
      )
    )
  }
)

test('OAuth highlights a required invitation code and blocks provider buttons until it is entered', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data:
      url === '/api/oauth/state'
        ? { success: true, data: { flow_token: 'linuxdo-invitation' } }
        : { success: true },
  }))
  vi.spyOn(window, 'open').mockReturnValue(null)
  render(
    <OAuthProviders
      status={{
        github_oauth: true,
        github_client_id: 'github-client',
        linuxdo_oauth: true,
        linuxdo_client_id: 'linuxdo-client',
        registration_invitation_enabled: true,
      }}
    />
  )

  const invitation = screen.getByRole('textbox', {
    name: /Registration invitation code/,
  })
  const linuxdo = screen.getByRole('button', { name: /Continue with LinuxDO/ })
  const github = screen.getByRole('button', { name: /Continue with GitHub/ })
  expect(invitation).toBeRequired()
  expect(invitation).toHaveAttribute('aria-invalid', 'true')
  expect(invitation.closest('[data-slot="field"]')).toHaveAttribute(
    'data-invalid',
    'true'
  )
  expect(
    screen.getByText('A registration invitation code is required to continue.')
  ).toBeInTheDocument()
  expect(linuxdo).toBeDisabled()
  expect(github).toBeDisabled()

  await user.type(invitation, '   ')
  expect(linuxdo).toBeDisabled()
  expect(github).toBeDisabled()

  await user.clear(invitation)
  await user.type(invitation, 'registration-code-123456')
  expect(invitation).not.toHaveAttribute('aria-invalid')
  expect(
    screen.queryByText(
      'A registration invitation code is required to continue.'
    )
  ).not.toBeInTheDocument()
  expect(linuxdo).toBeEnabled()
  expect(github).toBeEnabled()

  await user.click(linuxdo)
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/oauth/state',
      expect.objectContaining({
        provider: 'linuxdo',
        invitation_code: 'registration-code-123456',
      }),
      expect.anything()
    )
  )
})

test('OAuth leaves provider buttons available when registration invitations are disabled', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data:
      url === '/api/oauth/state'
        ? { success: true, data: { flow_token: 'linuxdo-invitation' } }
        : { success: true },
  }))
  vi.spyOn(window, 'open').mockReturnValue(null)
  render(
    <OAuthProviders
      status={{
        linuxdo_oauth: true,
        linuxdo_client_id: 'linuxdo-client',
        registration_invitation_enabled: false,
      }}
    />
  )

  expect(
    screen.queryByRole('textbox', { name: /Registration invitation code/ })
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: /Continue with LinuxDO/ })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/oauth/state',
      expect.not.objectContaining({ invitation_code: expect.anything() }),
      expect.anything()
    )
  )
})
