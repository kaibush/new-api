package controller

type channelHealthWindow struct {
	Requests           float64 `json:"requests"`
	SuccessfulRequests float64 `json:"successfulRequests"`
	FailedRequests     float64 `json:"failedRequests"`
	SuccessRate        float64 `json:"successRate"`
}

type channelHealthPoint struct {
	Start              string  `json:"start"`
	End                string  `json:"end"`
	Requests           float64 `json:"requests"`
	SuccessfulRequests float64 `json:"successfulRequests"`
	FailedRequests     float64 `json:"failedRequests"`
	SuccessRate        float64 `json:"successRate"`
}

type channelHealthError struct {
	StatusCode float64 `json:"statusCode"`
	ErrorCode  string  `json:"errorCode"`
	Requests   float64 `json:"requests"`
}

type channelHealthModel struct {
	Model              string              `json:"model"`
	Requests           float64             `json:"requests"`
	SuccessfulRequests float64             `json:"successfulRequests"`
	FailedRequests     float64             `json:"failedRequests"`
	SuccessRate        float64             `json:"successRate"`
	MainError          *channelHealthError `json:"mainError"`
}

type channelHealth struct {
	Enabled     bool                           `json:"enabled"`
	GeneratedAt *string                        `json:"generatedAt"`
	AsOf        *string                        `json:"asOf"`
	Stale       bool                           `json:"stale"`
	Windows     map[string]channelHealthWindow `json:"windows"`
	Series      []channelHealthPoint           `json:"series"`
	Models      []channelHealthModel           `json:"models"`
	Errors      []channelHealthError           `json:"errors"`
}

type channelUsageTotals struct {
	Requests              float64 `json:"requests"`
	SuccessfulRequests    float64 `json:"successfulRequests"`
	FailedRequests        float64 `json:"failedRequests"`
	InputTokens           float64 `json:"inputTokens"`
	CachedInputTokens     float64 `json:"cachedInputTokens"`
	OutputTokens          float64 `json:"outputTokens"`
	ReasoningTokens       float64 `json:"reasoningTokens"`
	Tokens                float64 `json:"tokens"`
	BilledCostUsdTicks    float64 `json:"billedCostUsdTicks"`
	SuccessRate           float64 `json:"successRate"`
	CacheHitRate          float64 `json:"cacheHitRate"`
	AverageFirstTokenMs   float64 `json:"averageFirstTokenMs"`
	OutputTokensPerSecond float64 `json:"outputTokensPerSecond"`
	FirstTokenSamples     float64 `json:"firstTokenSamples"`
	ThroughputSamples     float64 `json:"throughputSamples"`
}

type channelUsagePoint struct {
	Start              string  `json:"start"`
	End                string  `json:"end"`
	Requests           float64 `json:"requests"`
	InputTokens        float64 `json:"inputTokens"`
	CachedInputTokens  float64 `json:"cachedInputTokens"`
	OutputTokens       float64 `json:"outputTokens"`
	ReasoningTokens    float64 `json:"reasoningTokens"`
	Tokens             float64 `json:"tokens"`
	BilledCostUsdTicks float64 `json:"billedCostUsdTicks"`
}

type channelActivityPoint struct {
	Start    string  `json:"start"`
	Requests float64 `json:"requests"`
}

type channelUsageModel struct {
	Model              string  `json:"model"`
	Requests           float64 `json:"requests"`
	InputTokens        float64 `json:"inputTokens"`
	CachedInputTokens  float64 `json:"cachedInputTokens"`
	OutputTokens       float64 `json:"outputTokens"`
	ReasoningTokens    float64 `json:"reasoningTokens"`
	Tokens             float64 `json:"tokens"`
	BilledCostUsdTicks float64 `json:"billedCostUsdTicks"`
}

type channelUsageProvider struct {
	Provider           string  `json:"provider"`
	Requests           float64 `json:"requests"`
	SuccessfulRequests float64 `json:"successfulRequests"`
	Tokens             float64 `json:"tokens"`
}

type channelDateRange struct {
	Start *string `json:"start"`
	End   *string `json:"end"`
}

type channelUsage struct {
	Reachable   bool                   `json:"reachable"`
	GeneratedAt *string                `json:"generatedAt"`
	Range       channelDateRange       `json:"range"`
	Usage       channelUsageTotals     `json:"usage"`
	Series      []channelUsagePoint    `json:"series"`
	Activity    []channelActivityPoint `json:"activity"`
	TopModels   []channelUsageModel    `json:"topModels"`
	Providers   []channelUsageProvider `json:"providers"`
}
