export type HealthWindow = {
  requests: number
  successfulRequests: number
  failedRequests: number
  successRate: number
}

export type HealthPoint = {
  start: string
  end: string
  requests: number
  successfulRequests: number
  failedRequests: number
  successRate: number
}

export type HealthError = {
  statusCode: number
  errorCode: string
  requests: number
}

export type HealthModel = {
  model: string
  requests: number
  successfulRequests: number
  failedRequests: number
  successRate: number
  mainError: HealthError | null
}

export type Health = {
  enabled: boolean
  generatedAt: string | null
  asOf: string | null
  stale: boolean
  windows: Record<string, HealthWindow>
  series: HealthPoint[]
  models: HealthModel[]
  errors: HealthError[]
}

export type UsageTotals = {
  requests: number
  successfulRequests: number
  failedRequests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokens: number
  billedCostUsdTicks: number
  successRate: number
  cacheHitRate: number
  averageFirstTokenMs: number
  outputTokensPerSecond: number
  firstTokenSamples: number
  throughputSamples: number
}

export type UsagePoint = {
  start: string
  end: string
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokens: number
  billedCostUsdTicks: number
}

export type ActivityPoint = {
  start: string
  requests: number
}

export type UsageModel = {
  model: string
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokens: number
  billedCostUsdTicks: number
}

export type UsageProvider = {
  provider: string
  requests: number
  successfulRequests: number
  tokens: number
}

export type DateRange = {
  start: string | null
  end: string | null
}

export type Usage = {
  reachable: boolean
  generatedAt: string | null
  range: DateRange
  usage: UsageTotals
  series: UsagePoint[]
  activity: ActivityPoint[]
  topModels: UsageModel[]
  providers: UsageProvider[]
}
