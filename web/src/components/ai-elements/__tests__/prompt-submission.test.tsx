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
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import {
  PromptInput,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from '../prompt-input'

afterEach(() => vi.unstubAllGlobals())

it('reports attachment conversion failures and allows retrying the attached file', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  const errorToast = vi.spyOn(toast, 'error').mockReturnValue('test')
  const fetchFile = vi
    .fn()
    .mockRejectedValueOnce(new Error('Attachment unavailable'))
    .mockResolvedValue({
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    })
  vi.stubGlobal('fetch', fetchFile)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  render(
    <PromptInputProvider>
      <PromptInput onSubmit={submit}>
        <PromptInputTextarea aria-label='Message' />
        <PromptInputSubmit aria-label='Send' />
      </PromptInput>
    </PromptInputProvider>
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Message' }),
    'Describe this'
  )
  await user.upload(
    screen.getByLabelText('Upload files'),
    new File(['image'], 'image.png', { type: 'image/png' })
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(errorToast).toHaveBeenCalledWith('Attachment unavailable')
  )
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Describe this'
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      {
        text: 'Describe this',
        files: [
          expect.objectContaining({
            filename: 'image.png',
            url: expect.stringMatching(/^data:image\/png;base64,/),
          }),
        ],
      },
      expect.anything()
    )
  )
  expect(fetchFile).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
})
