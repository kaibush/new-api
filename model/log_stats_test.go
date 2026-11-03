package model

import (
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestLogStatsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured; use a dedicated test database")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured; use a dedicated test database")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			require.False(t, db.Migrator().HasTable(&Log{}), "use a dedicated empty test database")
			previousDB, previousType := LOG_DB, common.LogDatabaseType()
			LOG_DB = db
			common.SetLogDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Log{}))
				LOG_DB = previousDB
				common.SetLogDatabaseType(previousType)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Log{}))
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)

			now := time.Now().Unix()
			base := Log{Type: LogTypeConsume, CreatedAt: now - 3600, Username: "alice", TokenName: "key-a", ModelName: "gpt-test", ChannelId: 7, Group: "default", PromptTokens: 2000000000, CompletionTokens: 100, Quota: 20, RequestId: "request-a", UpstreamRequestId: "upstream-a"}
			second := base
			second.CreatedAt, second.RequestId, second.UpstreamRequestId = now-3500, "request-b", "upstream-b"
			require.NoError(t, db.Create(&[]Log{base, second}).Error)
			// Each distractor differs in one filter, so a missing predicate changes the totals.
			for _, field := range []string{"username", "token", "model", "channel", "group", "before", "recent", "refund"} {
				row := base
				row.PromptTokens, row.CompletionTokens, row.Quota = 10, 5, 1
				switch field {
				case "username":
					row.Username = "bob"
				case "token":
					row.TokenName = "key-b"
				case "model":
					row.ModelName = "other"
				case "channel":
					row.ChannelId = 8
				case "group":
					row.Group = "other"
				case "before":
					row.CreatedAt = now - 7200
				case "recent":
					row.CreatedAt = now
				case "refund":
					row.Type = LogTypeRefund
				}
				require.NoError(t, db.Create(&row).Error)
			}
			for _, tc := range []struct {
				name                       string
				logType                    int
				model, request, upstream   string
				wantPrompt, wantCompletion int64
				wantQuota                  int
			}{
				{"all matching consumption", LogTypeUnknown, "gpt-test", "", "", 4000000000, 200, 40},
				{"explicit consumption with wildcard", LogTypeConsume, "gpt-%", "", "", 4000000000, 200, 40},
				{"request id", LogTypeConsume, "gpt-test", "request-a", "", 2000000000, 100, 20},
				{"upstream request id", LogTypeConsume, "gpt-test", "", "upstream-b", 2000000000, 100, 20},
				{"no matching records", LogTypeConsume, "missing", "", "", 0, 0, 0},
				{"non consumption filter", LogTypeRefund, "gpt-test", "", "", 0, 0, 0},
			} {
				t.Run(tc.name, func(t *testing.T) {
					stat, err := SumUsedQuota(tc.logType, now-3600, now-3500, tc.model, "alice", "key-a", 7, "default", tc.request, tc.upstream)
					require.NoError(t, err)
					assert.Equal(t, tc.wantQuota, stat.Quota)
					assert.Equal(t, tc.wantPrompt, stat.PromptTokens)
					assert.Equal(t, tc.wantCompletion, stat.CompletionTokens)
					assert.Equal(t, tc.wantPrompt+tc.wantCompletion, stat.TotalTokens)
					if tc.logType == LogTypeUnknown || tc.logType == LogTypeConsume && tc.model != "missing" && tc.upstream == "" {
						assert.Equal(t, 1, stat.Rpm, "rates still describe the last minute, independently of the selected time range")
						assert.Equal(t, 15, stat.Tpm)
					} else {
						assert.Zero(t, stat.Rpm)
						assert.Zero(t, stat.Tpm)
					}
					payload, err := common.Marshal(stat)
					require.NoError(t, err)
					assert.Contains(t, string(payload), `"total_tokens":`)
					assert.Contains(t, string(payload), `"prompt_tokens":`)
					assert.Contains(t, string(payload), `"completion_tokens":`)
				})
			}
		})
	}
}
