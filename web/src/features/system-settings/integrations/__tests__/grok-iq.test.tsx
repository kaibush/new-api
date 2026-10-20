import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { GrokIQSection } from '../grok-iq-section'

const save = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }))
vi.mock('../../hooks/use-update-option', () => ({
  useUpdateOption: () => ({ mutateAsync: save }),
}))
vi.mock('../../components/settings-page-context', () => ({
  useSuppressSettingsSectionHeader: () => false,
  SettingsPageFormActions: (props: {
    onSave: () => void
    isSaving: boolean
  }) => (
    <button type='button' disabled={props.isSaving} onClick={props.onSave}>
      Save
    </button>
  ),
}))
afterEach(() => {
  cleanup()
  save.mockClear()
})
it('saves a changed token and clears the input after success', async () => {
  render(<GrokIQSection baseURL='https://grokiq.example.com' />)
  const input = screen.getByLabelText('GrokIQ administrator token')
  await userEvent.type(input, 'replacement-token')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      key: 'GrokIQAdminToken',
      value: 'replacement-token',
    })
  )
  await waitFor(() => expect(input).toHaveValue(''))
})
it('keeps an existing token when the input is blank', async () => {
  render(<GrokIQSection baseURL='https://grokiq.example.com' />)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(save).not.toHaveBeenCalled()
})
it('rejects insecure addresses before saving credentials', async () => {
  render(<GrokIQSection baseURL='' />)
  await userEvent.type(
    screen.getByLabelText('GrokIQ base URL'),
    'http://grokiq.example.com'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText(
      'Enter an HTTPS base URL without credentials, query or fragment.'
    )
  ).toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
})
