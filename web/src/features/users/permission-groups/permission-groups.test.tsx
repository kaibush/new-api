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

function renderPage(initial?: Partial<Policy>) {
  let saved: Policy = {
    audiences: { staff: [22], support: [] },
    models: { preview: ['staff', 'support'], hidden: [] },
    groups: { internal: ['staff'] },
    ...initial,
  }
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const data: Record<string, unknown> = {
      '/api/option/': [
        { key: 'CatalogVisibility', value: JSON.stringify(saved) },
      ],
      '/api/group/': ['default', 'internal'],
      '/api/channel/models_enabled': ['preview', 'new-model'],
    }
    const keyword =
      new URL(path, 'http://localhost').searchParams.get('keyword') ?? ''
    const items = [
      { id: 35, username: 'alice' },
      { id: 36, username: 'alice-b' },
      { id: 48, username: 'bob' },
    ].filter(
      (account) =>
        account.username.includes(keyword) || String(account.id) === keyword
    )
    return {
      data: {
        success: true,
        data: data[path] ?? { items },
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
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(create.getByRole('combobox', { name: 'Group members' })).toHaveFocus()
  const assign = create.getByRole('button', {
    name: 'Assign to resource allowlists (optional)',
  })
  await user.click(assign)
  await user.click(
    create.getByRole('combobox', { name: 'Restricted routing groups' })
  )
  await user.click(await screen.findByRole('option', { name: 'default' }))
  await user.keyboard('{Escape}')
  await user.click(assign)
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
  expect(saved().groups).toEqual({ internal: ['staff'], default: ['内测组'] })
  expect(row('内测组').getByText(/1 members/)).toBeVisible()
})

it('renames a group, revokes membership, and supports keeping or clearing orphaned resources on delete', async () => {
  const { user, put, saved } = renderPage()
  await screen.findByRole('tab', { name: /Permission groups/ })
  await user.click(screen.getByRole('tab', { name: /Permission groups/ }))
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
    models: { preview: ['review', 'support'], hidden: [] },
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

  await user.click(row('support').getByRole('button', { name: 'Delete' }))
  const confirm = within(screen.getByRole('alertdialog'))
  await user.click(
    confirm.getByRole('checkbox', {
      name: 'Also restore default access for affected resources',
    })
  )
  await user.click(confirm.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
  expect(saved()).toEqual({
    audiences: {},
    models: { hidden: [] },
    groups: { internal: [] },
  })
})

it('reuses a named empty group in allowlists and exclusions and keeps both references when members change', async () => {
  const { user, saved } = renderPage()
  await user.click(
    await screen.findByRole('button', { name: 'New permission group' })
  )
  let dialog = within(screen.getByRole('dialog'))
  expect(
    dialog.queryByRole('combobox', { name: 'Restricted models' })
  ).not.toBeInTheDocument()
  await user.type(
    dialog.getByRole('textbox', { name: 'Group name' }),
    'reviewers'
  )
  await user.click(dialog.getByRole('button', { name: 'Create' }))
  await screen.findByRole('listitem', { name: 'reviewers' })
  expect(saved().audiences.reviewers).toEqual([])
  await user.click(screen.getByRole('tab', { name: /Model permissions/ }))

  await user.click(row('preview').getByRole('button', { name: 'Edit' }))
  dialog = within(screen.getByRole('dialog'))
  await user.click(
    dialog.getByRole('combobox', { name: 'Allowed permission groups' })
  )
  await user.click(
    await screen.findByRole('option', { name: 'reviewers (members: 0)' })
  )
  await user.keyboard('{Escape}')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await user.click(row('new-model').getByRole('button', { name: 'Configure' }))
  dialog = within(screen.getByRole('dialog'))
  await user.click(
    dialog.getByRole('combobox', { name: 'Excluded permission groups' })
  )
  await user.click(
    await screen.findByRole('option', { name: 'reviewers (members: 0)' })
  )
  await user.keyboard('{Escape}')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )

  await user.click(screen.getByRole('tab', { name: /Permission groups/ }))
  expect(row('reviewers').getByText(/0 members · 2 models/)).toBeVisible()
  await user.click(row('reviewers').getByRole('button', { name: 'Edit' }))
  dialog = within(screen.getByRole('dialog'))
  await user.type(
    dialog.getByRole('combobox', { name: 'Group members' }),
    'alice'
  )
  await user.click(await screen.findByRole('option', { name: 'alice (#35)' }))
  await user.click(screen.getByRole('option', { name: 'alice-b (#36)' }))
  await user.keyboard('{Escape}')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(saved().audiences.reviewers).toEqual([35, 36])
  expect(saved().models.preview).toEqual(['reviewers', 'staff', 'support'])
  expect(saved().model_excluded_groups).toEqual({ 'new-model': ['reviewers'] })
})

it('warns when resources are hidden from everyone and only restores visibility after confirming', async () => {
  const { user, saved, put } = renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Hidden from everyone')
  await user.click(within(alert).getByRole('button', { name: 'View hidden' }))
  expect(screen.queryByRole('listitem', { name: 'preview' })).toBeNull()
  expect(row('hidden').getByText('Hidden from everyone')).toBeVisible()

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

it('configures open-to-all-users rules with zero exclusions or exclusions, and direct account allowlists', async () => {
  const { user, saved } = renderPage()
  await screen.findByRole('listitem', { name: 'new-model' })

  await user.click(row('new-model').getByRole('button', { name: 'Configure' }))
  let dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('combobox', { name: 'Access mode' })).toHaveValue(
    'all_users'
  )
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(saved().open_models).toEqual(['new-model'])
  expect(row('new-model').getByText('All logged-in users')).toBeVisible()

  await user.click(row('new-model').getByRole('button', { name: 'Edit' }))
  dialog = within(screen.getByRole('dialog'))
  await user.selectOptions(
    dialog.getByRole('combobox', { name: 'Access mode' }),
    'allowlist'
  )
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'Select at least one allowed permission group or account'
  )

  const allowed = dialog.getByRole('combobox', { name: 'Allowed accounts' })
  allowed.focus()
  await user.paste('alice')
  expect(allowed).toHaveValue('alice')
  await user.click(await screen.findByRole('option', { name: 'alice (#35)' }))
  expect(allowed).toHaveValue('alice')
  await user.click(screen.getByRole('option', { name: 'alice-b (#36)' }))
  await user.click(
    screen.getByRole('option', { name: 'alice (#35)', selected: true })
  )
  expect(
    screen.getByRole('option', { name: 'alice (#35)', selected: false })
  ).toBeVisible()
  await user.clear(allowed)
  await user.type(allowed, '48')
  await user.click(await screen.findByRole('option', { name: 'bob (#48)' }))
  await user.keyboard('{Escape}')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(saved().open_models).toBeUndefined()
  expect(saved().model_users).toEqual({ 'new-model': [36, 48] })
  expect(row('new-model').getByText('Allowlist only')).toBeVisible()
})

it('supports batch model access configuration and retains exclusions when a group is deleted', async () => {
  const { user, saved } = renderPage({
    model_exclusions: { preview: [22] },
    group_exclusions: { archived: [35] },
  })
  await screen.findByRole('listitem', { name: 'preview' })

  await user.click(screen.getByRole('checkbox', { name: 'Select hidden' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select new-model' }))
  await user.click(screen.getByRole('button', { name: 'Batch configure' }))
  const dialog = within(screen.getByRole('dialog'))
  await user.type(
    dialog.getByPlaceholderText('Search users by name or ID'),
    'alice'
  )
  await user.click(await screen.findByRole('option', { name: 'alice (#35)' }))
  await user.click(screen.getByRole('option', { name: 'alice-b (#36)' }))
  await user.keyboard('{Escape}')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(saved().models).toEqual({ preview: ['staff', 'support'] })
  expect(saved().open_models).toEqual(['hidden', 'new-model'])
  expect(saved().model_exclusions).toEqual({
    preview: [22],
    hidden: [35, 36],
    'new-model': [35, 36],
  })

  await user.click(
    screen.getByRole('tab', { name: /Routing group permissions/ })
  )
  expect(row('archived').getByText(/Visible by default/)).toBeVisible()

  await user.click(screen.getByRole('tab', { name: /Permission groups/ }))
  await user.click(row('staff').getByRole('button', { name: 'Delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() => expect(saved().audiences).not.toHaveProperty('staff'))
  expect(saved().model_exclusions).toEqual({
    preview: [22],
    hidden: [35, 36],
    'new-model': [35, 36],
  })
  expect(saved().group_exclusions).toEqual({ archived: [35] })
  expect(saved().groups).toEqual({ internal: [] })
})
