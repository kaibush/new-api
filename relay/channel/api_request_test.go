package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTaskAPIRequestInheritsClientCancellation(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithCancel(context.Background())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(requestContext)

	upstream, err := newTaskAPIRequest(c, "https://provider.example/tasks", nil)
	require.NoError(t, err)
	cancel()

	require.ErrorIs(t, upstream.Context().Err(), context.Canceled)
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}

func TestHeaderOverrideAuthenticatedIdentity(t *testing.T) {
	requests := make(chan http.Header, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Header.Clone()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(upstream.Close)

	channel := &relaycommon.ChannelMeta{
		ApiKey: "upstream-channel-secret",
		HeadersOverride: map[string]any{
			"*":                 true,
			"X-NewAPI-User-ID":  "{user_id}",
			"X-NewAPI-Username": "{username}",
			"X-NewAPI-Identity": "newapi:{user_id}:{username}",
			"X-Client-Value":    "{client_header:X-Client-Value}",
			"Authorization":     "Bearer {api_key}",
		},
	}
	for _, tc := range []struct {
		name     string
		userID   int
		username string
		wantID   string
	}{
		{name: "first user on shared channel", userID: 10, username: "alice", wantID: "10"},
		{name: "second user on shared channel", userID: 20, username: "bob", wantID: "20"},
		{name: "Unicode username", userID: 30, username: "测试用户", wantID: "30"},
		{name: "username cannot expand placeholders", userID: 40, username: "{api_key}{user_id}{username}", wantID: "40"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"user_id":999,"username":"forged"}`))
			c.Set(string(constant.ContextKeyUserName), tc.username)
			c.Request.Header.Set("X-NewAPI-User-ID", "999")
			c.Request.Header.Set("X-NewAPI-Username", "forged")
			c.Request.Header.Set("X-Client-Value", "{api_key}{username}{user_id}")
			info := &relaycommon.RelayInfo{UserId: tc.userID, ChannelMeta: channel}

			headers, err := ResolveHeaderOverride(info, c)
			require.NoError(t, err)
			req, err := http.NewRequest(http.MethodPost, upstream.URL, nil)
			require.NoError(t, err)
			applyHeaderOverrideToRequest(req, headers)
			resp, err := upstream.Client().Do(req)
			require.NoError(t, err)
			t.Cleanup(func() { _ = resp.Body.Close() })
			require.Equal(t, http.StatusNoContent, resp.StatusCode)
			received := <-requests
			assert.Equal(t, tc.wantID, received.Get("X-NewAPI-User-ID"))
			assert.Equal(t, tc.username, received.Get("X-NewAPI-Username"))
			assert.Equal(t, "newapi:"+tc.wantID+":"+tc.username, received.Get("X-NewAPI-Identity"))
			assert.Equal(t, "Bearer upstream-channel-secret", received.Get("Authorization"))
			assert.Equal(t, "{api_key}{username}{user_id}", received.Get("X-Client-Value"))
		})
	}
}

func TestHeaderOverrideMissingIdentityDoesNotForwardSpoofedValues(t *testing.T) {
	for _, tc := range []struct {
		name        string
		userID      int
		username    string
		channelTest bool
		noContext   bool
		wantUserID  string
	}{
		{name: "no authenticated user", username: "forged"},
		{name: "no username", userID: 10, wantUserID: "10"},
		{name: "channel test omits administrator identity", userID: 1, username: "admin", channelTest: true},
		{name: "model discovery without request context", noContext: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			c.Set(string(constant.ContextKeyUserName), tc.username)
			c.Request.Header.Set("X-NewAPI-User-ID", "999")
			c.Request.Header.Set("X-NewAPI-Username", "forged")
			info := &relaycommon.RelayInfo{
				UserId:        tc.userID,
				IsChannelTest: tc.channelTest,
				ChannelMeta: &relaycommon.ChannelMeta{HeadersOverride: map[string]any{
					"X-NewAPI-User-ID":  "{user_id}",
					"X-NewAPI-Username": "{username}",
					"X-Static":          "kept",
				}},
			}
			if tc.noContext {
				c = nil
			} else {
				info.HeadersOverride["*"] = true
			}
			headers, err := ResolveHeaderOverride(info, c)
			require.NoError(t, err)
			assert.Equal(t, tc.wantUserID, headers["x-newapi-user-id"])
			assert.NotContains(t, headers, "x-newapi-username")
			assert.Equal(t, "kept", headers["x-static"])
		})
	}
}

func TestHeaderOverrideRejectsUsernameHeaderInjection(t *testing.T) {
	for _, username := range []string{"alice\r\nX-Injected: true", "alice\x00"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set(string(constant.ContextKeyUserName), username)
		info := &relaycommon.RelayInfo{
			UserId: 10,
			ChannelMeta: &relaycommon.ChannelMeta{HeadersOverride: map[string]any{
				"X-NewAPI-Username": "{username}",
			}},
		}
		headers, err := ResolveHeaderOverride(info, c)
		require.Error(t, err)
		assert.Nil(t, headers)
		assert.NotContains(t, err.Error(), username)
	}
}

func TestToWebSocketURL(t *testing.T) {
	for input, want := range map[string]string{
		"https://api.openai.com/v1/responses":             "wss://api.openai.com/v1/responses",
		"http://127.0.0.1:3000/v1/responses":              "ws://127.0.0.1:3000/v1/responses",
		"wss://chatgpt.com/backend-api/codex/responses":   "wss://chatgpt.com/backend-api/codex/responses",
		"ws://127.0.0.1:3000/backend-api/codex/responses": "ws://127.0.0.1:3000/backend-api/codex/responses",
	} {
		assert.Equal(t, want, toWebSocketURL(input), input)
	}
}
