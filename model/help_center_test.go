package model_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/helpcenter"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestHelpCenterValidationAndPublicContent(t *testing.T) {
	config, err := helpcenter.Parse(helpcenter.DefaultJSON)
	require.NoError(t, err)
	require.Len(t, config.Items, 2)
	assert.Contains(t, config.Items[0].Content, "grok-4.7")
	assert.Contains(t, config.Items[1].Content, "requestAnimationFrame")
	for _, raw := range []string{
		`{"version":2,"items":[]}`,
		`{"version":1,"items":null}`,
		`{"version":1,"items":[{"id":"one","title":"One","kind":"link","content":"javascript:alert(1)"}]}`,
		`{"version":1,"items":[{"id":"one","title":"One","kind":"unknown"}]}`,
		`{"version":1,"items":[{"id":"one","title":"One","kind":"html","htmlViewMode":"unknown"}]}`,
		`{"version":1,"items":[{"id":"one","title":"One","kind":"html"},{"id":"one","title":"Two","kind":"html"}]}`,
	} {
		_, err := helpcenter.Parse(raw)
		require.Error(t, err)
	}
	config.Items[1].Enabled = false
	encoded, err := common.Marshal(config)
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{helpcenter.OptionKey: string(encoded)}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { common.OptionMapRWMutex.Lock(); common.OptionMap = previous; common.OptionMapRWMutex.Unlock() })
	router := gin.New()
	router.GET("/api/help-center", controller.GetHelpCenter)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/help-center", nil))
	require.Equal(t, http.StatusOK, response.Code)
	var result struct {
		Success bool              `json:"success"`
		Data    helpcenter.Config `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success)
	require.Len(t, result.Data.Items, 1)
	assert.Equal(t, "clients", result.Data.Items[0].ID)
	assert.NotContains(t, response.Body.String(), "requestAnimationFrame")
}

func TestHelpCenterHTMLViewModes(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
	router := gin.New()
	router.GET("/api/help-center", controller.GetHelpCenter)
	for _, mode := range []string{"", "preview", "split", "both"} {
		t.Run("mode="+mode, func(t *testing.T) {
			config := helpcenter.Config{Version: 1, Items: []helpcenter.Item{{
				ID: "bird", Title: "Bird", Kind: "html", Content: "<h1>Bird</h1>", Enabled: true, HTMLViewMode: mode,
			}}}
			encoded, err := common.Marshal(config)
			require.NoError(t, err)
			parsed, err := helpcenter.Parse(string(encoded))
			require.NoError(t, err)
			assert.Equal(t, config, parsed)
			common.OptionMapRWMutex.Lock()
			common.OptionMap[helpcenter.OptionKey] = string(encoded)
			common.OptionMapRWMutex.Unlock()
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/help-center", nil))
			require.Equal(t, http.StatusOK, response.Code)
			var result struct {
				Success bool              `json:"success"`
				Data    helpcenter.Config `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success)
			assert.Equal(t, config, result.Data)
		})
	}
}

func TestHelpCenterDatabaseRoundTrip(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "help.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "help_center_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&model.Option{})) })
			previousDB := model.DB
			model.DB = db
			common.OptionMapRWMutex.Lock()
			previousOptions := common.OptionMap
			common.OptionMap = make(map[string]string)
			common.OptionMapRWMutex.Unlock()
			t.Cleanup(func() {
				model.DB = previousDB
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
			})
			var version string
			query := "select version()"
			if dialect == "sqlite" {
				query = "select sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s: %s", dialect, version)
			require.NoError(t, db.Create(&model.Option{Key: "About", Value: "existing about content"}).Error)
			for range 2 {
				require.NoError(t, model.UpdateOption(helpcenter.OptionKey, helpcenter.DefaultJSON))
				var saved model.Option
				require.NoError(t, db.Where(&model.Option{Key: helpcenter.OptionKey}).First(&saved).Error)
				assert.Equal(t, helpcenter.DefaultJSON, saved.Value)
				assert.Equal(t, saved.Value, common.OptionMap[helpcenter.OptionKey])
			}
			require.Error(t, model.UpdateOption(helpcenter.OptionKey, `{"version":2,"items":[]}`))
			assert.Equal(t, helpcenter.DefaultJSON, common.OptionMap[helpcenter.OptionKey])
			config, err := helpcenter.Parse(helpcenter.DefaultJSON)
			require.NoError(t, err)
			for _, mode := range []string{"preview", "split", "both"} {
				config.Items[1].HTMLViewMode = mode
				encoded, err := common.Marshal(config)
				require.NoError(t, err)
				for range 2 {
					require.NoError(t, model.UpdateOption(helpcenter.OptionKey, string(encoded)))
					var saved model.Option
					require.NoError(t, db.Where(&model.Option{Key: helpcenter.OptionKey}).First(&saved).Error)
					parsed, err := helpcenter.Parse(saved.Value)
					require.NoError(t, err)
					assert.Equal(t, config, parsed)
					assert.Equal(t, saved.Value, common.OptionMap[helpcenter.OptionKey])
				}
				require.Error(t, model.UpdateOption(helpcenter.OptionKey, `{"version":1,"items":[{"id":"bird","title":"Bird","kind":"html","htmlViewMode":"unknown"}]}`))
				var unchanged model.Option
				require.NoError(t, db.Where(&model.Option{Key: helpcenter.OptionKey}).First(&unchanged).Error)
				assert.Equal(t, string(encoded), unchanged.Value)
				assert.Equal(t, string(encoded), common.OptionMap[helpcenter.OptionKey])
			}
			require.NoError(t, model.UpdateOption(helpcenter.OptionKey, `{"version":1,"items":[]}`))
			options, err := model.AllOption()
			require.NoError(t, err)
			values := make(map[string]string)
			for _, option := range options {
				values[option.Key] = option.Value
			}
			assert.Equal(t, `{"version":1,"items":[]}`, values[helpcenter.OptionKey])
			assert.Equal(t, "existing about content", values["About"])
			require.NoError(t, db.Migrator().DropTable(&model.Option{}))
			require.Error(t, model.UpdateOption(helpcenter.OptionKey, helpcenter.DefaultJSON))
			assert.Equal(t, `{"version":1,"items":[]}`, common.OptionMap[helpcenter.OptionKey])
		})
	}
}
