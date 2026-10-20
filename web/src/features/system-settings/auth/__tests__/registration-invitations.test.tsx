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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { RegistrationInvitationsSection } from '../registration-invitations-section'

const unused = {
  id: 1,
  code_prefix: '01234567',
  code: `01234567${'a'.repeat(56)}`,
  created_at: 1700000000,
  expires_at: 4102444800,
  revoked_at: 0,
  used_at: 0,
  used_user_id: 0,
  username: '',
}
const used = {
  ...unused,
  id: 2,
  code_prefix: '89abcdef',
  code: `89abcdef${'b'.repeat(56)}`,
  used_at: 1700000100,
  used_user_id: 42,
  username: 'linuxdo-user',
}
const endpoint = '/api/option/registration-invitations'

function renderInvitations() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RegistrationInvitationsSection />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { items: [unused, used], total: 22 } },
  })
  vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } })
})

test('generates a batch, allows copying it, and rejects an invalid batch size', async () => {
  const user = userEvent.setup()
  const code = `01234567${'a'.repeat(56)}`
  vi.mocked(api.post).mockImplementation(async (url) => {
    if (url === `${endpoint}/`) return { data: { success: true, data: [code] } }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  renderInvitations()
  const generate = screen.getByRole('button', {
    name: 'Generate invitation codes',
  })
  await waitFor(() => expect(generate).toBeEnabled())
  await user.click(generate)
  expect(
    await screen.findByRole('textbox', { name: 'Generated invitation codes' })
  ).toHaveValue(code)
  expect(api.post).toHaveBeenCalledWith(`${endpoint}/`, { count: 10, days: 30 })
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  await user.click(
    screen.getByRole('button', { name: 'Copy invitation codes' })
  )
  expect(clipboard).toHaveBeenCalledWith(code)
  await user.clear(screen.getByRole('spinbutton', { name: 'Number of codes' }))
  await user.type(
    screen.getByRole('spinbutton', { name: 'Number of codes' }),
    '101'
  )
  await waitFor(() => expect(generate).toBeDisabled())
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(
    screen.queryByRole('textbox', { name: 'Generated invitation codes' })
  ).not.toBeInTheDocument()
})

test('shows the user who used a code, paginates, and searches with the code in the request body', async () => {
  const user = userEvent.setup()
  renderInvitations()
  expect(await screen.findByText('linuxdo-user (#42)')).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /89abcdef/ })).getByRole('button', {
      name: 'Disable',
    })
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(`${endpoint}/search`, {
      page: 2,
      code: '',
    })
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Find by invitation code' }),
    'full-registration-code'
  )
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(`${endpoint}/search`, {
      page: 1,
      code: 'full-registration-code',
    })
  )
})

test('disables an unused code only after confirmation', async () => {
  const user = userEvent.setup()
  renderInvitations()
  const row = await screen.findByRole('row', { name: /01234567/ })
  await user.click(within(row).getByRole('button', { name: 'Disable' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(api.delete).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Disable' }))
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${endpoint}/1`))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
})

test('shows loading and an error with retry, then an empty state after recovery', async () => {
  let rejectRequest!: (reason: Error) => void
  const pending = new Promise<never>((_resolve, reject) => {
    rejectRequest = reject
  })
  vi.mocked(api.post).mockReturnValueOnce(pending)
  renderInvitations()
  expect(screen.getByText('Loading...')).toBeVisible()
  await act(async () => rejectRequest(new Error('unavailable')))
  const retry = await screen.findByRole('button', { name: 'Retry' })
  vi.mocked(api.post).mockResolvedValue({
    data: { success: true, data: { items: [], total: 0 } },
  })
  await userEvent.setup().click(retry)
  expect(
    await screen.findByText('No registration invitations found')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

test('keeps a failed disable confirmation open and does not show codes after failed generation', async () => {
  const user = userEvent.setup()
  vi.mocked(api.delete).mockResolvedValue({
    data: { success: false, message: 'Unavailable' },
  })
  renderInvitations()
  await screen.findByText('01234567…')
  await user.click(
    within(screen.getByRole('row', { name: /01234567/ })).getByRole('button', {
      name: 'Disable',
    })
  )
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Disable',
    })
  )
  await waitFor(() =>
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Disable',
      })
    ).toBeEnabled()
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: false, message: 'Unavailable' },
  })
  await user.click(
    screen.getByRole('button', { name: 'Generate invitation codes' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate invitation codes' })
    ).toBeEnabled()
  )
  expect(
    screen.queryByRole('textbox', { name: 'Generated invitation codes' })
  ).not.toBeInTheDocument()
})

test('copies a saved invitation after opening the page and copies selected invitations in full', async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  renderInvitations()
  const row = await screen.findByRole('row', { name: /01234567/ })
  await user.click(
    within(row).getByRole('button', { name: 'Copy invitation code' })
  )
  expect(clipboard).toHaveBeenLastCalledWith(unused.code)
  await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await user.click(
    screen.getByRole('button', { name: 'Copy selected invitation codes' })
  )
  expect(clipboard).toHaveBeenLastCalledWith(`${unused.code}\n${used.code}`)
})

test('deletes a used invitation only after confirmation and refreshes the list', async () => {
  const user = userEvent.setup()
  renderInvitations()
  const row = await screen.findByRole('row', { name: /89abcdef/ })
  await user.click(within(row).getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(api.post).not.toHaveBeenCalledWith(
    `${endpoint}/delete`,
    expect.anything()
  )
  vi.mocked(api.post).mockImplementation(async (url) => {
    if (url === `${endpoint}/delete`) {
      return { data: { success: true, data: 1 } }
    }
    return { data: { success: true, data: { items: [unused], total: 1 } } }
  })
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(`${endpoint}/delete`, {
      ids: [used.id],
    })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('row', { name: /89abcdef/ })
    ).not.toBeInTheDocument()
  )
})

test('bulk deletion uses only selected IDs, preserves selection on failure, and clears it after success', async () => {
  const user = userEvent.setup()
  renderInvitations()
  await screen.findByRole('row', { name: /01234567/ })
  await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await user.click(screen.getByRole('button', { name: 'Delete selected' }))
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: false, message: 'Unavailable' },
  })
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() =>
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      })
    ).toBeEnabled()
  )
  expect(api.post).toHaveBeenCalledWith(`${endpoint}/delete`, {
    ids: [unused.id, used.id],
  })
  vi.mocked(api.post).mockImplementation(async (url) => {
    if (url === `${endpoint}/delete`) {
      return { data: { success: true, data: 2 } }
    }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  expect(
    await screen.findByText('No registration invitations found')
  ).toBeVisible()
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

test('legacy records explain unavailable full codes and cannot silently copy just their prefixes', async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: true,
      data: { items: [{ ...unused, code: '' }, used], total: 2 },
    },
  })
  renderInvitations()
  const row = await screen.findByRole('row', { name: /01234567/ })
  expect(
    within(row).queryByRole('button', { name: 'Copy invitation code' })
  ).not.toBeInTheDocument()
  expect(within(row).getByText('Full code unavailable')).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
  expect(
    screen.getByRole('button', { name: 'Copy selected invitation codes' })
  ).toBeDisabled()
  expect(clipboard).not.toHaveBeenCalled()
})

test('changing pages clears selection so bulk actions cannot target another page', async () => {
  const user = userEvent.setup()
  renderInvitations()
  const row = await screen.findByRole('row', { name: /01234567/ })
  const checkbox = within(row).getByRole('checkbox', { name: 'Select row' })
  checkbox.focus()
  await user.keyboard(' ')
  expect(checkbox).toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: 'Select all' })
  ).toBePartiallyChecked()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(`${endpoint}/search`, {
      page: 2,
      code: '',
    })
  )
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})
