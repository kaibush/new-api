package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelStatusPrivacyAndFailures(t *testing.T) {
	for _, token := range []string{"integration-secret", "giq_integration-secret"} {
		t.Run(token, func(t *testing.T) {
			inventoryPath, auditPath, pageSize := "/api/public/upstream-accounts", "/api/request-audits", "1"
			if token == "giq_integration-secret" {
				inventoryPath, auditPath, pageSize = "/api/integration/v1/upstream-accounts", "/api/integration/v1/request-statistics", ""
			}
			var auditStatus = http.StatusOK
			var inventoryStatus = http.StatusOK
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "Bearer "+token, r.Header.Get("Authorization"))
				switch r.URL.Path {
				case inventoryPath:
					w.WriteHeader(inventoryStatus)
					_, _ = w.Write([]byte(`{"reachable":true,"total":3,"available":2,"providers":{"grok_build":{"total":3,"available":2}}}`))
				case auditPath:
					assert.Equal(t, "3h", r.URL.Query().Get("window"))
					assert.Equal(t, pageSize, r.URL.Query().Get("pageSize"))
					w.WriteHeader(auditStatus)
					_, _ = w.Write([]byte(`{"clientKeys":[{"name":"gateway","requestCount":10,"thinkingRequests":7,"thinkingSampleRequests":8,"httpSuccessRequests":9}],"callers":[{"id":"user:[\"1\",\"alice\"]","name":"alice","requestCount":2,"thinkingRequests":1,"thinkingSampleRequests":2,"httpSuccessRequests":2},{"id":"user:[\"2\",\"bob\"]","name":"bob","requestCount":8},{"id":"user:[\"1\",\"different\"]","name":"different","requestCount":1},{"id":"unlabeled","name":"private-key-name","requestCount":1}],"items":[{"prompt":"private prompt","token":"integration-secret"}]}`))
				case "/api/integration/v1/upstream-health", "/api/public/upstream-health":
					_, _ = w.Write([]byte(`{"enabled":true,"windows":{"15m":{"requests":2,"successfulRequests":1}},"series":[],"models":[],"errors":[],"scan":{"lastError":"private-secret"},"prompt":"private prompt"}`))
				case "/api/integration/v1/upstream-usage", "/api/public/upstream-usage":
					assert.Equal(t, "Asia/Shanghai", r.URL.Query().Get("timezone"))
					_, _ = w.Write([]byte(`{"reachable":true,"usage":{"requests":3,"billedCostUsdTicks":10000000000},"series":[],"activity":[],"topModels":[],"providers":[],"apiKey":"private-secret"}`))
				default:
					t.Errorf("unexpected path: %s", r.URL.Path)
				}
			}))
			t.Cleanup(upstream.Close)
			service.InitHttpClient()
			client := service.GetHttpClient()
			savedClient := *client
			*client = *upstream.Client()
			fetch := system_setting.GetFetchSetting()
			savedProtection := fetch.EnableSSRFProtection
			fetch.EnableSSRFProtection = false
			common.OptionMapRWMutex.Lock()
			savedOptions := common.OptionMap
			common.OptionMap = map[string]string{"GrokIQBaseURL": upstream.URL, "GrokIQAdminToken": token}
			common.OptionMapRWMutex.Unlock()
			t.Cleanup(func() {
				*client = savedClient
				fetch.EnableSSRFProtection = savedProtection
				common.OptionMapRWMutex.Lock()
				common.OptionMap = savedOptions
				common.OptionMapRWMutex.Unlock()
			})

			optionsResponse := httptest.NewRecorder()
			optionsContext, _ := gin.CreateTestContext(optionsResponse)
			optionsContext.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
			GetOptions(optionsContext)
			assert.NotContains(t, optionsResponse.Body.String(), "integration-secret")
			assert.NotContains(t, optionsResponse.Body.String(), "GrokIQAdminToken")
			assert.Contains(t, optionsResponse.Body.String(), "GrokIQBaseURL")

			engine := gin.New()
			engine.GET("/api/channel-status", middleware.UserAuth(), GetChannelStatus)
			anonymous := httptest.NewRecorder()
			engine.ServeHTTP(anonymous, httptest.NewRequest(http.MethodGet, "/api/channel-status", nil))
			assert.Equal(t, http.StatusUnauthorized, anonymous.Code)
			for _, tc := range []struct {
				name        string
				role        int
				user        string
				wantClients int
			}{
				{"own card", common.RoleCommonUser, "alice", 1},
				{"no matching identity", common.RoleCommonUser, "unmatched", 0},
				{"administrator cards", common.RoleAdminUser, "admin", 4},
			} {
				t.Run(tc.name, func(t *testing.T) {
					rec := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(rec)
					c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?window=3h&user_id=2", nil)
					c.Set("id", 1)
					c.Set("username", tc.user)
					c.Set("role", tc.role)
					GetChannelStatus(c)
					require.Equal(t, http.StatusOK, rec.Code)
					var body struct {
						Success bool `json:"success"`
						Data    struct {
							Summary   channelAuditClient   `json:"summary"`
							Clients   []channelAuditClient `json:"clients"`
							Inventory map[string]any       `json:"inventory"`
						} `json:"data"`
					}
					require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &body))
					require.True(t, body.Success)
					assert.Len(t, body.Data.Clients, tc.wantClients)
					assert.EqualValues(t, 10, body.Data.Summary.RequestCount)
					require.NotNil(t, body.Data.Summary.ThinkingSampleRequests)
					assert.EqualValues(t, 8, *body.Data.Summary.ThinkingSampleRequests)
					providers := body.Data.Inventory["providers"].(map[string]any)
					assert.EqualValues(t, 67, providers["grok_build"].(map[string]any)["capacity"])
					assert.NotContains(t, body.Data.Inventory, "total")
					if tc.role >= common.RoleAdminUser {
						require.Contains(t, body.Data.Inventory, "accounts")
						assert.EqualValues(t, 2, body.Data.Inventory["accounts"].(map[string]any)["available"])
					} else {
						assert.NotContains(t, body.Data.Inventory, "accounts")
						assert.NotContains(t, rec.Body.String(), `"recovery"`)
						assert.NotContains(t, rec.Body.String(), `"available"`)
					}
					assert.NotContains(t, rec.Body.String(), "integration-secret")
					assert.NotContains(t, rec.Body.String(), "private prompt")
					if tc.role == common.RoleCommonUser {
						assert.NotContains(t, rec.Body.String(), "bob")
						assert.NotContains(t, rec.Body.String(), "different")
						assert.NotContains(t, rec.Body.String(), "private-key-name")
					}
				})
			}
			for _, dataset := range []string{"health", "usage"} {
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?dataset="+dataset+"&period=7d", nil)
				c.Set("role", common.RoleCommonUser)
				GetChannelStatus(c)
				require.Equal(t, http.StatusOK, rec.Code)
				assert.NotContains(t, rec.Body.String(), "private-secret")
				assert.NotContains(t, rec.Body.String(), "private prompt")
				assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			}
			for _, query := range []string{"dataset=unknown", "period=invalid", "dataset=visits&period=custom", "dataset=usage&period=custom&start=nope", "dataset=usage&period=custom&start=2026-01-01T00:00:00Z&end=2026-05-01T00:00:00Z", "dataset=usage&period=custom&start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z"} {
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?"+query, nil)
				GetChannelStatus(c)
				assert.Equal(t, http.StatusBadRequest, rec.Code)
			}
			for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusBadGateway} {
				auditStatus = status
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?window=3h", nil)
				GetChannelStatus(c)
				assert.Contains(t, rec.Body.String(), "auditError")
				assert.Contains(t, rec.Body.String(), "inventory")
				assert.NotContains(t, rec.Body.String(), "integration-secret")
			}
			auditStatus = http.StatusOK
			inventoryStatus = http.StatusServiceUnavailable
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?window=3h", nil)
			GetChannelStatus(c)
			assert.Contains(t, rec.Body.String(), "inventoryError")
			assert.Contains(t, rec.Body.String(), "summary")
			rec = httptest.NewRecorder()
			c, _ = gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/channel-status?window=custom", nil)
			GetChannelStatus(c)
			assert.Equal(t, http.StatusBadRequest, rec.Code)
		})
	}
}

func TestGrokIQURLAndRedirectCredentialProtection(t *testing.T) {
	for _, value := range []string{"http://example.com", "https://user:secret@example.com", "https://example.com?token=x", "https://example.com#x", "https://"} {
		assert.Error(t, validateGrokIQURL(value))
	}
	require.NoError(t, validateGrokIQURL("https://example.com/prefix"))
	destination := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("redirect destination must not receive the administrator token")
	}))
	t.Cleanup(destination.Close)
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	t.Cleanup(redirect.Close)
	client := redirect.Client()
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	var data channelInventory
	err := fetchGrokIQ(t.Context(), client, redirect.URL, "secret", "public/upstream-accounts", &data)
	require.Error(t, err)
	assert.Equal(t, "GrokIQ returned HTTP 302", err.Error())
}
