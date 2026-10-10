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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { RiskAcknowledgementDialog } from '../risk-acknowledgement-dialog'

it('requires every repeated confirmation segment and retains independent input values', async () => {
  const confirm = vi.fn()
  const user = userEvent.setup()
  render(
    <RiskAcknowledgementDialog
      open
      onOpenChange={() => {}}
      title='Confirm action'
      onConfirm={confirm}
      confirmText='Confirm'
      requiredTextParts={[
        { type: 'static', text: '-' },
        { type: 'input', text: 'AGREE' },
        { type: 'static', text: '-' },
        { type: 'input', text: 'AGREE' },
      ]}
    />
  )
  const [first, second] = screen.getAllByRole('textbox')
  const button = screen.getByRole('button', { name: 'Confirm' })
  expect(button).toBeDisabled()
  await user.type(first, 'AGREE')
  expect(second).toHaveValue('')
  expect(button).toBeDisabled()
  await user.type(second, 'AGREE')
  expect(first).toHaveValue('AGREE')
  expect(button).toBeEnabled()
  await user.click(button)
  expect(confirm).toHaveBeenCalledOnce()
})
