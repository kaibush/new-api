package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type listModelsResponse struct {
	Success bool               `json:"success"`
	Data    []dto.OpenAIModels `json:"data"`
	Object  string             `json:"object"`
}

func TestCatalogVisibilityAcrossAudiences(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	withSelfUseModeEnabled(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	original := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original))
		common.OptionMap = oldOptions
		require.NoError(t, setting.UpdateCatalogVisibility(`{"audiences":{},"models":{},"groups":{}}`))
		model.InvalidatePricingCache()
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Public","internal":"Private route"}`))
	rules := `{"audiences":{"staff":[22]},"models":{"preview":["staff"],"unreleased":[]},"groups":{"internal":["staff"]}}`
	require.NoError(t, model.UpdateOption(setting.CatalogVisibilityKey, rules))
	require.Error(t, model.UpdateOption(setting.CatalogVisibilityKey, `{"models":{},"groups":null}`))
	var persisted model.Option
	require.NoError(t, db.First(&persisted, "key = ?", setting.CatalogVisibilityKey).Error)
	assert.JSONEq(t, rules, persisted.Value)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "shared", ChannelId: 1, Enabled: true},
		{Group: "internal", Model: "shared", ChannelId: 2, Enabled: true},
		{Group: "internal", Model: "group-only", ChannelId: 2, Enabled: true},
		{Group: "default", Model: "preview", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "unreleased", ChannelId: 1, Enabled: true},
	}).Error)
	model.InvalidatePricingCache()
	for _, viewer := range []int{0, 11, 22, 11} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Set("id", viewer)
		if viewer != 0 {
			common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
		}
		GetPricing(ctx)
		if viewer == 0 {
			require.Equal(t, http.StatusUnauthorized, recorder.Code)
			continue
		}
		require.Equal(t, http.StatusOK, recorder.Code)
		var catalog struct {
			Data   []model.Pricing   `json:"data"`
			Groups map[string]string `json:"usable_group"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &catalog))
		names := map[string][]string{}
		for _, item := range catalog.Data {
			names[item.ModelName] = item.EnableGroup
		}
		if viewer == 22 {
			assert.ElementsMatch(t, []string{"internal", "default"}, names["shared"])
			assert.Contains(t, names, "preview")
			assert.Contains(t, names, "group-only")
		} else {
			assert.Equal(t, map[string][]string{"shared": {"default"}}, names)
			assert.NotContains(t, recorder.Body.String(), "internal")
		}
		assert.NotContains(t, names, "unreleased")
	}
	for _, viewer := range []int{11, 22} {
		for _, name := range []string{"preview", "not-a-model"} {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Set("id", viewer)
			common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
			ctx.Params = gin.Params{{Key: "model", Value: name}}
			RetrieveModel(ctx, constant.ChannelTypeOpenAI)
			if viewer == 22 && name == "preview" {
				assert.Contains(t, recorder.Body.String(), `"id":"preview"`)
			} else {
				assert.Contains(t, recorder.Body.String(), `"code":"model_not_found"`)
			}
		}
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	_, _, denied := service.SelectChannelForRequest(ctx, "preview", &service.RetryParam{Ctx: ctx, TokenGroup: "default"})
	require.NotNil(t, denied)
	assert.True(t, denied.NoAvailableChannel)
	ctx.Set("id", 22)
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
	before, _, err := visibleTokenModelNames(ctx)
	require.NoError(t, err)
	require.Contains(t, before, "preview")
	require.NoError(t, model.UpdateOption(setting.CatalogVisibilityKey, strings.Replace(rules, "[22]", "[]", 1)))
	after, _, err := visibleTokenModelNames(ctx)
	require.NoError(t, err)
	assert.NotContains(t, after, "preview")
	assert.NotContains(t, service.GetUserUsableGroups(22, "default"), "internal")
}

type userModelsResponse struct {
	Success bool     `json:"success"`
	Data    []string `json:"data"`
}

func TestCatalogExclusionsWithoutPermissionGroups(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	withSelfUseModeEnabled(t)
	original := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original))
		require.NoError(t, setting.UpdateCatalogVisibility(`{"audiences":{},"models":{},"groups":{}}`))
		model.InvalidatePricingCache()
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Public","internal":"Internal"}`))
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "shared", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "preview", ChannelId: 1, Enabled: true},
		{Group: "internal", Model: "shared", ChannelId: 2, Enabled: true},
		{Group: "internal", Model: "group-only", ChannelId: 2, Enabled: true},
	}).Error)
	model.InvalidatePricingCache()
	require.NoError(t, setting.UpdateCatalogVisibility(`{"audiences":{},"models":{},"groups":{},"model_exclusions":{"preview":[11]},"group_exclusions":{"internal":[11]}}`))
	require.True(t, setting.HasCatalogRestrictions())
	for _, viewer := range []int{22, 11, 0, 44, 11} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Set("id", viewer)
		common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
		GetPricing(ctx)
		if viewer == 0 {
			require.Equal(t, http.StatusUnauthorized, recorder.Code)
		} else {
			require.Equal(t, http.StatusOK, recorder.Code)
		}
		names, _, err := visibleTokenModelNames(ctx)
		require.NoError(t, err)
		require.Contains(t, names, "shared")
		if viewer == 22 || viewer == 44 {
			require.Contains(t, names, "preview")
			for _, name := range []string{"preview", "group-only", "internal"} {
				require.Contains(t, recorder.Body.String(), `"`+name+`"`)
			}
			continue
		}
		require.NotContains(t, names, "preview")
		for _, name := range []string{"preview", "group-only", "internal"} {
			require.NotContains(t, recorder.Body.String(), `"`+name+`"`)
		}
		for _, route := range []struct{ model, group string }{{"preview", "default"}, {"shared", "internal"}} {
			_, _, denied := service.SelectChannelForRequest(ctx, route.model, &service.RetryParam{Ctx: ctx, TokenGroup: route.group})
			require.NotNil(t, denied)
			require.True(t, denied.NoAvailableChannel)
		}
	}
}

func setupModelListControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	initModelListColumnNames(t)

	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db

	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}))

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func initModelListColumnNames(t *testing.T) {
	t.Helper()

	originalIsMasterNode := common.IsMasterNode
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")
	defer func() {
		common.IsMasterNode = originalIsMasterNode
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	}()

	common.IsMasterNode = false
	common.SQLitePath = fmt.Sprintf("file:%s_init?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))

	require.NoError(t, model.InitDB())
	if model.DB != nil {
		sqlDB, err := model.DB.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	}
}

func withTieredBillingConfig(t *testing.T, modes map[string]string, exprs map[string]string) {
	t.Helper()

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		if strings.HasPrefix(key, "billing_setting.") {
			saved[key] = value
		}
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		model.InvalidatePricingCache()
	})

	modeBytes, err := common.Marshal(modes)
	require.NoError(t, err)
	exprBytes, err := common.Marshal(exprs)
	require.NoError(t, err)

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": string(modeBytes),
		"billing_setting.billing_expr": string(exprBytes),
	}))
	model.InvalidatePricingCache()
}

func withSelfUseModeDisabled(t *testing.T) {
	t.Helper()

	original := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() {
		operation_setting.SelfUseModeEnabled = original
	})
}

func withSelfUseModeEnabled(t *testing.T) {
	t.Helper()

	original := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = true
	t.Cleanup(func() {
		operation_setting.SelfUseModeEnabled = original
	})
}

func decodeListModelsPayload(t *testing.T, recorder *httptest.ResponseRecorder) listModelsResponse {
	t.Helper()

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload listModelsResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Equal(t, "list", payload.Object)
	return payload
}

func decodeListModelsResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]struct{} {
	t.Helper()

	payload := decodeListModelsPayload(t, recorder)
	ids := make(map[string]struct{}, len(payload.Data))
	for _, item := range payload.Data {
		ids[item.Id] = struct{}{}
	}
	return ids
}

func pricingByModelName(pricings []model.Pricing) map[string]model.Pricing {
	byName := make(map[string]model.Pricing, len(pricings))
	for _, pricing := range pricings {
		byName[pricing.ModelName] = pricing
	}
	return byName
}

func decodeUserModelsResponse(t *testing.T, recorder *httptest.ResponseRecorder) []string {
	t.Helper()

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload userModelsResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	return payload.Data
}

func TestGetUserModelsFiltersByRequestedGroup(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	withSelfUseModeEnabled(t)
	require.NoError(t, db.Create(&model.User{
		Id:       1002,
		Username: "playground-model-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-default-only-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-disabled-model", ChannelId: 1, Enabled: false},
	}).Error)

	defaultRecorder := httptest.NewRecorder()
	defaultContext, _ := gin.CreateTestContext(defaultRecorder)
	defaultContext.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=default", nil)
	defaultContext.Set("id", 1002)

	GetUserModels(defaultContext)

	defaultModels := decodeUserModelsResponse(t, defaultRecorder)
	require.ElementsMatch(t, []string{"zz-default-only-model"}, defaultModels)

	vipRecorder := httptest.NewRecorder()
	vipContext, _ := gin.CreateTestContext(vipRecorder)
	vipContext.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=vip", nil)
	vipContext.Set("id", 1002)

	GetUserModels(vipContext)

	require.Empty(t, decodeUserModelsResponse(t, vipRecorder))
}

func TestGetUserModelsExpandsAutoGroupsInConfiguredOrder(t *testing.T) {
	withSelfUseModeEnabled(t)
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalSpecialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		specialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
		specialGroups.Clear()
		specialGroups.AddAll(originalSpecialGroups)
	})

	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["vip","default","unavailable"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"auto":"自动分组","default":"默认分组","unavailable":"不可用分组"}`))
	specialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	specialGroups.Clear()
	specialGroups.Set("default", map[string]string{
		"+:vip":         "VIP 分组",
		"-:unavailable": "",
	})

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id:       1003,
		Username: "playground-auto-model-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "vip", Model: "zz-vip-model", ChannelId: 1, Enabled: true},
		{Group: "vip", Model: "zz-shared-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-default-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-shared-model", ChannelId: 2, Enabled: true},
		{Group: "unavailable", Model: "zz-unavailable-model", ChannelId: 1, Enabled: true},
	}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=auto", nil)
	context.Set("id", 1003)

	GetUserModels(context)

	models := decodeUserModelsResponse(t, recorder)
	require.Len(t, models, 3)
	assert.ElementsMatch(t, []string{"zz-vip-model", "zz-shared-model"}, models[:2])
	assert.Equal(t, "zz-default-model", models[2])
}

func TestListModelsIncludesTieredBillingModel(t *testing.T) {
	withSelfUseModeDisabled(t)
	withTieredBillingConfig(t, map[string]string{
		"zz-tiered-visible-model":      "tiered_expr",
		"zz-tiered-empty-expr-model":   "tiered_expr",
		"zz-tiered-missing-expr-model": "tiered_expr",
	}, map[string]string{
		"zz-tiered-visible-model":    `tier("base", p * 1 + c * 2)`,
		"zz-tiered-empty-expr-model": "   ",
	})

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id:       1001,
		Username: "model-list-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-tiered-visible-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-tiered-empty-expr-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-tiered-missing-expr-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-unpriced-model", ChannelId: 1, Enabled: true},
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	ctx.Set("id", 1001)

	ListModels(ctx, constant.ChannelTypeOpenAI)

	ids := decodeListModelsResponse(t, recorder)
	require.Contains(t, ids, "zz-tiered-visible-model")
	require.NotContains(t, ids, "zz-tiered-empty-expr-model")
	require.NotContains(t, ids, "zz-tiered-missing-expr-model")
	require.NotContains(t, ids, "zz-unpriced-model")

	pricingByName := pricingByModelName(model.GetPricing())
	visiblePricing, ok := pricingByName["zz-tiered-visible-model"]
	require.True(t, ok)
	require.Equal(t, "tiered_expr", visiblePricing.BillingMode)
	require.NotEmpty(t, visiblePricing.BillingExpr)

	emptyExprPricing, ok := pricingByName["zz-tiered-empty-expr-model"]
	require.True(t, ok)
	require.Empty(t, emptyExprPricing.BillingMode)
	require.Empty(t, emptyExprPricing.BillingExpr)

	missingExprPricing, ok := pricingByName["zz-tiered-missing-expr-model"]
	require.True(t, ok)
	require.Empty(t, missingExprPricing.BillingMode)
	require.Empty(t, missingExprPricing.BillingExpr)
}

func TestListModelsUsesAdvancedCustomEndpointTypesFromPricingCache(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		model.InvalidatePricingCache()
	})

	require.NoError(t, db.Create(&model.User{
		Id:       1003,
		Username: "advanced-custom-model-list-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)

	channel := &model.Channel{
		Id:     701,
		Type:   constant.ChannelTypeAdvancedCustom,
		Key:    "advanced-custom-key",
		Status: common.ChannelStatusEnabled,
		Name:   "advanced-custom-channel",
		Group:  "default",
		Models: "gemini-3.5-flash",
	}
	channel.SetOtherSettings(dto.ChannelOtherSettings{
		AdvancedCustom: &dto.AdvancedCustomConfig{
			Routes: []dto.AdvancedCustomRoute{
				{
					IncomingPath: "/v1/chat/completions",
					UpstreamPath: "/v1/chat/completions",
				},
				{
					IncomingPath: "/v1/responses",
					UpstreamPath: "/v1beta/models/{model}:generateContent",
					Converter:    "openai_responses_to_gemini_generate_content",
					Models:       []string{"re:^gemini-"},
				},
			},
		},
	})
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     "default",
		Model:     "gemini-3.5-flash",
		ChannelId: 701,
		Enabled:   true,
	}).Error)

	model.InitChannelCache()
	model.GetPricing()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	ctx.Set("id", 1003)

	ListModels(ctx, constant.ChannelTypeOpenAI)

	payload := decodeListModelsPayload(t, recorder)
	require.Len(t, payload.Data, 1)
	require.Equal(t, "gemini-3.5-flash", payload.Data[0].Id)
	require.Equal(t, []constant.EndpointType{
		constant.EndpointTypeOpenAI,
		constant.EndpointTypeOpenAIResponse,
	}, payload.Data[0].SupportedEndpointTypes)
}

func TestListModelsTokenLimitIncludesTieredBillingModel(t *testing.T) {
	withSelfUseModeDisabled(t)
	withTieredBillingConfig(t, map[string]string{
		"zz-token-tiered-visible-model":      "tiered_expr",
		"zz-token-tiered-empty-expr-model":   "tiered_expr",
		"zz-token-tiered-missing-expr-model": "tiered_expr",
	}, map[string]string{
		"zz-token-tiered-visible-model":    `tier("base", p * 1 + c * 2)`,
		"zz-token-tiered-empty-expr-model": "",
	})
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-token-tiered-visible-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-token-tiered-empty-expr-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-token-tiered-missing-expr-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-token-unpriced-model", ChannelId: 1, Enabled: true},
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"zz-token-tiered-visible-model":      true,
		"zz-token-tiered-empty-expr-model":   true,
		"zz-token-tiered-missing-expr-model": true,
		"zz-token-unpriced-model":            true,
	})

	ListModels(ctx, constant.ChannelTypeOpenAI)

	ids := decodeListModelsResponse(t, recorder)
	require.Contains(t, ids, "zz-token-tiered-visible-model")
	require.NotContains(t, ids, "zz-token-tiered-empty-expr-model")
	require.NotContains(t, ids, "zz-token-tiered-missing-expr-model")
	require.NotContains(t, ids, "zz-token-unpriced-model")
}

func TestListModelsTokenLimitUsesResolvedCustomAutoGroups(t *testing.T) {
	withSelfUseModeEnabled(t)
	originalMax := setting.GetMaxTokenAutoGroups()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("5"))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprintf("%d", originalMax)))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "vip", Model: "zz-vip-allowed", ChannelId: 1, Enabled: true},
		{Group: "vip", Model: "zz-vip-denied", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-default-outside-snapshot", ChannelId: 1, Enabled: true},
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "auto")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip"})
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"zz-vip-allowed":              true,
		"zz-default-outside-snapshot": true,
		"zz-not-enabled":              true,
	})

	ListModels(ctx, constant.ChannelTypeOpenAI)
	ids := decodeListModelsResponse(t, recorder)
	require.Equal(t, map[string]struct{}{"zz-vip-allowed": {}}, ids)

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	emptyRecorder := httptest.NewRecorder()
	emptyCtx, _ := gin.CreateTestContext(emptyRecorder)
	emptyCtx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	common.SetContextKey(emptyCtx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(emptyCtx, constant.ContextKeyTokenGroup, "auto")
	common.SetContextKey(emptyCtx, constant.ContextKeyTokenAutoGroups, []string{"vip"})
	common.SetContextKey(emptyCtx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(emptyCtx, constant.ContextKeyTokenModelLimit, map[string]bool{"zz-vip-allowed": true})

	require.NotPanics(t, func() {
		ListModels(emptyCtx, constant.ChannelTypeAnthropic)
	})
	var anthropicResponse struct {
		Data    []dto.AnthropicModel `json:"data"`
		FirstID string               `json:"first_id"`
		LastID  string               `json:"last_id"`
	}
	require.NoError(t, common.Unmarshal(emptyRecorder.Body.Bytes(), &anthropicResponse))
	require.Empty(t, anthropicResponse.Data)
	require.Empty(t, anthropicResponse.FirstID)
	require.Empty(t, anthropicResponse.LastID)
}

func TestSetupLoginDoesNotTouchPasswordWhenPasswordFieldOmitted(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.AuditLog{}, &model.UserSession{}, &model.TwoFA{}, &model.PasskeyCredential{}))

	hashedPassword, err := common.Password2Hash("CurrentPassword123")
	require.NoError(t, err)
	user := &model.User{
		Username: "twofa-user",
		Password: hashedPassword,
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, db.Create(user).Error)

	router := gin.New()
	router.GET("/", func(c *gin.Context) {
		setupLogin(&model.User{
			Id:          user.Id,
			AuthVersion: user.AuthVersion,
			Username:    user.Username,
			Role:        user.Role,
			Status:      user.Status,
			Group:       user.Group,
		}, nil, c)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, hashedPassword, stored.Password)
}

func TestCrossGroupCatalogPermissionListingAndRouting(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	originalMemoryCache := common.MemoryCacheEnabled
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	originalAutoGroups := setting.AutoGroups2JsonString()
	common.MemoryCacheEnabled = true
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","openai":"OpenAI","auto":"Auto"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"openai":1}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["openai","default"]`))
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCache
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateCatalogVisibility(`{"audiences":{},"models":{},"groups":{}}`))
		model.InvalidatePricingCache()
	})

	for _, uid := range []int{11, 22, 33} {
		require.NoError(t, db.Create(&model.User{
			Id:       uid,
			Username: fmt.Sprintf("user-%d", uid),
			Password: "pw",
			Group:    "default",
			AffCode:  fmt.Sprintf("aff-%d", uid),
			Status:   common.UserStatusEnabled,
		}).Error)
	}

	priority := int64(0)
	weight := uint(100)
	require.NoError(t, db.Create(&[]model.Channel{
		{
			Id: 901, Type: constant.ChannelTypeOpenAI, Key: "k1", Status: common.ChannelStatusEnabled,
			Name: "regular-openai", Group: "openai", Models: "gpt-4o-mini", Priority: &priority, Weight: &weight,
		},
		{
			Id: 902, Type: constant.ChannelTypeOpenAI, Key: "k2", Status: common.ChannelStatusEnabled,
			Name: "private-sol", Group: "gpt不降智", Models: "gpt-6.1-sol,gpt-6.2-sol", Priority: &priority, Weight: &weight,
		},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "openai", Model: "gpt-4o-mini", ChannelId: 901, Enabled: true, Priority: &priority, Weight: weight},
		{Group: "gpt不降智", Model: "gpt-6.1-sol", ChannelId: 902, Enabled: true, Priority: &priority, Weight: weight},
		{Group: "gpt不降智", Model: "gpt-6.2-sol", ChannelId: 902, Enabled: true, Priority: &priority, Weight: weight},
	}).Error)
	model.InitChannelCache()

	// Admin group list includes channel-only groups such as "gpt不降智"
	groupRecorder := httptest.NewRecorder()
	groupCtx, _ := gin.CreateTestContext(groupRecorder)
	GetGroups(groupCtx)
	var adminGroups struct {
		Data []string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(groupRecorder.Body.Bytes(), &adminGroups))
	assert.Contains(t, adminGroups.Data, "gpt不降智")

	// gpt-6.1-sol: open to all logged-in users except user 11
	// gpt-6.2-sol: allowlisted directly to user 22
	require.NoError(t, setting.UpdateCatalogVisibility(`{
		"audiences": {},
		"models": {},
		"groups": {},
		"open_models": ["gpt-6.1-sol"],
		"model_exclusions": {"gpt-6.1-sol": [11]},
		"model_users": {"gpt-6.2-sol": [22]}
	}`))

	cases := []struct {
		viewer     int
		tokenGroup string
		expect61   bool
		expect62   bool
	}{
		{viewer: 0, tokenGroup: "openai", expect61: false, expect62: false},
		{viewer: 11, tokenGroup: "openai", expect61: false, expect62: false},
		{viewer: 22, tokenGroup: "openai", expect61: true, expect62: true},
		{viewer: 22, tokenGroup: "default", expect61: true, expect62: true},
		{viewer: 22, tokenGroup: "auto", expect61: true, expect62: true},
		{viewer: 33, tokenGroup: "openai", expect61: true, expect62: false},
	}

	for _, tc := range cases {
		// 1. /v1/models
		listRec := httptest.NewRecorder()
		listCtx, _ := gin.CreateTestContext(listRec)
		listCtx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		listCtx.Set("id", tc.viewer)
		common.SetContextKey(listCtx, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(listCtx, constant.ContextKeyTokenGroup, tc.tokenGroup)
		ListModels(listCtx, constant.ChannelTypeOpenAI)
		ids := decodeListModelsResponse(t, listRec)
		assert.Equal(t, tc.expect61, hasKey(ids, "gpt-6.1-sol"), "viewer=%d group=%s gpt-6.1-sol", tc.viewer, tc.tokenGroup)
		assert.Equal(t, tc.expect62, hasKey(ids, "gpt-6.2-sol"), "viewer=%d group=%s gpt-6.2-sol", tc.viewer, tc.tokenGroup)

		// 2. /api/pricing
		priceRec := httptest.NewRecorder()
		priceCtx, _ := gin.CreateTestContext(priceRec)
		priceCtx.Set("id", tc.viewer)
		if tc.viewer > 0 {
			common.SetContextKey(priceCtx, constant.ContextKeyUserGroup, "default")
		}
		GetPricing(priceCtx)
		if tc.viewer == 0 {
			require.Equal(t, http.StatusUnauthorized, priceRec.Code)
		} else {
			require.Equal(t, http.StatusOK, priceRec.Code)
			var priceBody struct {
				Data        []model.Pricing    `json:"data"`
				UsableGroup map[string]string  `json:"usable_group"`
				GroupRatio  map[string]float64 `json:"group_ratio"`
			}
			require.NoError(t, common.Unmarshal(priceRec.Body.Bytes(), &priceBody))
			pricingModels := map[string]bool{}
			for _, item := range priceBody.Data {
				pricingModels[item.ModelName] = true
			}
			assert.Equal(t, tc.expect61, pricingModels["gpt-6.1-sol"])
			assert.Equal(t, tc.expect62, pricingModels["gpt-6.2-sol"])
			if tc.expect61 || tc.expect62 {
				assert.Contains(t, priceBody.UsableGroup, "gpt不降智")
				assert.Equal(t, 1.0, priceBody.GroupRatio["gpt不降智"])
			} else {
				assert.NotContains(t, priceBody.UsableGroup, "gpt不降智")
			}
		}

		// 3. /api/user/models (Playground)
		if tc.viewer > 0 {
			umRec := httptest.NewRecorder()
			umCtx, _ := gin.CreateTestContext(umRec)
			umCtx.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=default", nil)
			umCtx.Set("id", tc.viewer)
			GetUserModels(umCtx)
			var um userModelsResponse
			require.NoError(t, common.Unmarshal(umRec.Body.Bytes(), &um))
			assert.Equal(t, tc.expect61, slices.Contains(um.Data, "gpt-6.1-sol"))
			assert.Equal(t, tc.expect62, slices.Contains(um.Data, "gpt-6.2-sol"))
		}

		// 4. Actual channel routing regardless of regular token group
		for _, targetModel := range []struct {
			name    string
			allowed bool
		}{
			{"gpt-6.1-sol", tc.expect61},
			{"gpt-6.2-sol", tc.expect62},
		} {
			routeCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
			routeCtx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			routeCtx.Set("id", tc.viewer)
			common.SetContextKey(routeCtx, constant.ContextKeyUserGroup, "default")
			retry := 0
			ch, selectedGroup, selectErr := service.SelectChannelForRequest(routeCtx, targetModel.name, &service.RetryParam{
				Ctx:         routeCtx,
				TokenGroup:  tc.tokenGroup,
				ModelName:   targetModel.name,
				RequestPath: "/v1/chat/completions",
				Retry:       &retry,
			})
			if targetModel.allowed {
				require.Nil(t, selectErr, "viewer=%d group=%s model=%s", tc.viewer, tc.tokenGroup, targetModel.name)
				require.NotNil(t, ch)
				assert.Equal(t, 902, ch.Id)
				assert.Equal(t, "gpt不降智", selectedGroup)
				assert.Equal(t, "gpt不降智", common.GetContextKeyString(routeCtx, constant.ContextKeyAutoGroup))
			} else {
				require.NotNil(t, selectErr, "viewer=%d group=%s model=%s", tc.viewer, tc.tokenGroup, targetModel.name)
				assert.True(t, selectErr.NoAvailableChannel)
			}

			// 5. Pinned channel cross-group routing sets ContextKeyAutoGroup to matched private group
			pinCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
			pinCtx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			pinCtx.Set("id", tc.viewer)
			common.SetContextKey(pinCtx, constant.ContextKeyUserGroup, "default")
			service.GetChannelConstraints(pinCtx).AddPin(appdto.ChannelPin{
				ChannelId: 902,
				Source:    appdto.PinSourceToken,
				Rank:      appdto.PinRankToken,
				RetryMode: appdto.PinRetrySingleAttempt,
			})
			pinRetry := 0
			pinCh, pinGroup, pinErr := service.SelectChannelForRequest(pinCtx, targetModel.name, &service.RetryParam{
				Ctx:         pinCtx,
				TokenGroup:  tc.tokenGroup,
				ModelName:   targetModel.name,
				RequestPath: "/v1/chat/completions",
				Retry:       &pinRetry,
			})
			if targetModel.allowed {
				require.Nil(t, pinErr, "pinned viewer=%d group=%s model=%s", tc.viewer, tc.tokenGroup, targetModel.name)
				require.NotNil(t, pinCh)
				assert.Equal(t, 902, pinCh.Id)
				assert.Equal(t, "gpt不降智", pinGroup)
				assert.Equal(t, "gpt不降智", common.GetContextKeyString(pinCtx, constant.ContextKeyAutoGroup))
			} else {
				require.NotNil(t, pinErr, "pinned viewer=%d group=%s model=%s", tc.viewer, tc.tokenGroup, targetModel.name)
				assert.True(t, pinErr.NoAvailableChannel)
			}
		}
	}
}

func TestUnpricedModelsHiddenAcrossSquarePlaygroundAndV1Models(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	previousSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	originalRatio := ratio_setting.ModelRatio2JSONString()
	originalUsable := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		operation_setting.SelfUseModeEnabled = previousSelfUse
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatio))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsable))
		model.InvalidatePricingCache()
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"zz-priced-model":1.5}`))

	strictUser := model.User{Id: 2101, Username: "strict-user", Password: "pw", Group: "default", AffCode: "aff-2101", Status: common.UserStatusEnabled}
	acceptUser := model.User{Id: 2102, Username: "accept-user", Password: "pw", Group: "default", AffCode: "aff-2102", Status: common.UserStatusEnabled}
	acceptUser.SetSetting(dto.UserSetting{AcceptUnsetRatioModel: true})
	require.NoError(t, db.Create(&[]model.User{strictUser, acceptUser}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-priced-model", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-unpriced-model", ChannelId: 1, Enabled: true},
	}).Error)
	model.InvalidatePricingCache()

	for _, tc := range []struct {
		userID         int
		expectUnpriced bool
	}{
		{userID: 2101, expectUnpriced: false},
		{userID: 2102, expectUnpriced: true},
	} {
		priceRec := httptest.NewRecorder()
		priceCtx, _ := gin.CreateTestContext(priceRec)
		priceCtx.Set("id", tc.userID)
		common.SetContextKey(priceCtx, constant.ContextKeyUserGroup, "default")
		GetPricing(priceCtx)
		require.Equal(t, http.StatusOK, priceRec.Code)
		var priceBody struct {
			Data []model.Pricing `json:"data"`
		}
		require.NoError(t, common.Unmarshal(priceRec.Body.Bytes(), &priceBody))
		squareModels := map[string]bool{}
		for _, item := range priceBody.Data {
			squareModels[item.ModelName] = true
		}
		assert.True(t, squareModels["zz-priced-model"])
		assert.Equal(t, tc.expectUnpriced, squareModels["zz-unpriced-model"])

		umRec := httptest.NewRecorder()
		umCtx, _ := gin.CreateTestContext(umRec)
		umCtx.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=default", nil)
		umCtx.Set("id", tc.userID)
		GetUserModels(umCtx)
		playgroundModels := decodeUserModelsResponse(t, umRec)
		assert.Contains(t, playgroundModels, "zz-priced-model")
		if tc.expectUnpriced {
			assert.Contains(t, playgroundModels, "zz-unpriced-model")
		} else {
			assert.NotContains(t, playgroundModels, "zz-unpriced-model")
		}

		listRec := httptest.NewRecorder()
		listCtx, _ := gin.CreateTestContext(listRec)
		listCtx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		listCtx.Set("id", tc.userID)
		common.SetContextKey(listCtx, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(listCtx, constant.ContextKeyTokenGroup, "default")
		ListModels(listCtx, constant.ChannelTypeOpenAI)
		v1Models := decodeListModelsResponse(t, listRec)
		assert.True(t, hasKey(v1Models, "zz-priced-model"))
		assert.Equal(t, tc.expectUnpriced, hasKey(v1Models, "zz-unpriced-model"))
	}
}

func hasKey(set map[string]struct{}, key string) bool {
	_, ok := set[key]
	return ok
}
