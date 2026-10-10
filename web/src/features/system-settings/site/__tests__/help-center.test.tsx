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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { HelpCenterSection } from '../help-center-section'

afterEach(() =>
  document
    .querySelectorAll('[data-help-actions]')
    .forEach((element) => element.remove())
)

it('saves reordered and hidden help content through the existing settings API', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const actions = document.createElement('div')
  actions.dataset.helpActions = 'true'
  document.body.append(actions)
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <HelpCenterSection
          defaultValue={JSON.stringify({
            version: 1,
            items: [
              {
                id: 'guide',
                title: 'Guide',
                kind: 'markdown',
                content: '# Client setup',
                enabled: true,
              },
              {
                id: 'bird',
                title: 'Bird',
                kind: 'html',
                htmlViewMode: 'split',
                content: '<svg></svg>',
                enabled: true,
              },
            ],
          })}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await user.click(
    within(screen.getByRole('group', { name: 'Bird' })).getByRole('button', {
      name: 'Move up',
    })
  )
  await user.click(
    within(screen.getByRole('group', { name: 'Guide' })).getByRole('switch', {
      name: 'Visible',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  const request = put.mock.calls[0][1] as { key: string; value: string }
  expect(request.key).toBe('HelpCenter')
  expect(JSON.parse(request.value).items).toEqual([
    {
      id: 'bird',
      title: 'Bird',
      kind: 'html',
      htmlViewMode: 'split',
      content: '<svg></svg>',
      enabled: true,
    },
    {
      id: 'guide',
      title: 'Guide',
      kind: 'markdown',
      content: '# Client setup',
      enabled: false,
    },
  ])
  client.clear()
})

it.each([
  ['preview', 'Preview only'],
  ['split', 'Source comparison only'],
  ['both', 'Both views'],
])(
  'saves the %s HTML display mode and uses it in the settings preview',
  async (mode, label) => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const actions = document.createElement('div')
    actions.dataset.helpActions = 'true'
    document.body.append(actions)
    const client = new QueryClient()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <SettingsPageProvider actionsContainer={actions}>
          <HelpCenterSection
            defaultValue={JSON.stringify({
              version: 1,
              items: [
                {
                  id: 'bird',
                  title: 'Bird',
                  kind: 'html',
                  content: '<h1>Bird</h1>',
                  enabled: true,
                },
              ],
            })}
          />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
    const selector = screen.getByRole('combobox', { name: 'HTML display mode' })
    expect(selector).toHaveTextContent('Both views')
    await user.click(selector)
    await user.click(screen.getByRole('option', { name: label }))
    expect(selector).toHaveTextContent(label)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    const request = put.mock.calls[0][1] as { key: string; value: string }
    expect(request.key).toBe('HelpCenter')
    expect(JSON.parse(request.value).items[0].htmlViewMode).toBe(mode)
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    const preview = within(screen.getByRole('dialog', { name: 'Preview' }))
    expect(preview.getByTitle('Bird')).toBeVisible()
    if (mode === 'both') {
      expect(preview.getByRole('group', { name: 'View mode' })).toBeVisible()
    } else {
      expect(
        preview.queryByRole('group', { name: 'View mode' })
      ).not.toBeInTheDocument()
    }
    if (mode === 'split') {
      expect(
        preview.getByRole('textbox', { name: 'HTML source' })
      ).toBeVisible()
    } else {
      expect(
        preview.queryByRole('textbox', { name: 'HTML source' })
      ).not.toBeInTheDocument()
    }
    client.clear()
  }
)

it('offers display settings only for HTML and keeps the choice when changing content types', async () => {
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={null}>
        <HelpCenterSection
          defaultValue={JSON.stringify({
            version: 1,
            items: [
              {
                id: 'guide',
                title: 'Guide',
                kind: 'markdown',
                content: '# Guide',
                enabled: true,
              },
            ],
          })}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('combobox', { name: 'HTML display mode' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'Content type' }))
  await user.click(screen.getByRole('option', { name: 'HTML preview' }))
  const selector = screen.getByRole('combobox', { name: 'HTML display mode' })
  selector.focus()
  await user.keyboard('{Enter}{Home}{Enter}')
  expect(selector).toHaveTextContent('Preview only')
  await user.click(screen.getByRole('combobox', { name: 'Content type' }))
  await user.click(screen.getByRole('option', { name: 'External link' }))
  expect(
    screen.queryByRole('combobox', { name: 'HTML display mode' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'Content type' }))
  await user.click(screen.getByRole('option', { name: 'HTML preview' }))
  expect(
    screen.getByRole('combobox', { name: 'HTML display mode' })
  ).toHaveTextContent('Preview only')
  client.clear()
})

it('blocks invalid titles without submitting and supports adding a new item', async () => {
  const put = vi.spyOn(api, 'put')
  const actions = document.createElement('div')
  actions.dataset.helpActions = 'true'
  document.body.append(actions)
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <HelpCenterSection defaultValue='{"version":1,"items":[]}' />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Add help item' }))
  await user.clear(screen.getByRole('textbox', { name: 'Title' }))
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  client.clear()
})

it.each(['markdown', 'html'])(
  'uploads an image and inserts its permanent URL into %s content',
  async (kind) => {
    const imageURL = 'https://images.example.com/help-center/example.png'
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: { url: imageURL } } })
    const original =
      kind === 'html' ? '<html><body><h1>Guide</h1></body></html>' : '# Guide'
    const client = new QueryClient()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <SettingsPageProvider actionsContainer={null}>
          <HelpCenterSection
            defaultValue={JSON.stringify({
              version: 1,
              items: [
                {
                  id: 'guide',
                  title: 'Guide',
                  kind,
                  content: original,
                  enabled: true,
                },
              ],
            })}
          />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
    await user.upload(
      screen.getByLabelText('Upload image'),
      new File(['pixels'], 'image.png', { type: 'image/png' })
    )
    const expected =
      kind === 'html'
        ? `<html><body><h1>Guide</h1>\n<img src="${imageURL}" alt="" style="max-width:100%;height:auto">\n</body></html>`
        : `# Guide\n\n![](<${imageURL}>)\n`
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue(
        expected
      )
    )
    expect(post.mock.calls[0][0]).toBe('/api/option/help-center/images')
    expect(post.mock.calls[0][1]).toBeInstanceOf(FormData)
    client.clear()
  }
)

it('preserves content on upload failure and allows retrying the same image', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { url: 'https://images.example.com/retry.png' },
      },
    })
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={null}>
        <HelpCenterSection
          defaultValue={JSON.stringify({
            version: 1,
            items: [
              {
                id: 'guide',
                title: 'Guide',
                kind: 'markdown',
                content: '# Guide',
                enabled: true,
              },
            ],
          })}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const file = new File(['pixels'], 'image.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Upload image'), file)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Storage unavailable'
  )
  expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue(
    '# Guide'
  )
  await user.upload(screen.getByLabelText('Upload image'), file)
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue(
      '# Guide\n\n![](<https://images.example.com/retry.png>)\n'
    )
  )
  expect(post).toHaveBeenCalledTimes(2)
  client.clear()
})

it('keeps an in-flight upload attached to its article after reordering', async () => {
  let resolveUpload!: (value: unknown) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve
      })
  )
  const client = new QueryClient()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={null}>
        <HelpCenterSection
          defaultValue={JSON.stringify({
            version: 1,
            items: [
              {
                id: 'guide',
                title: 'Guide',
                kind: 'markdown',
                content: '# Guide',
                enabled: true,
              },
              {
                id: 'other',
                title: 'Other',
                kind: 'markdown',
                content: '# Other',
                enabled: true,
              },
            ],
          })}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const guide = within(screen.getByRole('group', { name: 'Guide' }))
  await user.upload(
    guide.getByLabelText('Upload image'),
    new File(['pixels'], 'image.png', { type: 'image/png' })
  )
  expect(guide.getByRole('button', { name: 'Uploading...' })).toBeDisabled()
  await user.click(guide.getByRole('button', { name: 'Move down' }))
  resolveUpload({
    data: {
      success: true,
      data: { url: 'https://images.example.com/guide.png' },
    },
  })
  await waitFor(() =>
    expect(guide.getByRole('textbox', { name: 'Content' })).toHaveValue(
      '# Guide\n\n![](<https://images.example.com/guide.png>)\n'
    )
  )
  expect(
    within(screen.getByRole('group', { name: 'Other' })).getByRole('textbox', {
      name: 'Content',
    })
  ).toHaveValue('# Other')
  client.clear()
})
