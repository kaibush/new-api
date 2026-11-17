package controller

import (
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
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
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
	require.NoError(t, db.Migrator().DropTable(&model.InputAudit{}, &model.Option{}, &inputAuditReleasedUser{}))
	return db
}

// Representative user columns from v1.0.0-rc.42 retain their original tags.
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
			require.NoError(b, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
					require.NoError(t, db.Migrator().DropTable(&model.InputAudit{}, &model.Option{}, &inputAuditReleasedUser{}))
					if upgrade {
						// The options schema matches the released v1.0.0-rc.42 schema.
						// The new feature must preserve existing options and their primary key.
						require.NoError(t, db.AutoMigrate(&model.Option{}, &inputAuditReleasedUser{}))
						require.NoError(t, db.Create(&model.Option{Key: "ExistingSetting", Value: "keep me"}).Error)
						require.NoError(t, db.Create(&inputAuditReleasedUser{Username: "existing-user", Password: "fixture"}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
						require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
	require.NoError(t, model.DB.AutoMigrate(&model.InputAudit{}))
	_, token := createAccessTokenTestSession(t, user.Id, "input-audit-session")
	router := gin.New()
	router.GET("/api/input-audit", middleware.RootAuth(), GetInputAudits)
	router.GET("/api/input-audit/status", middleware.RootAuth(), GetInputAuditStatus)
	router.PUT("/api/input-audit/settings", middleware.RootAuth(), UpdateInputAuditSettings)
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
			{http.MethodPut, "/api/input-audit/settings"},
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
	}
}

func TestInputAuditRetainsOriginalBeforePluginRedactionAndRejection(t *testing.T) {
	db := inputAuditTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.InputAudit{}))
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
	assert.Equal(t, "audit-request", found[0].RequestId)
	assert.Equal(t, 55, found[0].UserId)
}
