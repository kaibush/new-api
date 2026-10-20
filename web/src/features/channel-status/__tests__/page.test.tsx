import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChannelStatus } from '..'
import { auditRate, getChannelStatus, type ChannelStatusData } from '../api'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getChannelStatus: vi.fn(),
}))
vi.mock('@/components/layout', () => {
  const Slot = (props: { children: ReactNode }) => <div>{props.children}</div>
  return {
    SectionPageLayout: Object.assign(Slot, {
      Title: Slot,
      Actions: Slot,
      Content: Slot,
    }),
  }
})
afterEach(cleanup)
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ChannelStatus />
    </QueryClientProvider>
  )
}
const populated: ChannelStatusData = {
  configured: true,
  summary: {
    name: 'GrokIQ',
    requestCount: 10,
    thinkingRequests: 7,
    thinkingSampleRequests: 8,
    httpSuccessRequests: 9,
  },
  clients: [
    {
      name: 'alice',
      requestCount: 2,
      thinkingRequests: 1,
      thinkingSampleRequests: 2,
      httpSuccessRequests: 2,
    },
  ],
}
describe('channel status page', () => {
  it('shows configuration guidance when integration is absent', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({ configured: false })
    renderPage()
    expect(
      await screen.findByText('GrokIQ is not configured')
    ).toBeInTheDocument()
  })
  it('loads the chosen window and shows quality and HTTP with distinct denominators', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue(populated)
    renderPage()
    expect(await screen.findByText('87.5%')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Time range' }),
      '3h'
    )
    await waitFor(() =>
      expect(getChannelStatus).toHaveBeenLastCalledWith(
        '3h',
        expect.any(AbortSignal)
      )
    )
  })
  it('shows no-sample markers and personal empty state instead of a passing rate', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      configured: true,
      summary: {
        name: 'GrokIQ',
        requestCount: 0,
        thinkingRequests: 0,
        thinkingSampleRequests: 0,
        httpSuccessRequests: 0,
      },
      clients: [],
    })
    renderPage()
    expect(
      await screen.findByText('No requests in this time range')
    ).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText('No matching client activity')).toBeInTheDocument()
  })
  it('retains audit cards when inventory fails and supports retry', async () => {
    vi.mocked(getChannelStatus).mockResolvedValue({
      ...populated,
      inventoryError: 'GrokIQ returned HTTP 503',
    })
    renderPage()
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('GrokIQ returned HTTP 503')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(getChannelStatus).toHaveBeenCalledTimes(2))
  })
  it('does not invent percentages for missing or inconsistent counts', () => {
    expect(auditRate(1, 0)).toBeNull()
    expect(auditRate(null, 10)).toBeNull()
    expect(auditRate(11, 10)).toBeNull()
    expect(auditRate(0, 10)).toBe(0)
  })
})
