import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FrontendRefreshDialog } from '../refresh-dialog'
import { refreshForRelease, useFrontendRelease } from '../store'

beforeEach(() => useFrontendRelease.setState({ release: null, dismissed: 0 }))
afterEach(() => vi.restoreAllMocks())
const release = {
  revision: 1,
  version: 'v1',
  notes: 'Update ready',
  published_at: 123,
}

test('new publication asks to refresh and later suppresses duplicates but not the next release', () => {
  render(<FrontendRefreshDialog />)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  act(() => useFrontendRelease.getState().receive(release))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('v1')
  expect(screen.getByRole('button', { name: 'Refresh now' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  act(() => useFrontendRelease.getState().receive(release))
  expect(useFrontendRelease.getState().dismissed).toBe(1)
  act(() =>
    useFrontendRelease
      .getState()
      .receive({ ...release, revision: 2, version: 'v2' })
  )
  expect(screen.getByRole('alertdialog')).toHaveTextContent('v2')
})

test('a delayed status response cannot replace a newer socket publication', () => {
  useFrontendRelease.getState().receive({ ...release, revision: 2 })
  useFrontendRelease.getState().receive(release)
  expect(useFrontendRelease.getState().release?.revision).toBe(2)
})

test('the publication stamped into the loaded document is not prompted again after reload', async () => {
  vi.resetModules()
  const meta = document.createElement('meta')
  meta.name = 'frontend-release'
  meta.content = '5'
  document.head.append(meta)
  try {
    const { useFrontendRelease: store } = await import('../store')
    store.getState().receive({ ...release, revision: 5 })
    expect(store.getState().release).toBeNull()
    store.getState().receive({ ...release, revision: 6 })
    expect(store.getState().release?.revision).toBe(6)
  } finally {
    meta.remove()
  }
})

test('refresh requests a document reload and records an acknowledgement for separately hosted pages', () => {
  const reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  try {
    refreshForRelease(9)
    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('frontend-release:refreshed')).toBe('9')
  } finally {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  }
})
