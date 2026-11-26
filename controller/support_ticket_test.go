package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSupportTicketWorkflow(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				t.Skip("database not configured")
			}
			t.Setenv("TEST_SECURITY_DIALECT", dialect)
			owner, _ := setupSecurityEnrollmentTest(t)
			require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.SupportTicket{}, &model.SupportTicketMessage{}))
			member, err := service.CreateLoginSession(owner.Id, "password", "127.0.0.1", "ticket-test")
			require.NoError(t, err)
			admin := model.User{Username: "ticket-admin", AffCode: "ts-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			other := model.User{Username: "other-user", AffCode: "ts-other", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			require.NoError(t, model.DB.Create(&admin).Error)
			require.NoError(t, model.DB.Create(&other).Error)
			staff, err := service.CreateLoginSession(admin.Id, "password", "127.0.0.1", "ticket-test")
			require.NoError(t, err)
			stranger, err := service.CreateLoginSession(other.Id, "password", "127.0.0.1", "ticket-test")
			require.NoError(t, err)
			router := gin.New()
			group := router.Group("/api/tickets", middleware.UserAuth())
			group.GET("/settings", GetSupportTicketSettings)
			group.PUT("/settings", middleware.AdminAuth(), SaveSupportTicketSettings)
			group.Use(SupportTicketAccess)
			group.GET("", ListSupportTickets)
			group.GET("/:id", GetSupportTicket)
			group.POST("", WriteSupportTicket)
			group.POST("/:id/messages", WriteSupportTicket)
			group.PATCH("/:id/status", middleware.AdminAuth(), UpdateSupportTicketStatus)
			request := func(token, method, suffix, body string, status int) string {
				t.Helper()
				req := httptest.NewRequest(method, "/api/tickets"+suffix, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				if token != "" {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				response := httptest.NewRecorder()
				router.ServeHTTP(response, req)
				require.Equal(t, status, response.Code, response.Body.String())
				return response.Body.String()
			}
			request("", "GET", "", "", 401)
			assert.Contains(t, request(member.AccessToken, "GET", "/settings", "", 200), `"enabled":false`)
			request(member.AccessToken, "POST", "", `{"title":"x","body":"y"}`, 403)
			settings := `{"enabled":true,"name":"  帮助台  "}`
			request(member.AccessToken, "PUT", "/settings", settings, 403)
			request(staff.AccessToken, "PUT", "/settings", `{"enabled":true,"name":"bad\nname"}`, 400)
			request(staff.AccessToken, "PUT", "/settings", settings, 200)
			assert.Contains(t, request(member.AccessToken, "GET", "/settings", "", 200), `"name":"帮助台"`)
			request(member.AccessToken, "POST", "", `{"title":"题","body":"  "}`, 400)
			var created struct {
				Data model.SupportTicket `json:"data"`
			}
			require.NoError(t, common.UnmarshalJsonStr(request(member.AccessToken, "POST", "", `{"title":"private_标题%","body":"private content","staff":true,"user_id":200}`, 201), &created))
			assert.Equal(t, owner.Id, created.Data.UserID)
			assert.Equal(t, model.TicketAwaitingStaff, created.Data.Status)
			path := "/" + strconv.FormatInt(created.Data.ID, 10)
			assert.Contains(t, request(stranger.AccessToken, "GET", "?search=%25", "", 200), `"total":0`)
			request(stranger.AccessToken, "GET", path, "", 404)
			request(stranger.AccessToken, "POST", path+"/messages", `{"body":"stranger"}`, 404)
			assert.Contains(t, request(staff.AccessToken, "GET", "?search=%23"+path[1:], "", 200), `"total":1`)
			assert.Contains(t, request(member.AccessToken, "GET", "?search=_", "", 200), `"total":1`)
			assert.Contains(t, request(stranger.AccessToken, "GET", "?search=%23"+path[1:], "", 200), `"total":0`)
			assert.Contains(t, request(member.AccessToken, "GET", "?status=closed", "", 200), `"total":0`)
			request(member.AccessToken, "PATCH", path+"/status", `{"status":"closed"}`, 403)
			request(staff.AccessToken, "POST", path+"/messages", `{"body":"staff response"}`, 200)
			assert.Contains(t, request(member.AccessToken, "GET", path, "", 200), `"status":"awaiting_user"`)
			request(member.AccessToken, "POST", path+"/messages", `{"body":"sensitive follow-up"}`, 200)
			var conversation struct {
				Data struct {
					Messages []model.SupportTicketMessage `json:"messages"`
				} `json:"data"`
			}
			require.NoError(t, common.UnmarshalJsonStr(request(member.AccessToken, "GET", path, "", 200), &conversation))
			require.Len(t, conversation.Data.Messages, 3)
			older := request(member.AccessToken, "GET", path+"?before="+strconv.FormatInt(conversation.Data.Messages[1].ID, 10), "", 200)
			assert.Contains(t, older, "private content")
			assert.NotContains(t, older, "staff response")
			assert.Contains(t, request(member.AccessToken, "GET", path, "", 200), `"status":"awaiting_staff"`)
			request(staff.AccessToken, "PATCH", path+"/status", `{"status":"closed"}`, 200)
			request(member.AccessToken, "POST", path+"/messages", `{"body":"no"}`, 409)
			request(staff.AccessToken, "PUT", "/settings", `{"enabled":false,"name":"服务台"}`, 200)
			request(staff.AccessToken, "GET", path, "", 403)
			request(member.AccessToken, "GET", path, "", 403)
			request(staff.AccessToken, "PUT", "/settings", settings, 200)
			assert.Contains(t, request(member.AccessToken, "GET", path, "", 200), "staff response")
			request(staff.AccessToken, "PATCH", path+"/status", `{"status":"resolved"}`, 200)
			cfg := model.CommunityConfig{BotEnabled: true, BotName: "igrokbot", AppID: "ticket-test-" + dialect, AppSecret: "secret", TemplateID: "test-template", Receiver: "test-account"}
			require.NoError(t, model.SaveCommunityConfig(cfg))
			previousTransport, previousAddress := http.DefaultTransport, system_setting.ServerAddress
			t.Cleanup(func() { http.DefaultTransport = previousTransport; system_setting.ServerAddress = previousAddress })
			system_setting.ServerAddress = "https://help.example.test"
			attempts := 0
			http.DefaultTransport = communityRoundTripper(func(req *http.Request) (*http.Response, error) {
				result := `{"access_token":"stub","expires_in":7200}`
				if req.Method == "POST" {
					attempts++
					var payload struct {
						URL       string `json:"url"`
						Recipient string `json:"touser"`
						Data      map[string]struct {
							Value string `json:"value"`
						} `json:"data"`
					}
					require.NoError(t, common.DecodeJson(req.Body, &payload))
					assert.Equal(t, "https://help.example.test/tickets?ticket="+path[1:], payload.URL)
					assert.Equal(t, cfg.Receiver, payload.Recipient)
					assert.Equal(t, "igrokbot", payload.Data["sender"].Value)
					assert.Contains(t, payload.Data["content"].Value, "帮助台 #"+path[1:])
					assert.NotContains(t, fmt.Sprint(payload.Data), "private")
					assert.NotContains(t, fmt.Sprint(payload.Data), "sensitive")
					result = `{"errcode":0,"msgid":100}`
					if attempts == 1 {
						result = `{"errcode":45009}`
					}
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(result))}, nil
			})
			require.NoError(t, service.DeliverTicketNotifications(t.Context()))
			assert.Equal(t, 2, attempts, "only requester messages notify")
			require.NoError(t, service.DeliverTicketNotifications(t.Context()))
			assert.Equal(t, 2, attempts, "no immediate retry or duplicate")
			pending := model.DB.Model(&model.SupportTicketMessage{}).Where("notify_at > ?", time.Now().Unix()).Update("notify_at", time.Now().Unix())
			require.NoError(t, pending.Error)
			require.EqualValues(t, 1, pending.RowsAffected)
			require.NoError(t, service.DeliverTicketNotifications(t.Context()))
			assert.Equal(t, 3, attempts)
			require.NoError(t, service.DeliverTicketNotifications(t.Context()))
			assert.Equal(t, 3, attempts)
		})
	}
}
