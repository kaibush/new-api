package service

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const providerError = "tokenharbor: This request is larger than 4 MB, the most a free account can send. This counts the entire conversation history, tools, and base64-encoded attachments together, not just the image file. Accounts that have topped up or bought a Pass can send requests up to 100 MB. To send this one, shorten the conversation (for example /compact in your agent, or start a new session), remove screenshots and large files, or top up at https://tokenharbor.ai/dashboard."

func errorFilterFixture(t *testing.T, rules ...errorfilter.Rule) *errorfilter.Policy {
	t.Helper()
	cfg := errorfilter.Defaults()
	cfg.Enabled, cfg.Rules = true, rules
	policy, err := errorfilter.Compile(cfg)
	require.NoError(t, err)
	return policy
}
func errorFilterRule() errorfilter.Rule {
	return errorfilter.Rule{Name: "body limit", Enabled: true, Field: "message", Match: "contains", Pattern: "larger than", Action: "replace", Replacement: "请求过大，请精简对话后重试。"}
}

func TestErrorFilterCustomMessagesAndScopes(t *testing.T) {
	rule := errorFilterRule()
	rule.Channels, rule.Statuses, rule.ModelPattern = []int{7}, "413,500-599", "^deepseek-"
	policy := errorFilterFixture(t, rule)
	input := errorfilter.Input{Message: providerError, ChannelID: 7, Model: "deepseek-v4.1-flash:free", Status: 413}
	assert.Equal(t, rule.Replacement, policy.Apply(input).Message)
	for _, changed := range []errorfilter.Input{
		{Message: providerError, ChannelID: 8, Model: input.Model, Status: 413},
		{Message: providerError, ChannelID: 7, Model: "other", Status: 413},
		{Message: providerError, ChannelID: 7, Model: input.Model, Status: 429},
	} {
		assert.Equal(t, "preserve", policy.Apply(changed).Action)
	}
	rule.Pattern, rule.Replacement, rule.Statuses = "新供应商额度不足", "服务暂不可用\n编号 {request_id} / {status}", ""
	policy = errorFilterFixture(t, rule)
	input.Message, input.RequestID = "新供应商额度不足，请充值 VIP", "test-id"
	assert.Equal(t, "服务暂不可用\n编号 test-id / 413", policy.Apply(input).Message)
}

func TestErrorFilterRuleOrderAndReplacements(t *testing.T) {
	for _, tc := range []struct {
		name, match, pattern, replacement, input, want string
		sensitive                                      bool
	}{
		{name: "case insensitive literal", match: "contains", pattern: "PROVIDER", replacement: "$1", input: "Provider failed", want: "$1 failed"},
		{name: "case sensitive", match: "contains", pattern: "PROVIDER", replacement: "x", input: "Provider failed", want: "Provider failed", sensitive: true},
		{name: "exact does not match substring", match: "exact", pattern: "failed", replacement: "x", input: "Provider failed", want: "Provider failed"},
		{name: "capture groups", match: "regex", pattern: `(?P<reason>quota|limit): [^ ]+`, replacement: "${reason}: hidden", input: "quota: Provider limit: free", want: "quota: hidden limit: hidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rule := errorFilterRule()
			rule.Match, rule.Pattern, rule.Replacement, rule.Action, rule.CaseSensitive = tc.match, tc.pattern, tc.replacement, "redact", tc.sensitive
			assert.Equal(t, tc.want, errorFilterFixture(t, rule).Apply(errorfilter.Input{Message: tc.input}).Message)
		})
	}
	first, second := errorFilterRule(), errorFilterRule()
	first.Action = "preserve"
	assert.Equal(t, "preserve", errorFilterFixture(t, first, second).Apply(errorfilter.Input{Message: providerError}).Action)
	first.Enabled = false
	assert.Equal(t, second.Replacement, errorFilterFixture(t, first, second).Apply(errorfilter.Input{Message: providerError}).Message)
}

func TestErrorFilterValidationAndDisabled(t *testing.T) {
	for _, raw := range []string{`null`, `{"enabled":true,"fallbak":"replace"}`, `{"rules":null}`, `{"rules":[{"name":"x","matc":"contains"}]}`} {
		_, _, err := setting.ParseErrorFilter(raw)
		require.Error(t, err)
	}
	for _, change := range []func(*errorfilter.Rule){
		func(r *errorfilter.Rule) { r.Match = "regex"; r.Pattern = "(?=unsupported)" },
		func(r *errorfilter.Rule) { r.Statuses = "599-500" },
		func(r *errorfilter.Rule) { r.ModelPattern = "[" },
		func(r *errorfilter.Rule) { r.Channels = []int{0} },
		func(r *errorfilter.Rule) { r.Action = "redact"; r.Field = "code" },
	} {
		cfg := errorfilter.Defaults()
		rule := errorFilterRule()
		change(&rule)
		cfg.Rules = []errorfilter.Rule{rule}
		_, err := errorfilter.Compile(cfg)
		require.Error(t, err)
	}
	cfg := errorfilter.Defaults()
	cfg.RemoveHeaders = []string{"Content-*"}
	_, err := errorfilter.Compile(cfg)
	require.Error(t, err)
	cfg = errorfilter.Defaults()
	cfg.Rules = []errorfilter.Rule{errorFilterRule()}
	policy, err := errorfilter.Compile(cfg)
	require.NoError(t, err)
	assert.Equal(t, providerError, policy.Apply(errorfilter.Input{Message: providerError}).Message)
	cfg.Enabled, cfg.Fallback, cfg.FallbackMessage = true, "replace", "联系 https://support.example.com/help"
	cfg.Rules = nil
	policy, err = errorfilter.Compile(cfg)
	require.NoError(t, err)
	body, result := RewritePublicError(policy, errorfilter.Input{Status: 429}, []byte(`{"msg":"Future provider free tier exhausted"}`), true)
	assert.Contains(t, string(body), cfg.FallbackMessage)
	assert.Equal(t, "replace", result.Action)
}

func TestErrorFilterEnvelopesRemoveAllProviderDetails(t *testing.T) {
	cfg := errorfilter.Defaults()
	cfg.Enabled, cfg.Fallback = true, "replace"
	policy, err := errorfilter.Compile(cfg)
	require.NoError(t, err)
	for _, body := range []string{
		`{"error":{"message":"secret-provider","type":"secret-provider","code":"secret-provider","param":"secret-provider","details":{"url":"secret-provider"}},"msg":"secret-provider"}`,
		`{"type":"error","error":{"type":"secret-provider","message":"secret-provider"},"request_id":"secret-provider"}`,
		`{"error":{"code":413,"status":"INVALID_ARGUMENT","message":"secret-provider","details":["secret-provider"]}}`,
		`{"type":"response.failed","response":{"id":"resp_1","model":"secret-provider","status":"failed","error":{"message":"secret-provider","code":"context_length_exceeded"}}}`,
		`{"type":"response.failed","message":"secret-provider"}`,
		`{"msg":"secret-provider","detail":"secret-provider"}`,
		`{"error":"secret-provider"}`,
		`secret-provider HTML error`,
	} {
		rewritten, result := RewritePublicError(policy, errorfilter.Input{Status: 413}, []byte(body), true)
		assert.NotContains(t, string(rewritten), "secret-provider")
		assert.Contains(t, string(rewritten), errorfilter.DefaultMessage)
		assert.Equal(t, "replace", result.Action)
		var response map[string]any
		require.NoError(t, common.Unmarshal(rewritten, &response))
		if strings.Contains(body, "response.failed") {
			assert.Equal(t, "response.failed", response["type"])
		}
	}
	rule := errorFilterRule()
	rule.Field, rule.Pattern = "code", "provider_code"
	kind, code := "custom_type", "custom_code"
	rule.OutputType, rule.OutputCode = &kind, &code
	body, result := RewritePublicError(errorFilterFixture(t, rule), errorfilter.Input{Status: 413}, []byte(`{"error":{"message":"raw","code":"provider_code"}}`), true)
	assert.Contains(t, string(body), `"type":"custom_type"`)
	assert.Equal(t, "custom_code", result.Code)
}

func TestErrorFilterPartialReplacementUpdatesMessageAliases(t *testing.T) {
	cfg := errorfilter.Defaults()
	cfg.Enabled, cfg.StripDetails = true, false
	rule := errorFilterRule()
	rule.Pattern, rule.Replacement, rule.Action = "Provider", "service", "redact"
	cfg.Rules = []errorfilter.Rule{rule}
	policy, err := errorfilter.Compile(cfg)
	require.NoError(t, err)
	body, _ := RewritePublicError(policy, errorfilter.Input{Status: 400}, []byte(`{"error":{"msg":"Provider failed","message":"Provider failed","detail":"Provider failed","retry_after":2}}`), true)
	assert.NotContains(t, string(body), "Provider")
	assert.Contains(t, string(body), `"retry_after":2`)
}

func TestErrorFilterHTTPWriterKeepsStatusAndMatchesRawMessage(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("channel_id", 7)
	rule := errorFilterRule()
	rule.Pattern = "tokenharbor.ai"
	rule.Channels = []int{7}
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, rule)}
	c.Writer = w
	c.Header("X-Magpie-Upstream", "secret-provider")
	c.Header("Retry-After", "3")
	SetErrorFilterSource(c, providerError)
	c.JSON(413, gin.H{"error": gin.H{"message": "tokenharbor: url [masked]", "type": "request_too_large"}})
	assert.True(t, w.Written())
	assert.Equal(t, 413, w.Status())
	w.finish()
	assert.Equal(t, 413, recorder.Code)
	assert.Contains(t, recorder.Body.String(), rule.Replacement)
	assert.NotContains(t, recorder.Body.String(), "tokenharbor")
	assert.Empty(t, recorder.Header().Get("X-Magpie-Upstream"))
	assert.Equal(t, "3", recorder.Header().Get("Retry-After"))
}

func TestErrorFilterReportedErrorWithHTTP200IsStillFiltered(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, errorFilterRule())}
	c.Writer = w
	SetErrorFilterSource(c, providerError)
	c.JSON(http.StatusOK, gin.H{"error": gin.H{"message": providerError}})
	w.finish()
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "tokenharbor")
	assert.Contains(t, recorder.Body.String(), errorFilterRule().Replacement)
}

func TestErrorFilterStreamPreservesContentAndFiltersSplitError(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, errorFilterRule())}
	c.Writer = w
	c.Header("Content-Type", "text/event-stream")
	success := "data: {\"choices\":[{\"delta\":{\"content\":\"larger than is ordinary text\"}}]}\n\n"
	n, err := w.Write([]byte(success))
	require.NoError(t, err)
	assert.Equal(t, len(success), n)
	w.Flush()
	raw, _ := common.Marshal(gin.H{"error": gin.H{"message": providerError, "type": "request_too_large"}, "metadata": "secret-provider"})
	event := append([]byte("event: error\r\nid: secret-provider\r\ndata: "), raw...)
	event = append(event, []byte("\r\n\r\n")...)
	for _, part := range [][]byte{event[:23], event[23 : len(event)-1], event[len(event)-1:]} {
		_, err = w.Write(part)
		require.NoError(t, err)
		w.Flush()
	}
	_, err = w.WriteString("data: [DONE]\n\n")
	require.NoError(t, err)
	w.finish()
	assert.Equal(t, 200, recorder.Code)
	assert.True(t, strings.HasPrefix(recorder.Body.String(), success))
	assert.Contains(t, recorder.Body.String(), errorFilterRule().Replacement)
	assert.Contains(t, recorder.Body.String(), "data: [DONE]\n\n")
	assert.NotContains(t, recorder.Body.String(), "tokenharbor")
	assert.NotContains(t, recorder.Body.String(), "secret-provider")
}

func TestErrorFilterFinalHTTPErrorAfterStreamUsesErrorEvent(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, errorFilterRule())}
	c.Writer = w
	c.Header("Content-Type", "text/event-stream")
	_, err := w.WriteString(": ping\n\n")
	require.NoError(t, err)
	w.Flush()
	SetErrorFilterSource(c, providerError)
	c.JSON(413, gin.H{"error": gin.H{"message": providerError}})
	w.finish()
	assert.Equal(t, 200, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "event: error\ndata: ")
	assert.NotContains(t, recorder.Body.String(), "tokenharbor")
}

func TestErrorFilterCompressedAndOversizeErrorsFailClosed(t *testing.T) {
	for _, oversized := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, errorFilterRule())}
		c.Writer = w
		var compressed bytes.Buffer
		gz := gzip.NewWriter(&compressed)
		body := providerError
		if oversized {
			body = strings.Repeat("s", errorfilter.MaxErrorBytes+1)
		}
		_, err := gz.Write([]byte(body))
		require.NoError(t, err)
		require.NoError(t, gz.Close())
		c.Header("Content-Encoding", "gzip")
		c.Header("Content-Length", "999")
		w.WriteHeader(413)
		_, err = w.Write(compressed.Bytes())
		require.NoError(t, err)
		w.finish()
		assert.Empty(t, recorder.Header().Get("Content-Encoding"))
		assert.Empty(t, recorder.Header().Get("Content-Length"))
		assert.NotContains(t, recorder.Body.String(), "tokenharbor")
		if !oversized {
			assert.Contains(t, recorder.Body.String(), errorFilterRule().Replacement)
		}
	}
}

func TestErrorFilterSuccessfulJSONIsUntouched(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: errorFilterFixture(t, errorFilterRule())}
	w.Header().Set("Content-Type", "application/json")
	body := `{"result":"larger than free account","error":null}`
	w.WriteHeader(http.StatusOK)
	_, err := w.WriteString(body)
	require.NoError(t, err)
	w.finish()
	assert.Equal(t, body, recorder.Body.String())
}
