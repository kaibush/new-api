package controller

import (
	"bytes"
	"context"
	"fmt"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDatabaseMaintenanceLogBatchLimit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "maintenance.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	previousDB, previousKind := model.LOG_DB, common.LogDatabaseType()
	model.LOG_DB = db
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.LOG_DB = previousDB
		common.SetLogDatabaseType(previousKind)
		assert.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	require.NoError(t, db.Create(&[]model.Log{
		{CreatedAt: 10, Type: model.LogTypeConsume},
		{CreatedAt: 10, Type: model.LogTypeConsume},
		{CreatedAt: 10, Type: model.LogTypeConsume},
		{CreatedAt: 20, Type: model.LogTypeConsume},
	}).Error)
	deleted, err := model.DeleteOldLogBatch(context.Background(), 20, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 2, deleted)
	var remaining []model.Log
	require.NoError(t, db.Order("id").Find(&remaining).Error)
	require.Len(t, remaining, 2)
	assert.EqualValues(t, 10, remaining[0].CreatedAt)
	assert.EqualValues(t, 20, remaining[1].CreatedAt)
}

func TestDatabaseMaintenanceDatabases(t *testing.T) {
	for _, engine := range []common.DatabaseType{common.DatabaseTypeSQLite, common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL} {
		t.Run(string(engine), func(t *testing.T) {
			kind := string(engine)
			if engine == common.DatabaseTypePostgreSQL {
				kind = "postgres"
			}
			dsn := os.Getenv("TEST_" + strings.ToUpper(kind) + "_DSN")
			if engine != common.DatabaseTypeSQLite && dsn == "" {
				t.Skip("TEST_" + strings.ToUpper(kind) + "_DSN not set")
			}
			for _, separate := range []bool{false, true} {
				t.Run(fmt.Sprintf("separate_logs_%v", separate), func(t *testing.T) {
					db, _ := newAuditTestDatabase(t, kind, dsn)
					logs := db
					if separate {
						logs, _ = newAuditTestDatabase(t, kind, dsn)
					}
					oldDB, oldLogs := model.DB, model.LOG_DB
					oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
					model.DB, model.LOG_DB = db, logs
					common.SetDatabaseTypes(engine, engine)
					t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogs; common.SetDatabaseTypes(oldMain, oldLog) })
					require.NoError(t, db.AutoMigrate(&model.User{}, &model.CheckinFunding{}, &model.CheckinUsage{}, &model.AuditLog{}, &model.SiteVisit{}, &model.SystemTask{}, &model.SystemTaskLock{}))
					require.NoError(t, logs.AutoMigrate(&model.Log{}))
					var version string
					versionQuery := "SELECT version()"
					if engine == common.DatabaseTypeSQLite {
						versionQuery = "SELECT sqlite_version()"
					}
					require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
					t.Logf("database version: %s", version)
					ctx := context.Background()
					old := time.Now().AddDate(0, 0, -60).Unix()
					user := model.User{Username: "maintenance-user", Quota: 12345}
					require.NoError(t, db.Create(&user).Error)
					funding := model.CheckinFunding{UserID: user.Id, SourceKey: "receipt", Quota: 20, WalletQuota: 10, Allocations: "[]"}
					usage := model.CheckinUsage{UserID: user.Id, SourceKey: "receipt", CreatedAt: old, Quota: 20, Pending: true}
					audit := model.AuditLog{EventId: "protected-event", UserId: user.Id, CreatedAt: old}
					require.NoError(t, db.Create(&funding).Error)
					require.NoError(t, db.Create(&usage).Error)
					require.NoError(t, db.Create(&audit).Error)
					rows := make([]model.Log, 202)
					for i := range rows {
						rows[i] = model.Log{CreatedAt: old, Type: model.LogTypeConsume, UserId: user.Id}
					}
					rows[201].Type = model.LogTypeError
					require.NoError(t, logs.CreateInBatches(&rows, 100).Error)
					for _, typ := range []int{model.LogTypeTopup, model.LogTypeRefund, model.LogTypeManage, model.LogTypeLogin, model.LogTypeSystem} {
						require.NoError(t, logs.Create(&model.Log{CreatedAt: old, Type: typ, UserId: user.Id}).Error)
					}
					preview, err := model.PreviewDatabaseCleanup(ctx, model.DatabaseCleanupRequestLogs, 30)
					require.NoError(t, err)
					assert.EqualValues(t, 202, preview.Count)
					var total int64
					require.NoError(t, logs.Model(&model.Log{}).Count(&total).Error)
					assert.EqualValues(t, 207, total, "preview must not delete")
					// These three must survive: late import, exact cutoff, and recent row.
					require.NoError(t, logs.Create(&[]model.Log{{CreatedAt: old, Type: model.LogTypeConsume}, {CreatedAt: preview.Before, Type: model.LogTypeConsume}, {CreatedAt: time.Now().Unix(), Type: model.LogTypeConsume}}).Error)
					if separate {
						require.NoError(t, db.AutoMigrate(&model.Log{}))
						require.NoError(t, db.Create(&model.Log{CreatedAt: old, Type: model.LogTypeConsume}).Error)
					}
					storage, err := model.GetDatabaseStorage(ctx)
					require.NoError(t, err)
					wantScopes := 1
					if separate {
						wantScopes = 2
					}
					require.Len(t, storage, wantScopes)
					for _, item := range storage {
						assert.True(t, item.Available)
						assert.Positive(t, item.Bytes)
						assert.Equal(t, engine, item.Engine)
						foundLog := false
						for _, table := range item.Tables {
							if engine == common.DatabaseTypeSQLite {
								assert.Nil(t, table.Bytes)
								assert.Nil(t, table.EstimatedRows)
							} else {
								require.NotNil(t, table.Bytes)
								assert.GreaterOrEqual(t, *table.Bytes, int64(0))
							}
							if table.Name == "logs" {
								foundLog = true
								want := model.DatabaseCleanupRequestLogs
								if separate && item.Scope == "primary" {
									want = ""
								}
								assert.Equal(t, want, table.CleanupTarget)
							}
							if table.Name == "users" {
								assert.Empty(t, table.CleanupTarget)
							}
						}
						assert.True(t, foundLog)
					}
					for _, want := range []int64{200, 2, 0} {
						deleted, err := model.DeleteDatabaseCleanupBatch(ctx, *preview)
						require.NoError(t, err)
						assert.Equal(t, want, deleted)
					}
					require.NoError(t, logs.Model(&model.Log{}).Count(&total).Error)
					assert.EqualValues(t, 8, total)
					if separate {
						require.NoError(t, db.Model(&model.Log{}).Count(&total).Error)
						assert.EqualValues(t, 1, total)
					}
					visits := []model.SiteVisit{{CreatedAt: old, UserID: user.Id}, {CreatedAt: time.Now().Unix(), UserID: user.Id}}
					require.NoError(t, db.Create(&visits).Error)
					visitPreview, err := model.PreviewDatabaseCleanup(ctx, model.DatabaseCleanupSiteVisits, 30)
					require.NoError(t, err)
					assert.EqualValues(t, 1, visitPreview.Count)
					deleted, err := model.DeleteDatabaseCleanupBatch(ctx, *visitPreview)
					require.NoError(t, err)
					assert.EqualValues(t, 1, deleted)
					require.NoError(t, db.Model(&model.SiteVisit{}).Count(&total).Error)
					assert.EqualValues(t, 1, total)
					var afterUser model.User
					require.NoError(t, db.First(&afterUser, user.Id).Error)
					assert.Equal(t, 12345, afterUser.Quota)
					var afterFunding model.CheckinFunding
					require.NoError(t, db.First(&afterFunding, funding.ID).Error)
					assert.Equal(t, funding, afterFunding)
					var afterUsage model.CheckinUsage
					require.NoError(t, db.First(&afterUsage, usage.ID).Error)
					assert.Equal(t, usage, afterUsage)
					require.NoError(t, db.First(&model.AuditLog{}, audit.Id).Error)
					// Existing cleanup must also honor its configured batch size on every engine.
					deleted, err = model.DeleteOldLogBatch(ctx, preview.Before, 2)
					require.NoError(t, err)
					assert.EqualValues(t, 2, deleted)
				})
			}
		})
	}
}

func TestDatabaseMaintenanceAPI(t *testing.T) {
	user, _ := setupAccessTokenAudit(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SiteVisit{}, &model.SystemTask{}, &model.SystemTaskLock{}))
	_, token := createAccessTokenTestSession(t, user.Id, "database-maintenance-session")
	router := gin.New()
	router.GET("/api/system-info/database", middleware.RootAuth(), GetDatabaseStorage)
	router.POST("/api/system-info/database/cleanup/preview", middleware.RootAuth(), PreviewDatabaseCleanup)
	router.POST("/api/system-info/database/cleanup", middleware.RootAuth(), StartDatabaseCleanup)
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		data, err := common.Marshal(body)
		require.NoError(t, err)
		req := httptest.NewRequest(method, "/api/system-info/database"+path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser} {
		require.NoError(t, model.DB.Model(user).Update("role", role).Error)
		assert.Equal(t, http.StatusForbidden, request(http.MethodGet, "", nil).Code)
		assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/cleanup/preview", nil).Code)
		assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/cleanup", nil).Code)
	}
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	assert.Equal(t, http.StatusOK, request(http.MethodGet, "", nil).Code)
	for _, invalid := range []any{map[string]any{"target": "users", "retention_days": 30}, map[string]any{"target": "site_visits", "retention_days": 0}, map[string]any{"target": "site_visits", "retention_days": 3651}} {
		assert.Equal(t, http.StatusBadRequest, request(http.MethodPost, "/cleanup/preview", invalid).Code)
	}
	for _, invalid := range []model.DatabaseCleanupSnapshot{{Target: "users", Before: 1, MaxID: 999}, {Target: "site_visits", Before: time.Now().Unix(), MaxID: 999}, {Target: "site_visits", Before: 1, MaxID: -1}} {
		assert.Equal(t, http.StatusBadRequest, request(http.MethodPost, "/cleanup", invalid).Code)
	}
	require.NoError(t, model.DB.Create(&model.SiteVisit{CreatedAt: time.Now().AddDate(0, 0, -60).Unix()}).Error)
	response := request(http.MethodPost, "/cleanup/preview", map[string]any{"target": "site_visits", "retention_days": 30})
	var result struct {
		Success bool
		Data    model.DatabaseCleanupSnapshot
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success)
	result.Data.Count = 99999 // Server must recalculate, never trust client counts.
	response = request(http.MethodPost, "/cleanup", result.Data)
	assert.Equal(t, http.StatusOK, response.Code)
	var taskResult struct {
		Success bool
		Data    model.SystemTaskResponse
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &taskResult))
	require.True(t, taskResult.Success, response.Body.String())
	var payload model.DatabaseCleanupSnapshot
	task, err := model.GetActiveSystemTask(model.SystemTaskTypeDatabaseCleanup)
	require.NoError(t, err)
	require.NotNil(t, task)
	require.NoError(t, task.DecodePayload(&payload))
	assert.EqualValues(t, 1, payload.Count)
	assert.Equal(t, http.StatusConflict, request(http.MethodPost, "/cleanup", result.Data).Code)
	oldKind := common.LogDatabaseType()
	common.SetLogDatabaseType(common.DatabaseTypeClickHouse)
	t.Cleanup(func() { common.SetLogDatabaseType(oldKind) })
	_, err = model.PreviewDatabaseCleanup(context.Background(), model.DatabaseCleanupRequestLogs, 30)
	assert.ErrorIs(t, err, model.ErrDatabaseCleanupTarget)
}
