package controller

import (
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	settingconfig "github.com/QuantumNous/new-api/setting/config"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestProcessChannelErrorUsesSnapshotWithoutLeakingChannelMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousErrorLogEnabled := constant.ErrorLogEnabled

	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Log{}))
	model.DB, model.LOG_DB = database, database
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		constant.ErrorLogEnabled = previousErrorLogEnabled
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, database.Create(&model.User{Id: 7, Username: "log-owner", Group: "default"}).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("id", 7)
	ctx.Set("username", "log-owner")
	ctx.Set("token_name", "test-token")
	ctx.Set("token_id", 11)
	ctx.Set("original_model", "gpt-test")
	ctx.Set("group", "default")
	ctx.Set("channel_id", 202)
	ctx.Set("channel_name", "mutable-context-channel")
	ctx.Set("channel_type", 9)
	ctx.Set("use_channel", []string{"101"})
	common.SetContextKey(ctx, constant.ContextKeyRequestStartTime, time.Now().Add(-time.Second))

	channelSnapshot := types.ChannelError{
		ChannelId:   101,
		ChannelType: 1,
		ChannelName: "snapshot-channel",
		AutoBan:     false,
	}
	apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)

	processChannelError(ctx, channelSnapshot, apiErr, nil)

	var stored model.Log
	require.NoError(t, database.First(&stored).Error)
	assert.Equal(t, channelSnapshot.ChannelId, stored.ChannelId)
	storedOther, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	assert.Equal(t, float64(http.StatusBadGateway), storedOther["status_code"])
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, storedOther, key)
	}
	adminInfo, ok := storedOther["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, []any{"101"}, adminInfo["use_channel"])

	logs, total, err := model.GetUserLogs(7, model.LogTypeError, 0, 0, "", "", 0, 10, "", "", "")
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.Equal(t, channelSnapshot.ChannelId, logs[0].ChannelId)
	assert.Empty(t, logs[0].ChannelName)
	userOther, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.NotContains(t, userOther, "admin_info")
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, userOther, key)
	}

	t.Run("saved error policy protects user logs and keeps administrator diagnostics", func(t *testing.T) {
		require.NoError(t, database.AutoMigrate(&model.Option{}))
		previousConfig := setting.ErrorFilterConfig()
		common.OptionMapRWMutex.Lock()
		previousOptions := common.OptionMap
		common.OptionMap = maps.Clone(previousOptions)
		if common.OptionMap == nil {
			common.OptionMap = make(map[string]string)
		}
		common.OptionMapRWMutex.Unlock()
		t.Cleanup(func() {
			common.OptionMapRWMutex.Lock()
			defer common.OptionMapRWMutex.Unlock()
			common.OptionMap = previousOptions
			settingconfig.UpdateConfigFromMap(settingconfig.GlobalConfig.Get("error_filter"), map[string]string{"config": previousConfig})
		})

		policy := errorfilter.Defaults()
		policy.Enabled = true
		policy.Rules = []errorfilter.Rule{{Name: "hide provider", Enabled: true, Channels: []int{101}, Field: "message", Match: "contains", Pattern: "tokenharbor", Action: "replace", Replacement: "请求过大，请精简对话。"}}
		encoded, err := common.Marshal(policy)
		require.NoError(t, err)
		saveResponse := httptest.NewRecorder()
		saveContext, _ := gin.CreateTestContext(saveResponse)
		saveContext.Request = httptest.NewRequest(http.MethodPut, "/api/option/error_filter", strings.NewReader(string(encoded)))
		UpdateErrorFilter(saveContext)
		assert.Equal(t, http.StatusOK, saveResponse.Code)
		assert.Contains(t, saveResponse.Body.String(), `"success":true`)
		storedConfig := setting.ErrorFilterConfig()
		assert.JSONEq(t, string(encoded), storedConfig)
		var option model.Option
		require.NoError(t, database.Where("key = ?", setting.ErrorFilterOptionKey).First(&option).Error)
		assert.JSONEq(t, storedConfig, option.Value)

		policy.Rules[0].Replacement = "preview only"
		previewBody, err := common.Marshal(gin.H{"config": policy, "sample": errorfilter.Input{Message: "tokenharbor: free account limit", Status: 413, ChannelID: 101}})
		require.NoError(t, err)
		previewResponse := httptest.NewRecorder()
		previewContext, _ := gin.CreateTestContext(previewResponse)
		previewContext.Request = httptest.NewRequest(http.MethodPost, "/api/option/error_filter/preview", strings.NewReader(string(previewBody)))
		PreviewErrorFilter(previewContext)
		assert.Contains(t, previewResponse.Body.String(), "preview only")
		assert.Equal(t, storedConfig, setting.ErrorFilterConfig())

		providerErr := types.NewOpenAIError(errors.New("tokenharbor: free account limit"), types.ErrorCodeBadResponseStatusCode, 413)
		processChannelError(ctx, channelSnapshot, providerErr, nil)
		var latest model.Log
		require.NoError(t, database.Order("id DESC").First(&latest).Error)
		assert.Equal(t, "请求过大，请精简对话。", latest.Content)
		assert.Equal(t, "tokenharbor: free account limit", providerErr.Error())
		assert.Contains(t, latest.Other, "tokenharbor")
		logs, _, err := model.GetUserLogs(7, model.LogTypeError, 0, 0, "", "", 0, 10, "", "", "")
		require.NoError(t, err)
		for _, entry := range logs {
			assert.NotContains(t, entry.Other, "tokenharbor")
			assert.NotContains(t, entry.Content, "tokenharbor")
		}
	})
}
