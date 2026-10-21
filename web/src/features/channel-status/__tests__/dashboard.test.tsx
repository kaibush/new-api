import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'

import type { Health, Usage } from '../dashboard-types'
import { HealthDashboard } from '../health-dashboard'
import { UsageDashboard } from '../usage-dashboard'

const health: Health = {
  enabled: true,
  generatedAt: null,
  asOf: null,
  stale: false,
  windows: {
    '15m': {
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
    },
    '30m': {
      requests: 10,
      successfulRequests: 10,
      failedRequests: 0,
      successRate: 100,
    },
    '1h': {
      requests: 20,
      successfulRequests: 19,
      failedRequests: 1,
      successRate: 95,
    },
  },
  series: [],
  models: [
    {
      model: 'smaller',
      requests: 1,
      successfulRequests: 0,
      failedRequests: 1,
      successRate: 0,
      mainError: {
        statusCode: 200,
        errorCode: 'client_stream_interrupted',
        requests: 1,
      },
    },
    {
      model: 'larger',
      requests: 19,
      successfulRequests: 19,
      failedRequests: 0,
      successRate: 100,
      mainError: {
        statusCode: 200,
        errorCode: 'quality_degraded',
        requests: 1,
      },
    },
  ],
  errors: [
    { statusCode: 200, errorCode: 'client_stream_interrupted', requests: 1 },
    { statusCode: 200, errorCode: 'quality_degraded', requests: 1 },
  ],
}
const usage: Usage = {
  reachable: true,
  generatedAt: null,
  range: { start: null, end: null },
  usage: {
    requests: 2,
    successfulRequests: 2,
    failedRequests: 0,
    inputTokens: 50,
    cachedInputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    tokens: 70,
    billedCostUsdTicks: 10000000000,
    successRate: 100,
    cacheHitRate: 20,
    averageFirstTokenMs: 0,
    outputTokensPerSecond: 0,
    firstTokenSamples: 0,
    throughputSamples: 0,
  },
  series: [
    {
      start: '2026-10-21T00:00:00Z',
      end: '2026-10-21T01:00:00Z',
      requests: 2,
      inputTokens: 50,
      cachedInputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      tokens: 70,
      billedCostUsdTicks: 10000000000,
    },
  ],
  activity: [{ start: '2026-10-21T00:00:00Z', requests: 2 }],
  topModels: [],
  providers: [],
}
afterEach(cleanup)
it('shows three health windows, falls back to recent traffic, and preserves failure shares while hiding internal errors', () => {
  render(<HealthDashboard data={health} />)
  expect(screen.getByText('Healthy')).toBeInTheDocument()
  expect(screen.getByText('Last 15 minutes')).toBeInTheDocument()
  expect(screen.getByText('Last 30 minutes')).toBeInTheDocument()
  expect(screen.getByText('Last 1 hours')).toBeInTheDocument()
  expect(
    screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-label'))
  ).toEqual(['larger', 'smaller', 'client_stream_interrupted'])
  expect(screen.getByRole('progressbar', { name: 'smaller' })).toHaveAttribute(
    'aria-valuenow',
    '0'
  )
  expect(
    screen.getByRole('progressbar', { name: 'client_stream_interrupted' })
  ).toHaveAttribute('aria-valuenow', '100')
  expect(screen.queryByText(/quality_degraded/)).not.toBeInTheDocument()
  expect(screen.getAllByText(/Client disconnected/)).toHaveLength(2)
})
it('lets users toggle usage trend series and shows missing performance samples as unavailable', async () => {
  render(<UsageDashboard data={usage} />)
  const requests = screen.getByRole('button', { name: 'Requests' })
  expect(requests).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(requests)
  expect(requests).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(requests)
  expect(requests).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen
      .getByText('First token latency (ms)')
      .closest('[data-slot=card-content]')
  ).toHaveTextContent('—')
  expect(screen.getByRole('img', { name: /2 Requests/ })).toBeInTheDocument()
})
it('does not present unavailable upstream usage as zero-valued statistics', () => {
  render(<UsageDashboard data={{ ...usage, reachable: false }} />)
  expect(
    screen.getByText('Upstream is currently unreachable')
  ).toBeInTheDocument()
  expect(screen.queryByText('Request dashboard')).not.toBeInTheDocument()
})
