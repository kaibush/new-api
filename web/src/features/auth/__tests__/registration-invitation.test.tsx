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
      name: 'Registration invitation code',
    })
    if (enabled) {
      expect(invitation).toBeRequired()
      await user.type(
        screen.getByRole('textbox', { name: 'Registration invitation code' }),
        ' registration-code-123456 '
      )
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

test.each(['', 'registration-code-123456'])(
  'OAuth keeps invitation optional and forwards entered codes: %s',
  async (invitationCode) => {
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
          registration_invitation_enabled: true,
        }}
      />
    )
    expect(
      screen.getByRole('textbox', { name: 'Registration invitation code' })
    ).not.toBeRequired()
    if (invitationCode) {
      await user.type(
        screen.getByRole('textbox', { name: 'Registration invitation code' }),
        invitationCode
      )
    }
    await user.click(
      screen.getByRole('button', { name: /Continue with LinuxDO/ })
    )
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/oauth/state',
        expect.objectContaining({ provider: 'linuxdo' }),
        expect.anything()
      )
    )
    const authorization = post.mock.calls.find(
      ([url]) => url === '/api/oauth/state'
    )
    if (invitationCode) {
      expect(authorization?.[1]).toHaveProperty(
        'invitation_code',
        invitationCode
      )
    } else {
      expect(authorization?.[1]).not.toHaveProperty('invitation_code')
    }
  }
)
