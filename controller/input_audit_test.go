package controller

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/requestplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestInputAuditProtocolSelection(t *testing.T) {
	for _, tc := range []struct {
		name    string
		request any
		want    string
	}{
		{"chat continuation", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "system", Content: "secret system"}, {Role: "user", Content: "old"}, {Role: "user", Content: "audit me"}, {Role: "assistant", Content: "private reply"}, {Role: "tool", Content: "secret result"}}}, "audit me"},
		{"chat media", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: []any{map[string]any{"type": "image_url", "image_url": "secret image"}, map[string]any{"type": "text", "text": "audit me"}}}}}, "audit me"},
		{"claude tools", &dto.ClaudeRequest{Messages: []dto.ClaudeMessage{{Role: "user", Content: "audit me"}, {Role: "user", Content: []any{map[string]any{"type": "tool_result", "content": "secret result"}}}}}, "audit me"},
		{"responses string", &dto.OpenAIResponsesRequest{Input: []byte(`"audit me"`)}, "audit me"},
		{"responses continuation", &dto.OpenAIResponsesRequest{Input: []byte(`[{"role":"user","content":[{"type":"input_text","text":"audit me"},{"type":"input_image","image_url":"secret"}]},{"type":"function_call_output","output":"secret result"}]`)}, "audit me"},
		{"responses tools only", &dto.OpenAIResponsesRequest{Input: []byte(`[{"type":"function_call_output","output":"secret result"}]`)}, ""},
		{"gemini tools", &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "audit me"}}}, {Role: "model", Parts: []dto.GeminiPart{{Text: "private reply"}}}, {Role: "user", Parts: []dto.GeminiPart{{FunctionResponse: &dto.GeminiFunctionResponse{}}}}}}, "audit me"},
		{"legacy completion", &dto.GeneralOpenAIRequest{Prompt: "audit me"}, "audit me"},
		{"embedded NUL remains visible", &dto.GeneralOpenAIRequest{Prompt: "before\x00after"}, "before␀after"},
		{"no user text", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "assistant", Content: "private reply"}}}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := service.ExtractInputAudit(tc.request, 2048)
			if tc.want == "" {
				assert.Nil(t, entry)
				return
			}
			require.NotNil(t, entry)
			assert.Equal(t, tc.want, entry.Content)
			assert.False(t, entry.Truncated)
		})
	}
}

func TestInputAuditLongTextRetainsEndsAndHashesOmittedMiddle(t *testing.T) {
	first := service.ExtractInputAudit(&dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "开头" + strings.Repeat("中", 4000) + "结尾"}}}, 2048)
	second := service.ExtractInputAudit(&dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "开头" + strings.Repeat("中", 2000) + "异" + strings.Repeat("中", 1999) + "结尾"}}}, 2048)
	require.NotNil(t, first)
	require.NotNil(t, second)
	assert.Equal(t, 2048, utf8.RuneCountInString(first.Content))
	assert.LessOrEqual(t, len(first.Content), 2048*4)
	assert.Equal(t, 4004, first.ContentChars)
	assert.True(t, first.Truncated)
	assert.True(t, strings.HasPrefix(first.Content, "开头"))
	assert.True(t, strings.HasSuffix(first.Content, "结尾"))
	assert.Equal(t, first.Content, second.Content)
	assert.NotEqual(t, first.ContentHash, second.ContentHash)
}

func inputAuditTestDB(t testing.TB, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "mysql":
		dsn := os.Getenv("INPUT_AUDIT_TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("INPUT_AUDIT_TEST_MYSQL_DSN is unset")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("INPUT_AUDIT_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("INPUT_AUDIT_TEST_POSTGRES_DSN is unset")
		}
		driver = postgres.Open(dsn)
	default:
		driver = sqlite.Open(":memory:")
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: gormlogger.Discard})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previous := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseType(dialect))
	t.Cleanup(func() { common.SetMainDatabaseType(previous) })
	require.NoError(t, db.Migrator().DropTable(&model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}, &model.Option{}, &inputAuditReleasedUser{}))
	return db
}

// Representative user columns verified against v1.0.0-rc.51 (unchanged
// since rc.42). The released GORM/dialect versions are also unchanged.
type inputAuditReleasedUser struct {
	Id       int
	Username string `gorm:"unique;index"`
	Password string `gorm:"not null"`
}

func (inputAuditReleasedUser) TableName() string { return "users" }

func BenchmarkInputAuditCapture(b *testing.B) {
	for _, tc := range []struct {
		name    string
		enabled bool
		text    string
	}{
		{"disabled", false, strings.Repeat("审计内容", 4096)},
		{"duplicate_short", true, strings.Repeat("审计内容", 128)},
		{"duplicate_long", true, strings.Repeat("审计内容", 4096)},
	} {
		b.Run(tc.name, func(b *testing.B) {
			db := inputAuditTestDB(b, "sqlite")
			require.NoError(b, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
			r, err := service.NewInputAuditRecorder(db)
			require.NoError(b, err)
			settings := model.DefaultInputAuditSettings()
			settings.Enabled = tc.enabled
			require.NoError(b, r.UpdateSettings(context.Background(), settings))
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			common.SetContextKey(c, constant.ContextKeyUserId, 1)
			request := &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: tc.text}, {Role: "tool", Content: "tool result excluded"}}}
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				r.Capture(c, request)
			}
		})
	}
}

func TestInputAuditDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			versionQuery := "SELECT sqlite_version()"
			if dialect != "sqlite" {
				versionQuery = "SELECT version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade_%v", upgrade), func(t *testing.T) {
					require.NoError(t, db.Migrator().DropTable(&model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}, &model.Option{}, &inputAuditReleasedUser{}))
					if upgrade {
						// The options schema matches the released v1.0.0-rc.42 schema.
						// The new feature must preserve existing options and their primary key.
						require.NoError(t, db.AutoMigrate(&model.Option{}, &inputAuditReleasedUser{}))
						require.NoError(t, db.Create(&model.Option{Key: "ExistingSetting", Value: "keep me"}).Error)
						require.NoError(t, db.Create(&inputAuditReleasedUser{Username: "existing-user", Password: "fixture"}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
					}
					if upgrade {
						var option model.Option
						require.NoError(t, db.Where(&model.Option{Key: "ExistingSetting"}).First(&option).Error)
						assert.Equal(t, "keep me", option.Value)
						assert.Error(t, db.Create(&model.Option{Key: "ExistingSetting", Value: "duplicate"}).Error)
						var user inputAuditReleasedUser
						require.NoError(t, db.Where("username = ?", "existing-user").First(&user).Error)
						assert.Equal(t, "fixture", user.Password)
						assert.Error(t, db.Create(&inputAuditReleasedUser{Username: "existing-user", Password: "duplicate"}).Error)
					}
					settings, err := model.LoadInputAuditSettings(db)
					require.NoError(t, err)
					assert.False(t, settings.Enabled)
					settings.Enabled = true
					settings.RetentionDays = 1
					settings.MaxRecords = 100
					require.NoError(t, model.SaveInputAuditSettings(db, settings))
					now := time.Now().Unix()
					rows := []model.InputAudit{{UserId: 1, ContentHash: "same", CreatedAt: now, Content: "first", RequestId: "first-request"}, {UserId: 1, ContentHash: "same", CreatedAt: now, Content: "duplicate"}, {UserId: 2, ContentHash: "same", CreatedAt: now, Content: "another user"}}
					require.NoError(t, model.PersistInputAudits(db, rows, now))
					require.NoError(t, model.PersistInputAudits(db, rows, now))
					found, total, err := model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 100)
					require.NoError(t, err)
					assert.EqualValues(t, 2, total)
					assert.Len(t, found, 2)
					found, total, err = model.QueryInputAudits(db, model.InputAuditFilter{UserId: 1, RequestId: "first-request", Start: now, End: now}, 0, 20)
					require.NoError(t, err)
					require.Len(t, found, 1)
					assert.EqualValues(t, 1, total)
					assert.Equal(t, "first", found[0].Content)
					// Expiry removes the unique key, so the same input can be saved again.
					require.NoError(t, db.Model(&model.InputAudit{}).Where("user_id = ?", 1).Update("created_at", now-86401).Error)
					require.NoError(t, model.PersistInputAudits(db, rows[:1], now))
					found, _, err = model.QueryInputAudits(db, model.InputAuditFilter{UserId: 1}, 0, 20)
					require.NoError(t, err)
					require.Len(t, found, 1)
					assert.Equal(t, now, found[0].CreatedAt)
					unicodeEntry := service.ExtractInputAudit(&dto.GeneralOpenAIRequest{Prompt: "审计\x00🙂"}, settings.MaxChars)
					require.NotNil(t, unicodeEntry)
					unicodeEntry.UserId = 3
					unicodeEntry.CreatedAt = now
					require.NoError(t, model.PersistInputAudits(db, []model.InputAudit{*unicodeEntry}, now))
					// Restart migration with saved Unicode content and unique keys.
					for range 2 {
						require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
					}
					found, total, err = model.QueryInputAudits(db, model.InputAuditFilter{UserId: 3}, 0, 20)
					require.NoError(t, err)
					assert.EqualValues(t, 1, total)
					require.Len(t, found, 1)
					assert.Equal(t, "审计␀🙂", found[0].Content)
					assert.Equal(t, unicodeEntry.ContentHash, found[0].ContentHash)
					assert.Error(t, db.Create(unicodeEntry).Error)
					for i := range 110 {
						rows = append(rows, model.InputAudit{UserId: 1, ContentHash: fmt.Sprintf("unique-%d", i), CreatedAt: now, Content: fmt.Sprint(i)})
					}
					require.NoError(t, model.PersistInputAudits(db, rows, now))
					found, total, err = model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 10)
					require.NoError(t, err)
					assert.EqualValues(t, 100, total)
					require.Len(t, found, 10)
					assert.Equal(t, "109", found[0].Content)
					// A delayed batch must not replace newer received inputs just
					// because it acquired a later database ID.
					require.NoError(t, model.PersistInputAudits(db, []model.InputAudit{{UserId: 1, ContentHash: "late-write", CreatedAt: now - 10, RequestId: "late-write", Content: "older input"}}, now))
					_, total, err = model.QueryInputAudits(db, model.InputAuditFilter{RequestId: "late-write"}, 0, 10)
					require.NoError(t, err)
					assert.Zero(t, total)
					settings.Enabled = false
					require.NoError(t, model.SaveInputAuditSettings(db, settings))
					require.NoError(t, model.PersistInputAudits(db, []model.InputAudit{{UserId: 1, ContentHash: "disabled", CreatedAt: now, Content: "must not save"}}, now))
					_, total, err = model.QueryInputAudits(db, model.InputAuditFilter{RequestId: "first-request"}, 0, 10)
					require.NoError(t, err)
					assert.Zero(t, total) // First record was removed by the rolling cap.
					var count int64
					require.NoError(t, db.Model(&model.InputAudit{}).Where("content_hash = ?", "disabled").Count(&count).Error)
					assert.Zero(t, count)
				})
			}
		})
	}
}

func TestInputAuditRecorderDrainsOnShutdown(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	r, err := service.NewInputAuditRecorder(db)
	require.NoError(t, err)
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, r.UpdateSettings(context.Background(), settings))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(c, constant.ContextKeyUserId, 1)
	r.Capture(c, &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "pending input"}}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r.Run(ctx)
	found, total, err := model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, found, 1)
	assert.Equal(t, "pending input", found[0].Content)
}

func TestInputAuditKeywordDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.InputAudit{}))
			rows := []model.InputAudit{
				{UserId: 1, ContentHash: "one", Content: "中文审计 Hello 100%_! C:\\audit 'quoted'", CreatedAt: 10, RequestId: "one"},
				{UserId: 2, ContentHash: "two", Content: "中文审计 HELLO 100abcX", CreatedAt: 20, RequestId: "two"},
				{UserId: 1, ContentHash: "three", Content: "正常消息", CreatedAt: 30, RequestId: "three"},
			}
			require.NoError(t, db.Create(&rows).Error)
			for _, tc := range []struct {
				name   string
				filter model.InputAuditFilter
				offset int
				limit  int
				want   []string
				total  int64
			}{
				{"Chinese substring", model.InputAuditFilter{Keyword: "文审"}, 0, 10, []string{"two", "one"}, 2},
				{"ASCII case and pagination", model.InputAuditFilter{Keyword: "hElLo"}, 1, 1, []string{"one"}, 2},
				{"combined filters", model.InputAuditFilter{Keyword: "审计", UserId: 1, RequestId: "one", Start: 10, End: 10}, 0, 10, []string{"one"}, 1},
				{"excluded by time", model.InputAuditFilter{Keyword: "审计", Start: 21}, 0, 10, []string{}, 0},
				{"literal percent", model.InputAuditFilter{Keyword: "100%"}, 0, 10, []string{"one"}, 1},
				{"literal underscore", model.InputAuditFilter{Keyword: "_"}, 0, 10, []string{"one"}, 1},
				{"literal escape", model.InputAuditFilter{Keyword: "!"}, 0, 10, []string{"one"}, 1},
				{"literal backslash", model.InputAuditFilter{Keyword: "C:\\audit"}, 0, 10, []string{"one"}, 1},
				{"literal quote", model.InputAuditFilter{Keyword: "'quoted'"}, 0, 10, []string{"one"}, 1},
				{"SQL text is data", model.InputAuditFilter{Keyword: "' OR 1=1 --"}, 0, 10, []string{}, 0},
				{"no match", model.InputAuditFilter{Keyword: "不存在"}, 0, 10, []string{}, 0},
				{"empty keyword", model.InputAuditFilter{}, 0, 10, []string{"three", "two", "one"}, 3},
			} {
				t.Run(tc.name, func(t *testing.T) {
					found, total, err := model.QueryInputAudits(db, tc.filter, tc.offset, tc.limit)
					require.NoError(t, err)
					ids := make([]string, 0, len(found))
					for _, row := range found {
						ids = append(ids, row.RequestId)
					}
					assert.Equal(t, tc.want, ids)
					assert.Equal(t, tc.total, total)
				})
			}
		})
	}
}

func TestInputAuditRecorderDeduplicationFailureAndOverflow(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	r, err := service.NewInputAuditRecorder(db)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(c, constant.ContextKeyUserId, 1)
	request := &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "audit me"}}}
	r.Capture(c, request)
	assert.Zero(t, r.Status().Pending)
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, r.UpdateSettings(context.Background(), settings))
	r.Capture(c, request)
	r.Capture(c, request)
	assert.Equal(t, 1, r.Status().Pending)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	r.Flush(cancelled)
	assert.EqualValues(t, 1, r.Status().Dropped)
	r.Capture(c, request)
	assert.Equal(t, 1, r.Status().Pending)
	settings.Enabled = false
	require.NoError(t, r.UpdateSettings(context.Background(), settings))
	r.Flush(context.Background())
	settings.Enabled = true
	require.NoError(t, r.UpdateSettings(context.Background(), settings))
	r.Capture(c, request)
	assert.Equal(t, 1, r.Status().Pending)
	r.Flush(context.Background())
	found, total, err := model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, found, 1)
	assert.Equal(t, "audit me", found[0].Content)
	for i := range 1025 {
		r.Capture(c, &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: fmt.Sprintf("input-%d", i)}}})
	}
	assert.Equal(t, 1024, r.Status().Pending)
	assert.EqualValues(t, 2, r.Status().Dropped)
}

func TestInputAuditAPIRequiresRootAndValidFilters(t *testing.T) {
	user, legacyToken := setupAccessTokenAudit(t)
	require.NoError(t, model.DB.AutoMigrate(&model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	_, token := createAccessTokenTestSession(t, user.Id, "input-audit-session")
	router := gin.New()
	router.GET("/api/input-audit", middleware.RootAuth(), GetInputAudits)
	router.GET("/api/input-audit/status", middleware.RootAuth(), GetInputAuditStatus)
	router.GET("/api/input-audit/matches", middleware.RootAuth(), GetInputAuditMatches)
	router.GET("/api/input-audit/matches/:match_id", middleware.RootAuth(), GetInputAuditMatch)
	router.POST("/api/input-audit/matches/:match_id/decision", middleware.RootAuth(), DecideInputAuditMatch)
	router.PUT("/api/input-audit/settings", middleware.RootAuth(), UpdateInputAuditSettings)
	router.GET("/api/input-audit/allowlist", middleware.RootAuth(), GetInputAuditAllowlist)
	router.PUT("/api/input-audit/allowlist", middleware.RootAuth(), UpdateInputAuditAllowlist)
	router.GET("/api/input-audit/allowlist/history", middleware.RootAuth(), GetInputAuditAllowlistHistory)
	router.GET("/api/input-audit/:audit_id/evidence", middleware.RootAuth(), GetInputAuditEvidence)
	router.GET("/api/input-audit/cases", middleware.RootAuth(), GetInputAuditCases)
	router.POST("/api/input-audit/cases", middleware.RootAuth(), CreateInputAuditCase)
	router.GET("/api/input-audit/cases/export", middleware.RootAuth(), ExportInputAuditLabels)
	router.GET("/api/input-audit/cases/:case_id", middleware.RootAuth(), GetInputAuditCase)
	router.POST("/api/input-audit/cases/:case_id/decisions", middleware.RootAuth(), DecideInputAuditCase)
	request := httptest.NewRequest(http.MethodGet, "/api/input-audit", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusForbidden, response.Code)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	for _, path := range []string{"/api/input-audit?user_id=-1", "/api/input-audit?page_size=-1", "/api/input-audit?start_timestamp=10&end_timestamp=9", "/api/input-audit?keyword=" + url.QueryEscape(strings.Repeat("审", 257)), "/api/input-audit?keyword=%FF", "/api/input-audit?keyword=%00"} {
		request = httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response = httptest.NewRecorder()
		router.ServeHTTP(response, request)
		assert.Equal(t, http.StatusBadRequest, response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/input-audit", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	require.NoError(t, model.DB.Create(&[]model.InputAudit{
		{UserId: user.Id, ContentHash: "matching", Content: "中文审计", CreatedAt: 10},
		{UserId: user.Id, ContentHash: "other", Content: "正常内容", CreatedAt: 10},
	}).Error)
	request = httptest.NewRequest(http.MethodGet, "/api/input-audit?keyword="+url.QueryEscape(" 审计 "), nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.InputAudit `json:"items"`
			Total int64              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.True(t, result.Success)
	assert.EqualValues(t, 1, result.Data.Total)
	require.Len(t, result.Data.Items, 1)
	assert.Equal(t, "中文审计", result.Data.Items[0].Content)

	// Message bodies and collection controls are restricted to browser sessions,
	// even when the token owner is root and has broad API grants.
	previousRetireAt := model.LegacyAccessTokenRetireAt()
	t.Cleanup(func() { setLegacyAccessTokenRetireAt(t, previousRetireAt) })
	setLegacyAccessTokenRetireAt(t, time.Now().Unix()+3600)
	scopedToken, _ := createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, "log:read", "system:write")
	for _, credential := range []string{legacyToken, scopedToken} {
		for _, route := range []struct{ method, path string }{
			{http.MethodGet, "/api/input-audit"},
			{http.MethodGet, "/api/input-audit/status"},
			{http.MethodGet, "/api/input-audit/matches"},
			{http.MethodGet, "/api/input-audit/matches/1"},
			{http.MethodPost, "/api/input-audit/matches/1/decision"},
			{http.MethodPut, "/api/input-audit/settings"},
			{http.MethodGet, "/api/input-audit/allowlist"},
			{http.MethodPut, "/api/input-audit/allowlist"},
			{http.MethodGet, "/api/input-audit/allowlist/history"},
			{http.MethodGet, "/api/input-audit/1/evidence"},
			{http.MethodGet, "/api/input-audit/cases"},
			{http.MethodPost, "/api/input-audit/cases"},
			{http.MethodGet, "/api/input-audit/cases/export"},
			{http.MethodGet, "/api/input-audit/cases/1"},
			{http.MethodPost, "/api/input-audit/cases/1/decisions"},
		} {
			request = httptest.NewRequest(route.method, route.path, nil)
			request.Header.Set("Authorization", "Bearer "+credential)
			response = httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.Contains(t, response.Body.String(), "AUTH_SESSION_REQUIRED")
		}
	}
	for _, updates := range []map[string]any{
		{"expires_at": time.Now().Unix() - 1},
		{"expires_at": time.Now().Unix() + 3600, "status": model.UserSessionStatusRevoked},
	} {
		require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", "input-audit-session").Updates(updates).Error)
		request = httptest.NewRequest(http.MethodGet, "/api/input-audit", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response = httptest.NewRecorder()
		router.ServeHTTP(response, request)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
		for _, path := range []string{"/api/input-audit/1/evidence", "/api/input-audit/cases", "/api/input-audit/cases/export", "/api/input-audit/allowlist"} {
			request = httptest.NewRequest("GET", path, nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response = httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
		}
	}
}

func TestInputAuditAllowlistDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
			oldDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = oldDB })
			previousInstances, err := common.Marshal(request_plugin_setting.GetInstances())
			require.NoError(t, err)
			previousAllowlist, err := common.Marshal(request_plugin_setting.GetAllowlist())
			require.NoError(t, err)
			t.Cleanup(func() {
				require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: string(previousInstances), request_plugin_setting.AllowlistOption: string(previousAllowlist)}))
			})
			filter, err := jsplugin.DefaultRegistry.Register(`export const meta = {apiVersion:1,key:"request-filter",name:"Filter test",version:"1.0.0",author:{name:"Test"}}; export function ingress(){return {action:"reject",code:"test.filter"}}; export function reply(){return {action:"stop",code:"test.reply"}}`, jsplugin.Options{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(filter.Meta.Key)) })
			other, err := jsplugin.DefaultRegistry.Register(`export const meta = {apiVersion:1,key:"audit-other",name:"Other guard",version:"1.0.0",author:{name:"Test"}}; export function ingress(){return {action:"reject",code:"test.other"}}`, jsplugin.Options{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(other.Meta.Key)) })
			require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: `[{"id":"filter","name":"Filter","plugin":"request-filter","enabled":true,"global":true},{"id":"other","name":"Other","plugin":"audit-other","enabled":true,"global":true}]`}))
			require.NoError(t, service.StartInputAuditRecorder())
			recorder := service.CurrentInputAuditRecorder()
			t.Cleanup(func() { service.StopInputAuditRecorder(context.Background()) })
			settings := model.DefaultInputAuditSettings()
			settings.Enabled = true
			require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
			policy := request_plugin_setting.Allowlist{Version: 1, Entries: []request_plugin_setting.AllowlistEntry{{ID: "approved", UserID: 7, Instances: []string{"filter", "other"}, Reason: "Test account", ExpiresAt: time.Now().Unix() + 3600}}}
			require.NoError(t, model.SaveInputAuditAllowlist(db, policy))
			loaded, err := model.LoadInputAuditAllowlist(db)
			require.NoError(t, err)
			assert.Equal(t, policy, loaded)
			assert.ErrorIs(t, model.SaveInputAuditAllowlist(db, policy), model.ErrInputAuditConflict)
			for _, tc := range []struct {
				user int
				code string
			}{{7, "test.other"}, {8, "test.filter"}} {
				response := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(response)
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"test-model","messages":[{"role":"user","content":"original audited text"}]}`))
				c.Request.Header.Set("Content-Type", "application/json")
				common.SetContextKey(c, constant.ContextKeyUserId, tc.user)
				common.SetContextKey(c, constant.ContextKeyOriginalModel, "test-model")
				recorder.Capture(c, &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "original audited text"}}})
				steps, _, apiErr := requestplugin.Ingress(c, types.RelayFormatOpenAI)
				require.NotNil(t, apiErr)
				assert.Contains(t, apiErr.Error(), tc.code)
				if tc.user == 7 {
					require.NotEmpty(t, steps)
					assert.Equal(t, "bypass", steps[0].Action)
					assert.Equal(t, "approved", steps[0].ExemptionID)
				}
			}
			recorder.Flush(context.Background())
			rows, total, err := model.QueryInputAudits(db, model.InputAuditFilter{UserId: 7}, 0, 20)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, rows, 1)
			assert.Equal(t, "original audited text", rows[0].Content)
			assert.Nil(t, policy.Match(7, "filter", "request-filter", policy.Entries[0].ExpiresAt))
			require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: `[{"id":"filter","name":"Filter","plugin":"request-filter","enabled":true,"global":true}]`}))
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"test","messages":[{"role":"user","content":"input"}]}`))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyUserId, 7)
			_, _, apiErr := requestplugin.Ingress(c, types.RelayFormatOpenAI)
			require.Nil(t, apiErr)
			info := &relaycommon.RelayInfo{OriginModelName: "test", RelayMode: relayconstant.RelayModeChatCompletions}
			finish := requestplugin.Reply(c, types.RelayFormatOpenAI, info)
			c.Writer.Header().Set("Content-Type", "application/json")
			_, err = c.Writer.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"unfiltered reply"}}]}`))
			require.NoError(t, err)
			finish()
			assert.Contains(t, fmt.Sprint(info.RequestPluginSteps), "bypass")
			dry := requestplugin.DryRun(context.Background(), requestplugin.DryRunInput{Format: "openai", Path: "/v1/chat/completions", Model: "test", User: jsplugin.TransformUser{ID: 7}, Body: []byte(`{"model":"test","messages":[{"role":"user","content":"input"}]}`)})
			require.NotNil(t, dry.Rejected)
			assert.Equal(t, "test.filter", dry.Rejected.Code)

			policy.Version, policy.Entries = 2, []request_plugin_setting.AllowlistEntry{}
			require.NoError(t, model.SaveInputAuditAllowlist(db, policy))
			assert.Nil(t, request_plugin_setting.GetAllowlist().Match(7, "filter", "request-filter", time.Now().Unix()))
			c, _ = gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"test","messages":[{"role":"user","content":"input"}]}`))
			common.SetContextKey(c, constant.ContextKeyUserId, 7)
			c.Request.Header.Set("Content-Type", "application/json")
			_, _, apiErr = requestplugin.Ingress(c, types.RelayFormatOpenAI)
			require.NotNil(t, apiErr)
			assert.Contains(t, apiErr.Error(), "test.filter")

		})
	}
}

func TestInputAuditRetainsOriginalBeforePluginRedactionAndRejection(t *testing.T) {
	require.NoError(t, i18n.Init())
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	previousDB, previousErrorLog := model.DB, constant.ErrorLogEnabled
	previousInstances, err := common.Marshal(request_plugin_setting.GetInstances())
	require.NoError(t, err)
	model.DB, constant.ErrorLogEnabled = db, false
	t.Cleanup(func() {
		model.DB, constant.ErrorLogEnabled = previousDB, previousErrorLog
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: string(previousInstances)}))
	})
	require.NoError(t, service.StartInputAuditRecorder())
	recorder := service.CurrentInputAuditRecorder()
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
	t.Cleanup(func() {
		settings.Enabled = false
		require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
		service.StopInputAuditRecorder(context.Background())
	})
	source := `export const meta = {apiVersion:1,key:"audit-retention",name:"Audit retention",version:"1.0.0",author:{name:"Test"}};
 export function ingress(ctx, req) {
  if (ctx.config.reject) return {action:"reject",code:"audit.blocked",message:req.body.messages[0].content};
  return {action:"continue",effects:[{type:"json.patch",ops:[{op:"replace",path:"/messages/0/content",value:"REDACTED"}]}]};
 }`
	plugin, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: `[{
 "id":"redact","name":"Redact","plugin":"audit-retention","enabled":true,"global":true,"config":{}},
 {"id":"reject","name":"Reject","plugin":"audit-retention","enabled":true,"global":true,"config":{"reject":true}}]`}))
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"audit-model","messages":[{"role":"user","content":"original evidence"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(c, constant.ContextKeyUserId, 55)
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "audit-model")
	c.Set(common.RequestIdKey, "audit-request")
	Relay(c, types.RelayFormatOpenAI)
	assert.Equal(t, http.StatusBadRequest, response.Code)
	assert.Contains(t, response.Body.String(), "REDACTED")
	assert.NotContains(t, response.Body.String(), "original evidence")
	recorder.Flush(context.Background())
	found, total, err := model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, found, 1)
	assert.Equal(t, "original evidence", found[0].Content)
	var original model.InputAuditEvidence
	require.NoError(t, db.Where("request_id = ?", "audit-request").First(&original).Error)
	var document model.InputAuditEvidenceDocument
	require.NoError(t, common.UnmarshalJsonStr(original.Body, &document))
	require.Len(t, document.Messages, 1)
	assert.Equal(t, "original evidence", document.Messages[0].Text)
	assert.Equal(t, "audit-request", found[0].RequestId)
	assert.Equal(t, 55, found[0].UserId)
}

func TestInputAuditEvidenceProtocolCompleteness(t *testing.T) {
	for _, tc := range []struct {
		name     string
		request  any
		complete bool
		want     string
	}{
		{"chat", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "system", Content: "context"}, {Role: "user", Content: "原文\x00🙂"}}}, true, "原文\x00🙂"},
		{"claude", &dto.ClaudeRequest{System: "context", Messages: []dto.ClaudeMessage{{Role: "user", Content: "question"}}}, true, "question"},
		{"gemini", &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "question"}}}}}, true, "question"},
		{"responses", &dto.OpenAIResponsesRequest{Instructions: []byte(`"context"`), Input: []byte(`[{"role":"user","content":[{"type":"input_text","text":"question"}]}]`)}, true, "question"},
		{"conversation context", &dto.OpenAIResponsesRequest{Conversation: []byte(`"conv_1"`), Input: []byte(`"question"`)}, false, "question"},
		{"external context", &dto.OpenAIResponsesRequest{PreviousResponseID: "external", Input: []byte(`"question"`)}, false, "question"},
		{"media omitted", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: []any{map[string]any{"type": "text", "text": "question"}, map[string]any{"type": "image_url", "image_url": "private-media"}}}}}, false, "question"},
		{"tool omitted", &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "question"}, {Role: "tool", Content: "private-tool"}}}, false, "question"},
		{"truncation", &dto.GeneralOpenAIRequest{Prompt: strings.Repeat("中", 2000)}, false, strings.Repeat("中", 1024)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			document := service.ExtractInputAuditEvidence(tc.request, 1024)
			assert.Equal(t, tc.complete, document.Complete())
			encoded, err := common.Marshal(document)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "private-media")
			assert.NotContains(t, string(encoded), "private-tool")
			require.NotEmpty(t, document.Messages)
			assert.Equal(t, tc.want, document.Messages[len(document.Messages)-1].Text)
		})
	}
	document := service.ExtractInputAuditEvidence(&dto.OpenAIResponsesRequest{Input: []byte(`[{"type":"function_call_output","output":"` + strings.Repeat("x", 1<<20) + `"}]`)}, 1024)
	assert.False(t, document.Complete())
	assert.Empty(t, document.Messages)
	assert.Contains(t, document.Omitted, "request_extraction_limit")
}

func TestInputAuditEvidenceCasesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
			previousDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = previousDB })
			recorder, err := service.NewInputAuditRecorder(db)
			require.NoError(t, err)
			settings := model.DefaultInputAuditSettings()
			settings.Enabled = true
			settings.EvidenceMaxChars = 65536
			require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
			// Same latest user input on different request events keeps distinct context evidence.
			original := "前文🙂引用" + strings.Repeat("中", 30000)
			for _, id := range []string{"first", "second"} {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
				common.SetContextKey(c, constant.ContextKeyUserId, 7)
				c.Set(common.RequestIdKey, id)
				recorder.Capture(c, &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "assistant", Content: id}, {Role: "user", Content: original}}})
			}
			recorder.Flush(context.Background())
			var evidence []model.InputAuditEvidence
			require.NoError(t, db.Order("id").Find(&evidence).Error)
			require.Len(t, evidence, 2)
			assert.NotEqual(t, evidence[0].DocumentHash, evidence[1].DocumentHash)
			assert.Greater(t, len(evidence[0].Body), 65536) // MySQL must retain a body larger than TEXT's byte limit.
			rows, _, err := model.QueryInputAudits(db, model.InputAuditFilter{}, 0, 20)
			require.NoError(t, err)
			require.Len(t, rows, 1)
			review, err := model.CreateInputAuditCase(db, rows[0].Id, 100, "Review original evidence")
			require.NoError(t, err)
			snapshot, err := model.InputAuditCaseSnapshotOf(review)
			require.NoError(t, err)
			assert.True(t, snapshot.Document.Complete())
			assert.Equal(t, original, snapshot.Document.Messages[1].Text)
			quote := []model.InputAuditEvidenceReference{{MessageIndex: 1, Quote: "🙂引用", Start: 999, End: 999}}
			assert.Error(t, model.DecideInputAuditCase(db, review.Id, 1, 100, "confirmed", "fraud", "fabricated", []model.InputAuditEvidenceReference{{MessageIndex: 1, Quote: "invented"}}))
			require.NoError(t, model.DecideInputAuditCase(db, review.Id, 1, 100, "confirmed", "fraud", "Verified exact evidence", quote))
			assert.ErrorIs(t, model.DecideInputAuditCase(db, review.Id, 1, 101, "dismissed", "fraud", "stale review", nil), model.ErrInputAuditConflict)
			require.NoError(t, model.DecideInputAuditCase(db, review.Id, 2, 101, "appeal_review", "fraud", "Recheck context", nil))
			require.NoError(t, model.DecideInputAuditCase(db, review.Id, 3, 101, "dismissed", "fraud", "Benign quotation", nil))
			var history []model.InputAuditDecision
			require.NoError(t, db.Where("case_id = ?", review.Id).Order("version").Find(&history).Error)
			require.Len(t, history, 3)
			var refs []model.InputAuditEvidenceReference
			require.NoError(t, common.UnmarshalJsonStr(history[0].References, &refs))
			require.Len(t, refs, 1)
			assert.Equal(t, 2, refs[0].Start)
			assert.Equal(t, 5, refs[0].End)
			router := gin.New()
			router.GET("/export", ExportInputAuditLabels)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/export", nil))
			assert.Equal(t, 200, response.Code)
			assert.Contains(t, response.Body.String(), `"fraud":false`)
			// Concurrent reviewers cannot overwrite each other's decisions.
			if dialect != "sqlite" {
				sqlDB, err := db.DB()
				require.NoError(t, err)
				sqlDB.SetMaxOpenConns(2)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			for actor := range 2 {
				go func(operator int) {
					<-start
					results <- model.DecideInputAuditCase(db, review.Id, 4, operator+100, "pending", "fraud", "Concurrent review", nil)
				}(actor)
			}
			close(start)
			first, second := <-results, <-results
			if first == nil {
				assert.ErrorIs(t, second, model.ErrInputAuditConflict)
			} else {
				assert.ErrorIs(t, first, model.ErrInputAuditConflict)
				assert.NoError(t, second)
			}
			// Rolling deletion cannot rewrite or remove a pinned snapshot.
			now := time.Now().Unix()
			require.NoError(t, db.Model(&model.InputAuditEvidence{}).Where("id > ?", 0).Update("created_at", now-8*86400).Error)
			require.NoError(t, model.PersistInputAuditEvidence(db, nil, now))
			require.NoError(t, db.Where("id > ?", 0).Delete(&model.InputAudit{}).Error)
			require.NoError(t, db.First(&review, review.Id).Error)
			after, err := model.InputAuditCaseSnapshotOf(review)
			require.NoError(t, err)
			assert.Equal(t, snapshot, after)
			// Legacy previews cannot be promoted to complete evidence or exported as labels.
			legacy := model.InputAudit{UserId: 8, ContentHash: "legacy", Content: "incomplete", CreatedAt: now}
			require.NoError(t, db.Create(&legacy).Error)
			missing, err := model.CreateInputAuditCase(db, legacy.Id, 100, "Legacy case")
			require.NoError(t, err)
			assert.Error(t, model.DecideInputAuditCase(db, missing.Id, 1, 100, "confirmed", "fraud", "Incomplete context", []model.InputAuditEvidenceReference{{MessageIndex: 0, Quote: "incomplete"}}))
			require.NoError(t, model.DecideInputAuditCase(db, missing.Id, 1, 100, "dismissed", "fraud", "Insufficient context", nil))
			response = httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/export", nil))
			assert.NotContains(t, response.Body.String(), `"text":"incomplete"`)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
			}
			require.NoError(t, db.First(&review, review.Id).Error)
			assert.EqualValues(t, 5, review.Version)
			require.NoError(t, db.Model(&model.InputAuditCase{}).Where("id = ?", missing.Id).Update("expires_at", now).Error)
			_, err = model.CreateInputAuditCase(db, legacy.Id, 100, "Expired case")
			assert.Error(t, err)
			require.NoError(t, model.PersistInputAuditEvidence(db, nil, now))
			assert.ErrorIs(t, db.First(&model.InputAuditCase{}, missing.Id).Error, gorm.ErrRecordNotFound)
		})
	}
}

func TestInputAuditAllowlistAPIValidationAndRevocation(t *testing.T) {
	user, _ := setupAccessTokenAudit(t)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	_, token := createAccessTokenTestSession(t, user.Id, "allowlist-session")
	require.NoError(t, model.DB.AutoMigrate(&model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	oldInstances, err := common.Marshal(request_plugin_setting.GetInstances())
	require.NoError(t, err)
	oldPolicy, err := common.Marshal(request_plugin_setting.GetAllowlist())
	require.NoError(t, err)
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: string(oldInstances), request_plugin_setting.AllowlistOption: string(oldPolicy)}))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: `[{"id":"filter","plugin":"request-filter"},{"id":"other","plugin":"request-redact"}]`}))
	require.NoError(t, service.StartInputAuditRecorder())
	t.Cleanup(func() { service.StopInputAuditRecorder(context.Background()) })
	recorder := service.CurrentInputAuditRecorder()
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
	router := gin.New()
	router.PUT("/api/input-audit/allowlist", middleware.RootAuth(), UpdateInputAuditAllowlist)
	valid := request_plugin_setting.AllowlistEntry{UserID: user.Id, Instances: []string{"filter"}, Reason: "Approved account", ExpiresAt: time.Now().Unix() + 3600, CreatedBy: 999, CreatedAt: 1}
	for _, tc := range []struct {
		name   string
		change func(*request_plugin_setting.AllowlistEntry)
	}{
		{"other plugin", func(e *request_plugin_setting.AllowlistEntry) { e.Instances = []string{"other"} }},
		{"unknown user", func(e *request_plugin_setting.AllowlistEntry) { e.UserID = 999999 }},
		{"expired", func(e *request_plugin_setting.AllowlistEntry) { e.ExpiresAt = time.Now().Unix() }},
		{"empty reason", func(e *request_plugin_setting.AllowlistEntry) { e.Reason = " " }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := valid
			tc.change(&entry)
			body, err := common.Marshal(request_plugin_setting.Allowlist{Entries: []request_plugin_setting.AllowlistEntry{entry}})
			require.NoError(t, err)
			request := httptest.NewRequest("PUT", "/api/input-audit/allowlist", strings.NewReader(string(body)))
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, 400, response.Code)
		})
	}
	for _, version := range []int64{0, 1} {
		policy, err := model.LoadInputAuditAllowlist(model.DB)
		require.NoError(t, err)
		if version == 0 {
			policy.Entries = []request_plugin_setting.AllowlistEntry{valid}
		} else {
			policy.Entries[0].Reason = "Renewed approval"
			policy.Entries[0].ExpiresAt += 3600
		}
		body, err := common.Marshal(policy)
		require.NoError(t, err)
		request := httptest.NewRequest("PUT", "/api/input-audit/allowlist", strings.NewReader(string(body)))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, 200, response.Code)
		saved, err := model.LoadInputAuditAllowlist(model.DB)
		require.NoError(t, err)
		require.Len(t, saved.Entries, 1)
		assert.Equal(t, user.Id, saved.Entries[0].CreatedBy)
		assert.NotEqualValues(t, 1, saved.Entries[0].CreatedAt)
		assert.EqualValues(t, version+1, saved.Version)
	}
	body, err := common.Marshal(request_plugin_setting.Allowlist{Version: 2, Entries: []request_plugin_setting.AllowlistEntry{}})
	require.NoError(t, err)
	request := httptest.NewRequest("PUT", "/api/input-audit/allowlist", strings.NewReader(string(body)))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, 200, response.Code)
	policy, err := model.LoadInputAuditAllowlist(model.DB)
	require.NoError(t, err)
	assert.Empty(t, policy.Entries)
	assert.EqualValues(t, 3, policy.Version)
	var revisions []model.InputAuditPolicyRevision
	require.NoError(t, model.DB.Order("version").Find(&revisions).Error)
	require.Len(t, revisions, 3)
	assert.Contains(t, revisions[0].Policy, "Approved account")
	assert.Contains(t, revisions[1].Policy, "Renewed approval")
}

func TestInputAuditEvidenceFallbackAndQueueLimits(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	recorder, err := service.NewInputAuditRecorder(db)
	require.NoError(t, err)
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(c, constant.ContextKeyUserId, 9)
	request := &dto.GeneralOpenAIRequest{Prompt: "fallback input"}
	recorder.Capture(c, request)
	request.Prompt = "changed after capture"
	recorder.Flush(context.Background())
	var audit model.InputAudit
	require.NoError(t, db.First(&audit).Error)
	assert.NotEmpty(t, audit.RequestId)
	var evidence model.InputAuditEvidence
	require.NoError(t, db.Where("request_id = ?", audit.RequestId).First(&evidence).Error)
	assert.Contains(t, evidence.Body, "fallback input")
	assert.NotContains(t, evidence.Body, "changed after capture")
	for i := range 65 {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
		common.SetContextKey(c, constant.ContextKeyUserId, 9)
		c.Set(common.RequestIdKey, fmt.Sprint(i))
		recorder.Capture(c, &dto.GeneralOpenAIRequest{Prompt: "queued message"})
	}
	assert.Equal(t, 64, recorder.Status().EvidencePending)
	assert.EqualValues(t, 1, recorder.Status().EvidenceDropped)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	recorder.Flush(cancelled)
	assert.EqualValues(t, 33, recorder.Status().EvidenceDropped)
	assert.EqualValues(t, 1, recorder.Status().EvidenceWriteFailures)
}

func TestInputAuditRealtimeEventsKeepOriginalTextAndMissingContext(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}, &model.InputAuditPolicyRevision{}))
	recorder, err := service.NewInputAuditRecorder(db)
	require.NoError(t, err)
	settings := model.DefaultInputAuditSettings()
	settings.Enabled = true
	require.NoError(t, recorder.UpdateSettings(context.Background(), settings))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/v1/realtime", nil)
	c.Set(common.RequestIdKey, "session-id")
	common.SetContextKey(c, constant.ContextKeyUserId, 5)
	recorder.CaptureRealtimeEvent(c, "conversation.item.create", []byte(`{"item":{"type":"message","role":"user","content":[{"type":"input_text","text":"original realtime text"}]}}`))
	recorder.CaptureRealtimeEvent(c, "response.create", []byte(`{"response":{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"second event"}]}]}}`))
	recorder.CaptureRealtimeEvent(c, "input_audio_buffer.append", []byte(`{"audio":"private audio"}`))
	recorder.Flush(context.Background())
	var events []model.InputAuditEvidence
	require.NoError(t, db.Order("id").Find(&events).Error)
	require.Len(t, events, 2)
	assert.NotEqual(t, events[0].RequestId, events[1].RequestId)
	for _, event := range events {
		var document model.InputAuditEvidenceDocument
		require.NoError(t, common.UnmarshalJsonStr(event.Body, &document))
		assert.True(t, document.ContextMissing)
		assert.False(t, document.Complete())
		assert.NotContains(t, event.Body, "private audio")
	}
	assert.Contains(t, events[0].Body, "original realtime text")
	assert.Equal(t, "session-id", c.GetString(common.RequestIdKey))
}

func TestInputAuditModelReviewDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			require.NoError(t, db.Migrator().DropTable(&model.InputAuditReviewResult{}, &model.InputAuditReviewJob{}))
			var version string
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			// Upgrade representative released options/users and existing audit data;
			// the independent fresh schema is exercised by the second migration pass.
			require.NoError(t, db.AutoMigrate(&model.Option{}, &inputAuditReleasedUser{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}))
			require.NoError(t, db.Create(&model.Option{Key: "existing-model-review-fixture", Value: "keep"}).Error)
			require.NoError(t, db.Create(&inputAuditReleasedUser{Username: "existing-review-user", Password: "fixture"}).Error)
			settings := model.DefaultInputAuditSettings()
			settings.Enabled = true
			require.NoError(t, model.SaveInputAuditSettings(db, settings))
			audit := model.InputAudit{UserId: 9, ContentHash: "review-hash", RequestId: "review-request", CreatedAt: time.Now().Unix(), Content: "quoted evidence", Username: "alice"}
			require.NoError(t, db.Create(&audit).Error)
			require.NoError(t, db.Migrator().DropColumn(&model.InputAudit{}, "ReviewAttemptedAt"))
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InputAudit{}, &model.InputAuditReviewJob{}, &model.InputAuditReviewResult{}))
			}
			var preserved model.Option
			require.NoError(t, db.Where(&model.Option{Key: "existing-model-review-fixture"}).First(&preserved).Error)
			assert.Equal(t, "keep", preserved.Value)
			assert.Error(t, db.Create(&inputAuditReleasedUser{Username: "existing-review-user", Password: "duplicate"}).Error)
			assert.Error(t, db.Create(&model.InputAudit{UserId: 9, ContentHash: "review-hash"}).Error)
			var response = `{"status":"review","category":"cyber_abuse","confidence":91,"reason":"Needs context and human review","quote":"quoted evidence"}`
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "Bearer fixture", r.Header.Get("Authorization"))
				var payload struct {
					Model    string `json:"model"`
					Messages []struct {
						Role    string `json:"role"`
						Content string `json:"content"`
					} `json:"messages"`
				}
				require.NoError(t, common.DecodeJson(r.Body, &payload))
				assert.Equal(t, "review-model", payload.Model)
				require.Len(t, payload.Messages, 2)
				assert.Equal(t, "system", payload.Messages[0].Role)
				assert.Contains(t, payload.Messages[0].Content, "Custom review policy")
				assert.Contains(t, payload.Messages[1].Content, "quoted evidence")
				encoded, err := common.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": response}}}})
				require.NoError(t, err)
				w.Header().Set("Content-Type", "application/json")
				_, err = w.Write(encoded)
				require.NoError(t, err)
			}))
			defer upstream.Close()
			t.Setenv("INPUT_AUDIT_LLM_TEST_KEY", "fixture")
			config := model.DefaultInputAuditReviewSettings()
			config.Enabled = true
			config.Endpoint = upstream.URL
			config.Model = "review-model"
			config.APIKey = "fixture"
			config.KeyEnv = "INPUT_AUDIT_LLM_TEST_KEY"
			config.SystemPrompt = "Custom review policy"
			config.BatchSize = 1
			config.Retries = 0
			config.RequestIntervalSeconds = 1
			require.NoError(t, model.SaveInputAuditReviewSettings(db, config))
			job, err := model.CreateInputAuditReviewJob(db, "incremental", 0, 1, false)
			require.NoError(t, err)
			_, err = model.CreateInputAuditReviewJob(db, "incremental", 0, 1, false)
			require.Error(t, err)
			require.NoError(t, service.ProcessInputAuditReviewStep(context.Background(), db, upstream.Client()))
			var result model.InputAuditReviewResult
			require.NoError(t, db.Where("job_id = ?", job.Id).First(&result).Error)
			assert.Equal(t, "review", result.Status)
			assert.False(t, result.Complete)
			assert.Equal(t, "quoted evidence", result.Quote)
			require.NoError(t, db.First(&job, job.Id).Error)
			assert.Equal(t, "completed", job.Status)
			assert.Equal(t, 1, job.Processed)
			assert.Equal(t, 1, job.Flagged)
			duplicate := result
			duplicate.Id = 0
			assert.Error(t, db.Create(&duplicate).Error)
			// Completed records are skipped, and abandoned leases are recoverable.
			next, err := model.CreateInputAuditReviewJob(db, "incremental", 0, 1, false)
			require.NoError(t, err)
			require.NoError(t, db.Model(&next).Updates(map[string]any{"status": "running", "lease_until": time.Now().Unix() - 1, "lease_token": "abandoned"}).Error)
			require.NoError(t, service.ProcessInputAuditReviewStep(context.Background(), db, upstream.Client()))
			require.NoError(t, db.First(&next, next.Id).Error)
			assert.Equal(t, 0, next.Processed)
			assert.Equal(t, "completed", next.Status)
			// Failed model evidence never becomes a successful review or a sanction.
			response = `{"status":"review","category":"cyber_abuse","confidence":91,"reason":"fabricated","quote":"not in original"}`
			failed, err := model.CreateInputAuditReviewJob(db, "all", 9, 1, false)
			require.NoError(t, err)
			require.NoError(t, service.ProcessInputAuditReviewStep(context.Background(), db, upstream.Client()))
			result = model.InputAuditReviewResult{}
			require.NoError(t, db.Where("job_id = ?", failed.Id).First(&result).Error)
			assert.Equal(t, "failed", result.Status)
			assert.Equal(t, "invalid_model_verdict", result.Reason)
			require.NoError(t, db.First(&failed, failed.Id).Error)
			assert.Equal(t, 1, failed.Failed)
			retryJob, err := model.CreateInputAuditReviewJob(db, "failed", 9, 1, false)
			require.NoError(t, err)
			candidate, err := model.NextInputAuditForReview(db, retryJob)
			require.NoError(t, err)
			assert.Equal(t, audit.Id, candidate.Id)
			require.NoError(t, db.Model(&retryJob).Update("status", "cancelled").Error)
			// Incremental scans do not repeatedly retry old failures and starve new messages.
			candidate, err = model.NextInputAuditForReview(db, model.InputAuditReviewJob{Mode: "incremental", UpperId: audit.Id})
			assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
			assert.Zero(t, candidate.Id)
			// Cancellation fences even a claimed job; workers must not publish later.
			cancelled, err := model.CreateInputAuditReviewJob(db, "all", 0, 1, false)
			require.NoError(t, err)
			require.NoError(t, db.Model(&cancelled).Update("status", "cancelled").Error)
			require.NoError(t, service.ProcessInputAuditReviewStep(context.Background(), db, upstream.Client()))
			var count int64
			require.NoError(t, db.Model(&model.InputAuditReviewResult{}).Where("job_id = ?", cancelled.Id).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, db.Model(&model.InputAuditReviewJob{}).Where("id = ?", job.Id).Update("created_at", time.Now().Unix()-91*86400).Error)
			require.NoError(t, model.PruneInputAuditReviews(db, 30, time.Now().Unix()))
			require.NoError(t, db.Model(&model.InputAuditReviewResult{}).Where("job_id = ?", job.Id).Count(&count).Error)
			assert.Zero(t, count)
			// Expiring old results never makes the incremental worker loop over
			// already attempted messages instead of reaching newer messages.
			candidate, err = model.NextInputAuditForReview(db, model.InputAuditReviewJob{Mode: "incremental", UpperId: audit.Id})
			assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
			assert.Zero(t, candidate.Id)
			config.Automatic = true
			require.NoError(t, model.SaveInputAuditReviewSettings(db, config))
			notDue, err := model.CreateInputAuditReviewJob(db, "incremental", 0, 0, true)
			require.NoError(t, err)
			assert.Zero(t, notDue.Id)
			require.NoError(t, db.Model(&cancelled).Update("created_at", time.Now().Unix()-3601).Error)
			due, err := model.CreateInputAuditReviewJob(db, "incremental", 0, 0, true)
			require.NoError(t, err)
			assert.Positive(t, due.Id)
			assert.Zero(t, due.CreatedBy)
			require.NoError(t, service.ProcessInputAuditReviewStep(context.Background(), db, upstream.Client()))
			require.NoError(t, db.First(&due, due.Id).Error)
			assert.Equal(t, "completed", due.Status)
			// Fresh install and repeat startup preserve the new unique constraints.
			require.NoError(t, db.Migrator().DropTable(&model.InputAuditReviewResult{}, &model.InputAuditReviewJob{}))
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InputAuditReviewJob{}, &model.InputAuditReviewResult{}))
			}
			defaults, err := model.LoadInputAuditReviewSettings(db)
			require.NoError(t, err)
			assert.Equal(t, config, defaults)
		})
	}
}

func TestInputAuditModelReviewEvidenceAndResponseContracts(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}))
	_, err := model.LoadInputAuditSettings(db)
	require.NoError(t, err)
	audit := model.InputAudit{UserId: 4, RequestId: "request", ContentHash: "hash", Content: "retained preview"}
	var response string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		encoded, e := common.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": response}}}})
		require.NoError(t, e)
		_, e = w.Write(encoded)
		require.NoError(t, e)
	}))
	defer upstream.Close()
	settings := model.DefaultInputAuditReviewSettings()
	settings.Endpoint = upstream.URL
	settings.KeyEnv = ""
	settings.Model = "test"
	settings.Retries = 0
	settings.RequestIntervalSeconds = 0
	for _, tc := range []struct{ name, verdict, want string }{
		{"safe preview remains incomplete", `{"status":"safe","category":"other","confidence":99,"reason":"No risk","quote":""}`, "insufficient_evidence"},
		{"missing confidence is rejected", `{"status":"safe","category":"other","reason":"No risk"}`, "failed"},
		{"invalid category is rejected", `{"status":"review","category":"invented","confidence":90,"reason":"Risk","quote":"retained"}`, "failed"},
		{"out of range confidence is rejected", `{"status":"safe","category":"other","confidence":101,"reason":"No risk"}`, "failed"},
		{"unknown JSON cannot pass", `{"ok":true}`, "failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response = tc.verdict
			result := service.ReviewInputAudit(context.Background(), db, upstream.Client(), settings, audit)
			assert.Equal(t, tc.want, result.Status)
		})
	}
	document := model.InputAuditEvidenceDocument{Source: "client_request", Messages: []model.InputAuditEvidenceMessage{{Role: "user", Text: strings.Repeat("a", 1500) + "boundary evidence"}}}
	encoded, err := common.Marshal(document)
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.InputAuditEvidence{UserId: 4, RequestId: "request", ContentHash: "hash", Body: string(encoded), CreatedAt: time.Now().Unix()}).Error)
	settings.ChunkChars = 1000
	response = `{"status":"safe","category":"other","confidence":99,"reason":"No risk","quote":""}`
	result := service.ReviewInputAudit(context.Background(), db, upstream.Client(), settings, audit)
	assert.True(t, result.Complete)
	assert.Equal(t, "safe", result.Status)
	assert.Equal(t, 2, result.Chunks)
	for _, endpoint := range []string{"http://example.com/v1/chat/completions", "https://user:pass@example.com", "https://example.com/?key=secret"} {
		settings = model.DefaultInputAuditReviewSettings()
		settings.Endpoint = endpoint
		assert.Error(t, settings.Validate())
	}
	settings = model.DefaultInputAuditReviewSettings()
	settings.KeyEnv = "DATABASE_PASSWORD"
	assert.Error(t, settings.Validate())
}

func TestInputAuditDecisiveMatchCapture(t *testing.T) {
	source, err := os.ReadFile("../plugins/tasks/request-filter/plugin.js")
	require.NoError(t, err)
	plugin, err := jsplugin.CompilePlugin(string(source), jsplugin.Options{})
	require.NoError(t, err)
	for _, tc := range []struct{ name, body, config, path, role, quote, representation string }{
		{"system prohibition is evidence not guilt", `{"messages":[{"role":"system","content":"禁止生成色情内容"},{"role":"user","content":"hello"}]}`, `{"rules":[{"id":"色情","pattern":"色情"}]}`, "/messages/0/content", "system", "色情", "original"},
		{"tool hit beyond preview cap", `{"messages":[{"role":"tool","content":"` + strings.Repeat("前", 40000) + `色情` + strings.Repeat("后", 1000) + `"},{"role":"user","content":"hello"}]}`, `{"rules":[{"pattern":"色情"}]}`, "/messages/0/content", "tool", "色情", "original"},
		{"normalization is explicitly labeled", `{"messages":[{"role":"user","content":"ｓｅｃｒｅｔ"}]}`, `{"normalizeText":true,"rules":[{"pattern":"secret"}]}`, "/messages/0/content", "user", "secret", "transformed"},
		{"regex with emoji context", `{"input":[{"role":"user","content":[{"type":"input_text","text":"😀 secret-1234 中文"}]}]}`, `{"rules":[{"pattern":"secret-\\d+","type":"regex"}]}`, "/input/0/content/0/text", "user", "secret-1234", "original"},
		{"keyword list", `{"system":"contains 色情 here"}`, `{"keywords":"色情"}`, "/system", "system", "色情", "original"},
		{"serialized tool arguments", `{"messages":[{"role":"assistant","tool_calls":[{"function":{"name":"search","arguments":{"query":"色情"}}}]}]}`, `{"rules":[{"pattern":"色情"}]}`, "/messages/0/tool_calls/0/function/arguments", "assistant", "色情", "original"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config, err := plugin.ValidateConfig([]byte(tc.config))
			require.NoError(t, err)
			result, err := plugin.CallTransform(t.Context(), jsplugin.TransformContext{Stage: "ingress", Format: "openai", CaptureEvidence: true, Config: config}, jsplugin.TransformRequest{Body: []byte(tc.body)})
			require.NoError(t, err)
			require.Equal(t, "reject", result.Action)
			require.NotNil(t, result.Evidence)
			assert.Equal(t, tc.path, result.Evidence.Path)
			assert.Equal(t, tc.role, result.Evidence.Role)
			assert.Equal(t, tc.quote, result.Evidence.Match)
			assert.Equal(t, tc.representation, result.Evidence.Representation)
			assert.LessOrEqual(t, utf8.RuneCountInString(result.Evidence.Before), 300)
			assert.LessOrEqual(t, utf8.RuneCountInString(result.Evidence.After), 300)
			encoded, err := common.Marshal(result.Evidence)
			require.NoError(t, err)
			assert.LessOrEqual(t, len(encoded), 8192)
			// Older hosts, dry runs and disabled capture keep the same rejection.
			old, err := plugin.CallTransform(t.Context(), jsplugin.TransformContext{Stage: "ingress", Format: "openai", Config: config}, jsplugin.TransformRequest{Body: []byte(tc.body)})
			require.NoError(t, err)
			assert.Equal(t, result.RuleID, old.RuleID)
			assert.Nil(t, old.Evidence)
		})
	}
	// Optional malformed evidence cannot weaken the original rejection.
	malformed, err := jsplugin.CompilePlugin(`export const meta={apiVersion:1,key:"bad-evidence",name:"Fixture",version:"1.0.0",author:{name:"Test"}}; export function ingress(){ return {action:"reject",code:"blocked",evidence:{method:"keyword",representation:"original",before:"x".repeat(9000)}}; }`, jsplugin.Options{})
	require.NoError(t, err)
	result, err := malformed.CallTransform(t.Context(), jsplugin.TransformContext{Stage: "ingress", CaptureEvidence: true}, jsplugin.TransformRequest{Body: []byte(`{}`)})
	require.NoError(t, err)
	assert.Equal(t, "reject", result.Action)
	assert.Nil(t, result.Evidence)
}

func TestInputAuditMatchDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database: %s", version)
			// Start with representative released options/users, then add audit tables.
			require.NoError(t, db.AutoMigrate(&model.Option{}, &inputAuditReleasedUser{}))
			require.NoError(t, db.Create(&inputAuditReleasedUser{Username: "existing", Password: "fixture"}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InputAuditMatch{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditCase{}, &model.InputAuditDecision{}))
			}
			assert.Error(t, db.Create(&inputAuditReleasedUser{Username: "existing", Password: "fixture"}).Error)
			settings := model.DefaultInputAuditSettings()
			settings.Enabled, settings.EvidenceEnabled = true, true
			require.NoError(t, model.SaveInputAuditSettings(db, settings))
			recorder, err := service.NewInputAuditRecorder(db)
			require.NoError(t, err)
			evidence := &jsplugin.TransformMatchEvidence{Path: "/messages/0/content", Role: "system", Before: "禁止", Match: "色情", After: "内容 %_!", Method: "keyword", Representation: "original"}
			for _, requestID := range []string{"request-one", "request-two"} {
				recorder.CaptureMatch(model.InputAuditMatch{RequestId: requestID, UserId: 61, Rule: "色情"}, evidence)
			}
			recorder.Flush(t.Context())
			var rows []model.InputAuditMatch
			require.NoError(t, db.Order("id").Find(&rows).Error)
			require.Len(t, rows, 2)
			assert.NotEqual(t, rows[0].RequestId, rows[1].RequestId)
			assert.Contains(t, rows[0].SearchText, "色情")
			assert.Contains(t, rows[0].Evidence, "禁止")
			require.NoError(t, model.DecideInputAuditMatch(db, rows[0].Id, 1, 1, "dismissed", "The system instruction forbids this content"))
			assert.Error(t, model.DecideInputAuditMatch(db, rows[0].Id, 1, 2, "confirmed", "Stale decision"))
			var decided model.InputAuditMatch
			require.NoError(t, db.First(&decided, rows[0].Id).Error)
			assert.Equal(t, "dismissed", decided.Status)
			assert.EqualValues(t, 2, decided.Version)
			// Search the private retained context, never the last-user preview.
			oldDB := model.DB
			model.DB = db
			defer func() { model.DB = oldDB }()
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest("GET", "/?user_id=61&keyword="+url.QueryEscape("%_!"), nil)
			GetInputAuditMatches(c)
			require.Equal(t, 200, response.Code)
			assert.Contains(t, response.Body.String(), `"total":2`)
			assert.NotContains(t, response.Body.String(), "禁止")
			// Restart migration preserves captured data and adjudication.
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InputAuditMatch{}))
			}
			require.NoError(t, db.First(&decided, rows[0].Id).Error)
			assert.Equal(t, "dismissed", decided.Status)
			// Collection off discards new evidence, while retention still cleans up.
			settings.EvidenceEnabled = false
			require.NoError(t, recorder.UpdateSettings(t.Context(), settings))
			recorder.CaptureMatch(model.InputAuditMatch{RequestId: "disabled", UserId: 61}, evidence)
			assert.Zero(t, recorder.Status().MatchPending)
			require.NoError(t, model.PersistInputAuditMatches(db, nil, time.Now().Unix()+int64(settings.RetentionDays+1)*86400))
			var count int64
			require.NoError(t, db.Model(&model.InputAuditMatch{}).Count(&count).Error)
			assert.Zero(t, count)
			// Fresh creation also remains idempotent.
			require.NoError(t, db.Migrator().DropTable(&model.InputAuditMatch{}))
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InputAuditMatch{}))
			}
		})
	}
}

func TestInputAuditMatchLiveIngressIsPrivateAndDryRunDoesNotPersist(t *testing.T) {
	require.NoError(t, i18n.Init())
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}, &model.InputAuditEvidence{}, &model.InputAuditMatch{}, &model.InputAuditCase{}, &model.InputAuditDecision{}))
	oldDB := model.DB
	model.DB = db
	defer func() { model.DB = oldDB }()
	oldInstances, err := common.Marshal(request_plugin_setting.GetInstances())
	require.NoError(t, err)
	defer func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: string(oldInstances)}))
	}()
	source, err := os.ReadFile("../plugins/tasks/request-filter/plugin.js")
	require.NoError(t, err)
	plugin, err := jsplugin.DefaultRegistry.Register(string(source), jsplugin.Options{})
	require.NoError(t, err)
	defer func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key)) }()
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{request_plugin_setting.InstancesOption: `[{"id":"match-test","name":"Filter","plugin":"request-filter","enabled":true,"global":true,"config":{"rules":[{"id":"sexual","pattern":"色情"}]}}]`}))
	settings := model.DefaultInputAuditSettings()
	settings.Enabled, settings.EvidenceEnabled = true, true
	require.NoError(t, model.SaveInputAuditSettings(db, settings))
	require.NoError(t, service.StartInputAuditRecorder())
	defer service.StopInputAuditRecorder(context.Background())
	body := `{"model":"test","messages":[{"role":"system","content":"禁止生成色情内容"},{"role":"user","content":"hello"}]}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, "live-evidence-request")
	common.SetContextKey(c, constant.ContextKeyUserId, 61)
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "test")
	steps, public, apiErr := requestplugin.Ingress(c, types.RelayFormatOpenAI)
	require.NotNil(t, apiErr)
	require.Len(t, steps, 1)
	assert.Equal(t, "reject", steps[0].Action)
	encoded, err := common.Marshal(public)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "色情")
	assert.NotContains(t, string(encoded), "禁止")
	recorder := service.CurrentInputAuditRecorder()
	assert.Equal(t, 1, recorder.Status().MatchPending)
	plan := requestplugin.NewPlan()
	require.NotNil(t, plan)
	outcome := plan.Run(t.Context(), requestplugin.Call{Stage: "ingress", Format: "openai", Body: []byte(body)})
	require.NotNil(t, outcome.Rejected)
	assert.Equal(t, 1, recorder.Status().MatchPending)
	recorder.Flush(t.Context())
	var saved model.InputAuditMatch
	require.NoError(t, db.First(&saved).Error)
	assert.Equal(t, "live-evidence-request", saved.RequestId)
	assert.Contains(t, saved.Evidence, "禁止生成")
	assert.Equal(t, 61, saved.UserId)
}

func TestInputAuditModelReviewCredentialSettings(t *testing.T) {
	oldRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = oldRedis })
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := inputAuditTestDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.AuditLog{}))
			previous := model.DB
			previousLog := model.LOG_DB
			model.LOG_DB = db
			model.DB = db
			t.Cleanup(func() { model.DB = previous; model.LOG_DB = previousLog })
			config := model.DefaultInputAuditReviewSettings()
			require.NoError(t, model.SaveInputAuditReviewSettings(db, config))
			user := model.User{Username: "audit-settings-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("id", user.Id); c.Set("role", user.Role); c.Set("username", user.Username) })
			router.PUT("/settings", UpdateInputAuditReviewSettings)
			router.GET("/settings", GetInputAuditReviewSettings)
			for _, key := range []string{"test-key", ""} {
				config.APIKey = key
				body, err := common.Marshal(config)
				require.NoError(t, err)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings", bytes.NewReader(body)))
				require.Equal(t, http.StatusOK, w.Code)
				saved, err := model.LoadInputAuditReviewSettings(db)
				require.NoError(t, err)
				assert.Equal(t, "test-key", saved.APIKey)
				var stored model.Option
				require.NoError(t, db.Where(&model.Option{Key: model.InputAuditReviewOption}).First(&stored).Error)
				assert.NotContains(t, stored.Value, "test-key")
				w = httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/settings", nil))
				require.Equal(t, http.StatusOK, w.Code)
				assert.NotContains(t, w.Body.String(), "test-key")
				assert.Contains(t, w.Body.String(), `"key_configured":true`)
				assert.Contains(t, w.Body.String(), `"default_system_prompt"`)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings", strings.NewReader(`{"clear_api_key":true}`)))
			require.Equal(t, http.StatusOK, w.Code)
			saved, err := model.LoadInputAuditReviewSettings(db)
			require.NoError(t, err)
			assert.Empty(t, saved.APIKey)
			assert.Empty(t, saved.KeyEnv)
			config.APIKey = "key\r\ninvalid"
			assert.Error(t, config.Validate())
		})
	}
}

func TestInputAuditReviewCredentialDisclosureProof(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Option{}))
	config := model.DefaultInputAuditReviewSettings()
	config.APIKey = "audit-saved-secret"
	require.NoError(t, model.SaveInputAuditReviewSettings(model.DB, config))
	oldPasswordLogin := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() { common.PasswordLoginEnabled = oldPasswordLogin })
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "audit-credential-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	router := gin.New()
	router.POST("/credential", middleware.RootAuth(), GetInputAuditReviewCredential)
	request := func(proof string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/credential", nil)
		r.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
		r.Header.Set("X-Security-Proof", proof)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	assert.Equal(t, http.StatusForbidden, request("").Code)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	for _, scope := range []string{"", service.VerificationScopeCommunityKeyRead} {
		proof := ""
		if scope != "" {
			proof = issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: scope}, service.VerificationMethodPassword)
		}
		w := request(proof)
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.NotContains(t, w.Body.String(), "audit-saved-secret")
	}
	input := service.VerificationInput{Scope: service.VerificationScopeInputAuditKeyRead, Method: "password", Password: "enrollment-password"}
	expired, err := service.VerifySecurityInput(identity, input)
	require.NoError(t, err)
	var flow model.AuthFlow
	require.NoError(t, model.DB.Order("id DESC").First(&flow).Error)
	require.NoError(t, model.DB.Model(&flow).Update("expires_at", time.Now().Add(-time.Minute)).Error)
	assert.Equal(t, http.StatusForbidden, request(expired.ProofToken).Code)
	proof, err := service.VerifySecurityInput(identity, input)
	require.NoError(t, err)
	w := request(proof.ProofToken)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	assert.Contains(t, w.Body.String(), "audit-saved-secret")
	assert.Equal(t, http.StatusForbidden, request(proof.ProofToken).Code)
	var logs []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&logs).Error)
	encoded, err := common.Marshal(logs)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "audit-saved-secret")
	assert.NotContains(t, string(encoded), proof.ProofToken)
}
