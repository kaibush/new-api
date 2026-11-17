package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// The old words become one global request-filter instance after the saved
// ones, enabled when both old switches were on; the old options go, and a
// second start changes nothing.
func TestMigrateSensitiveWords(t *testing.T) {
	keep := `{"id":"rp_keep","name":"Keep","plugin":"request-redact","enabled":true,"global":true,"groups":[],"models":[],"config":{"replacement":"[X]"}}`
	tests := map[string]struct {
		options   map[string]string
		language  string
		instances []string
		enabled   bool
		name      string
	}{
		"both switches on": {
			options:   map[string]string{"CheckSensitiveEnabled": "true", "CheckSensitiveOnPromptEnabled": "true", "StopOnSensitiveEnabled": "false", "SensitiveWords": " Bad \n\nworse\r\n", "StreamCacheQueueLength": "3", request_plugin_setting.InstancesOption: "[" + keep + "]"},
			instances: []string{keep},
			enabled:   true,
			name:      "敏感词",
		},
		"one switch on, no saved instances, English": {
			options:  map[string]string{"CheckSensitiveEnabled": "true", "SensitiveWords": "Bad\nworse"},
			language: "en",
			name:     "Sensitive words",
		},
		"Chinese by region": {
			options:  map[string]string{"CheckSensitiveOnPromptEnabled": "true", "SensitiveWords": "Bad\nworse"},
			language: "zh-TW",
			name:     "敏感词",
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			db := useFrontendOptionMigrationDB(t)
			require.NoError(t, db.AutoMigrate(&SystemTask{}))
			previousLanguage := common.DefaultLanguage
			common.DefaultLanguage = tc.language
			t.Cleanup(func() { common.DefaultLanguage = previousLanguage })
			for key, value := range tc.options {
				require.NoError(t, db.Create(&Option{Key: key, Value: value}).Error)
			}

			require.NoError(t, MigrateSensitiveWords())
			for _, key := range retiredSensitiveOptionKeys {
				requireOptionMissing(t, db, key)
			}
			saved := requireOptionValue(t, db, request_plugin_setting.InstancesOption)
			instances := gjson.Parse(saved).Array()
			require.Len(t, instances, len(tc.instances)+1)
			for index, instance := range tc.instances {
				assert.JSONEq(t, instance, instances[index].Raw)
			}
			migrated := instances[len(tc.instances)]
			assert.Regexp(t, `^rp_[a-z2-7]{8}$`, migrated.Get("id").Str)
			withoutID, err := sjson.Delete(migrated.Raw, "id")
			require.NoError(t, err)
			assert.JSONEq(t, `{"name":"`+tc.name+`","plugin":"request-filter","enabled":`+map[bool]string{true: "true", false: "false"}[tc.enabled]+`,
				"global":true,"groups":[],"models":[],
				"config":{"rules":[],"keywords":"Bad\nworse","keywordsCaseSensitive":false,"message":"","replies":false}}`, withoutID)

			require.NoError(t, MigrateSensitiveWords())
			assert.Equal(t, saved, requireOptionValue(t, db, request_plugin_setting.InstancesOption))
		})
	}
}

func TestMigrateSensitiveWordsWithoutWords(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	require.NoError(t, db.AutoMigrate(&SystemTask{}))

	// Nothing to move: no write, no reload.
	require.NoError(t, MigrateSensitiveWords())

	// Switches without words leave no instance behind.
	require.NoError(t, db.Create(&[]Option{{Key: "CheckSensitiveEnabled", Value: "true"}, {Key: "SensitiveWords", Value: " \n "}}).Error)
	require.NoError(t, MigrateSensitiveWords())
	requireOptionMissing(t, db, "CheckSensitiveEnabled")
	requireOptionMissing(t, db, "SensitiveWords")
	requireOptionMissing(t, db, request_plugin_setting.InstancesOption)

	// An instance list it cannot read keeps everything as it was.
	require.NoError(t, db.Create(&[]Option{{Key: "SensitiveWords", Value: "bad"}, {Key: request_plugin_setting.InstancesOption, Value: "{"}}).Error)
	require.Error(t, MigrateSensitiveWords())
	assert.Equal(t, "bad", requireOptionValue(t, db, "SensitiveWords"))
	assert.Equal(t, "{", requireOptionValue(t, db, request_plugin_setting.InstancesOption))
}

// Options, tasks and logs keep their released SQL schema. Exercise the legacy
// JSON and options on real engines, including a separate log connection.
func TestRequestPluginStorageDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "rp_migration_"}})
			require.NoError(t, err)
			logDB, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "rp_log_"}})
			require.NoError(t, err)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Option{}, &Task{}))
				require.NoError(t, logDB.Migrator().DropTable(&Log{}))
				for _, connection := range []*gorm.DB{db, logDB} {
					sqlDB, err := connection.DB()
					require.NoError(t, err)
					require.NoError(t, sqlDB.Close())
				}
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
			})
			for _, connection := range []*gorm.DB{db, logDB} {
				sqlDB, err := connection.DB()
				require.NoError(t, err)
				sqlDB.SetMaxOpenConns(1)

			}
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				require.NoError(t, db.Migrator().DropTable(&Option{}, &Task{}))
				require.NoError(t, logDB.Migrator().DropTable(&Log{}))
				// No columns or SQL types changed from the released schema.
				require.NoError(t, db.AutoMigrate(&Option{}, &Task{}))
				require.NoError(t, logDB.AutoMigrate(&Log{}))
				legacyTask := Task{TaskID: "existing-task", PrivateData: TaskPrivateData{UpstreamTaskID: "upstream-id", Key: "fixture-key"}}
				legacyLog := Log{Content: "existing log", Other: `{"request_path":"/v1/chat/completions"}`}
				if upgrade {
					require.NoError(t, db.Create(&legacyTask).Error)
					require.NoError(t, logDB.Create(&legacyLog).Error)
					require.NoError(t, db.Create(&[]Option{
						{Key: "SensitiveWords", Value: "blocked\n关键词"},
						{Key: "CheckSensitiveEnabled", Value: "true"},
						{Key: "CheckSensitiveOnPromptEnabled", Value: "true"},
						{Key: "ExistingSetting", Value: "retained"},
					}).Error)
				}
				for range 2 {
					require.NoError(t, db.AutoMigrate(&Option{}, &Task{}))
					require.NoError(t, logDB.AutoMigrate(&Log{}))
					require.NoError(t, MigrateSensitiveWords())
				}
				if upgrade {
					var task Task
					require.NoError(t, db.First(&task, legacyTask.ID).Error)
					assert.Equal(t, legacyTask.PrivateData, task.PrivateData)
					var log Log
					require.NoError(t, logDB.First(&log, legacyLog.Id).Error)
					assert.Equal(t, legacyLog.Other, log.Other)
					assert.Equal(t, "retained", requireOptionValue(t, db, "ExistingSetting"))
					assert.Error(t, db.Create(&Option{Key: "ExistingSetting", Value: "duplicate"}).Error)
					instances := gjson.Parse(requireOptionValue(t, db, request_plugin_setting.InstancesOption)).Array()
					require.Len(t, instances, 1)
					assert.True(t, instances[0].Get("enabled").Bool())
					assert.Equal(t, "blocked\n关键词", instances[0].Get("config.keywords").Str)
					requireOptionMissing(t, db, "SensitiveWords")
				}
				stored := Task{TaskID: "report-task", PrivateData: TaskPrivateData{RequestPlugins: &TaskRequestPlugins{
					Instances: []string{"rp_test"}, Format: "openai", Request: []byte(`{"prompt":"保留原文"}`),
				}}}
				require.NoError(t, db.Create(&stored).Error)
				var loaded Task
				require.NoError(t, db.First(&loaded, stored.ID).Error)
				require.NotNil(t, loaded.PrivateData.RequestPlugins)
				assert.Equal(t, stored.PrivateData.RequestPlugins.Instances, loaded.PrivateData.RequestPlugins.Instances)
				assert.JSONEq(t, string(stored.PrivateData.RequestPlugins.Request), string(loaded.PrivateData.RequestPlugins.Request))
				// An unreadable existing list must not lose the legacy keywords.
				require.NoError(t, db.Save(&Option{Key: request_plugin_setting.InstancesOption, Value: "{"}).Error)
				require.NoError(t, db.Create(&Option{Key: "SensitiveWords", Value: "keep"}).Error)
				require.Error(t, MigrateSensitiveWords())
				assert.Equal(t, "keep", requireOptionValue(t, db, "SensitiveWords"))
			}
		})
	}
}
