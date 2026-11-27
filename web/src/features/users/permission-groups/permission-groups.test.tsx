import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { PermissionGroups } from '.'
import type { Policy } from './lib/policy'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPage() {
  let saved: Policy = {
    audiences: { staff: [22], support: [] },
    models: { preview: ['staff', 'support'], hidden: [] },
    groups: { internal: ['staff'] },
  }
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const data: Record<string, unknown> = {
      '/api/option/': [
        { key: 'CatalogVisibility', value: JSON.stringify(saved) },
      ],
      '/api/group/': ['default', 'internal'],
      '/api/channel/models_enabled': ['preview', 'new-model'],
    }
    return {
      data: {
        success: true,
        data: data[path] ?? { items: [{ id: 35, username: 'alice' }] },
      },
    }
  })
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, request) => {
      saved = JSON.parse((request as { value: string }).value)
      return { data: { success: true } }
    })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PermissionGroups />
    </QueryClientProvider>
  )
  return { user: userEvent.setup(), put, saved: () => saved }
}

function row(name: string) {
  return within(screen.getByRole('listitem', { name }))
}

it('creates a custom-named group in one submit, validates names and writes nothing on cancel', async () => {
  const { user, put, saved } = renderPage()
  const open = await screen.findByRole('button', {
    name: 'New permission group',
  })
  await user.click(open)
  const dialog = within(screen.getByRole('dialog'))
  const name = dialog.getByRole('textbox', { name: 'Group name' })
  await user.click(dialog.getByRole('button', { name: 'Create' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'Enter a group name.'
  )
  await user.type(name, ' staff ')
  await user.click(dialog.getByRole('button', { name: 'Create' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('already exists')
  await user.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(put).not.toHaveBeenCalled()
  await user.click(open)
  const create = within(screen.getByRole('dialog'))
  expect(create.getByRole('textbox', { name: 'Group name' })).toHaveValue('')
  await user.type(
    create.getByRole('textbox', { name: 'Group name' }),
    ' 内测组 '
  )
  await user.type(
    create.getByPlaceholderText('Search users by name or ID'),
    'alice'
  )
  await user.click(await screen.findByRole('option', { name: 'alice (#35)' }))
  await user.click(create.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(put).toHaveBeenCalledTimes(1)
  expect(put).toHaveBeenCalledWith(
    '/api/option/',
    expect.objectContaining({ key: 'CatalogVisibility' })
  )
  expect(saved().audiences).toEqual({ staff: [22], support: [], 内测组: [35] })
  expect(row('内测组').getByText(/1 members/)).toBeVisible()
})

it('renames a group, revokes membership, then confirms deletion without making resources public', async () => {
  const { user, put, saved } = renderPage()
  await screen.findByText('staff', { selector: 'li p.font-medium' })
  await user.click(row('staff').getByRole('button', { name: 'Edit' }))
  const dialog = within(screen.getByRole('dialog'))
  const name = dialog.getByRole('textbox', { name: 'Group name' })
  await user.clear(name)
  await user.type(name, 'review')
  await user.click(dialog.getByRole('button', { name: 'Remove user #22' }))
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('review', { selector: 'li p.font-medium' })
  expect(saved()).toEqual({
    audiences: { review: [], support: [] },
    models: { preview: ['support', 'review'], hidden: [] },
    groups: { internal: ['review'] },
  })
  await user.click(row('review').getByRole('button', { name: 'Delete' }))
  expect(put).toHaveBeenCalledTimes(1)
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(saved()).toEqual({
    audiences: { support: [] },
    models: { preview: ['support'], hidden: [] },
    groups: { internal: [] },
  })
})

it('only restores normal visibility after explicitly confirming removal of a rule', async () => {
  const { user, saved, put } = renderPage()
  await screen.findByText('hidden')
  await user.click(
    row('hidden').getByRole('button', { name: 'Remove restriction' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  expect(put).not.toHaveBeenCalled()
  await user.click(
    row('hidden').getByRole('button', { name: 'Remove restriction' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Remove restriction',
    })
  )
  await waitFor(() =>
    expect(saved().models).toEqual({ preview: ['staff', 'support'] })
  )
})

it('keeps the draft open when saving fails and supports retry', async () => {
  const { user, put, saved } = renderPage()
  put.mockRejectedValueOnce(new Error('offline'))
  await user.click(
    await screen.findByRole('button', { name: 'New permission group' })
  )
  const dialog = within(screen.getByRole('dialog'))
  const name = dialog.getByRole('textbox', { name: 'Group name' })
  await user.type(name, 'retry')
  await user.click(dialog.getByRole('button', { name: 'Create' }))
  expect(name).toHaveValue('retry')
  expect(saved().audiences).not.toHaveProperty('retry')
  await user.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(saved().audiences).toHaveProperty('retry'))
})
