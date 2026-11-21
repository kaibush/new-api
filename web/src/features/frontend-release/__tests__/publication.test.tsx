import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { PublishFrontendReleaseSection } from '../publish-section'

afterEach(() => vi.restoreAllMocks())

test('publishing requires a version and confirmation, and preserves input after a failed request', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { revision: 0 } },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      data: { success: true, data: { revision: 1, version: 'v2' } },
    })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PublishFrontendReleaseSection />
    </QueryClientProvider>
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Publish version notification' })
  )
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Version' })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  )
  expect(post).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Version' }), {
    target: { value: 'v2' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Release notes' }), {
    target: { value: 'Changes' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Publish version notification' })
  )
  const dialog = await screen.findByRole('alertdialog')
  expect(post).not.toHaveBeenCalled()
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Publish version notification' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', {
        name: 'Publish version notification',
      })
    ).toBeEnabled()
  )
  expect(
    screen.getByRole('textbox', { name: 'Version', hidden: true })
  ).toHaveValue('v2')
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Publish version notification' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post).toHaveBeenLastCalledWith('/api/option/frontend-release', {
    version: 'v2',
    notes: 'Changes',
  })
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(screen.getByText(/Latest published version/)).toHaveTextContent('v2')
})
