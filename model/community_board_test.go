package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestCommunityBoardValidation(t *testing.T) {
	for _, raw := range []string{"javascript:alert(1)", "//example.com", "https://user:secret@example.com", "https://example.com\\evil", "data:text/html,hi"} {
		assert.False(t, ValidCommunityBoardURL(raw), raw)
	}
	assert.True(t, ValidCommunityBoardURL("https://example.com/help?q=1"))
	d := DefaultCommunityBoard()
	require.NoError(t, ValidateCommunityBoard(d))
	d.Blocks = append(d.Blocks, d.Blocks[0])
	assert.ErrorIs(t, ValidateCommunityBoard(d), ErrCommunityBoardInvalid)
	d = DefaultCommunityBoard()
	d.Blocks = []CommunityBoardBlock{{ID: "card", Type: "custom.action_card", Enabled: true, Actions: []CommunityBoardAction{{Type: "external_url", Label: "Open", Value: "javascript:alert(1)"}}}}
	assert.ErrorIs(t, ValidateCommunityBoard(d), ErrCommunityBoardInvalid)
	d.Blocks[0].Actions[0] = CommunityBoardAction{Type: "internal_route", Label: "Open", Value: "/admin"}
	assert.ErrorIs(t, ValidateCommunityBoard(d), ErrCommunityBoardInvalid)
	d.Blocks[0].Actions[0] = CommunityBoardAction{Type: "modal_content", Label: "Details", Value: "**Hello**"}
	require.NoError(t, ValidateCommunityBoard(d))
}

func TestCommunityBoardPayloadLimits(t *testing.T) {
	d := DefaultCommunityBoard()
	d.Title = strings.Repeat("字", 240)
	require.NoError(t, ValidateCommunityBoard(d))
	d.Blocks = []CommunityBoardBlock{{ID: "card", Type: "custom.action_card", Enabled: true}}
	for _, action := range []CommunityBoardAction{
		{Type: "modal_widget", Label: "Open", Value: "admin"},
		{Type: "chat_prefill", Label: "Insert", Value: strings.Repeat("x", 2001)},
	} {
		d.Blocks[0].Actions = []CommunityBoardAction{action}
		assert.ErrorIs(t, ValidateCommunityBoard(d), ErrCommunityBoardInvalid)
	}
	d.Blocks[0].Actions = []CommunityBoardAction{{Type: "modal_widget", Label: "Open", Value: "checkin_leaderboard"}}
	require.NoError(t, ValidateCommunityBoard(d))
	d.Version = 9007199254740991
	assert.ErrorIs(t, ValidateCommunityBoard(d), ErrCommunityBoardInvalid)
}

func TestCommunityBoardStorage(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "board.db"))
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
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			// SQLite serializes writers; queue competing transactions on one connection.
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			var version string
			if dialect == "sqlite" {
				require.NoError(t, db.Raw("select sqlite_version()").Scan(&version).Error)
			} else {
				require.NoError(t, db.Raw("select version()").Scan(&version).Error)
			}
			t.Logf("database: %s %s", dialect, version)
			previous := DB
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			kind := common.DatabaseTypeSQLite
			if dialect == "mysql" {
				kind = common.DatabaseTypeMySQL
			}
			if dialect == "postgres" {
				kind = common.DatabaseTypePostgreSQL
			}
			common.SetDatabaseTypes(kind, previousLog)
			DB = db
			t.Cleanup(func() {
				DB = previous
				common.SetDatabaseTypes(previousMain, previousLog)
				sqlDB, e := db.DB()
				if e == nil {
					_ = sqlDB.Close()
				}
			})
			require.NoError(t, db.AutoMigrate(&Option{}))
			require.NoError(t, db.Where(&Option{Key: CommunityBoardOptionKey}).Delete(&Option{}).Error)
			d, err := GetCommunityBoard()
			require.NoError(t, err)
			assert.Equal(t, DefaultCommunityBoard(), d)
			// Existing options survive publishing; no migration or new schema is required.
			require.NoError(t, db.Save(&Option{Key: "board-test-existing", Value: "preserved"}).Error)
			d.Title = "社区 🎁"
			d.Blocks[0].Enabled = false
			saved, err := SaveCommunityBoard(d)
			require.NoError(t, err)
			assert.EqualValues(t, 1, saved.Version)
			_, err = SaveCommunityBoard(d)
			assert.ErrorIs(t, err, ErrCommunityBoardConflict)
			reloaded, err := GetCommunityBoard()
			require.NoError(t, err)
			assert.Equal(t, saved, reloaded)
			// Two writers starting from the same version cannot silently overwrite one another.
			results := make(chan error, 2)
			for range 2 {
				go func() { _, e := SaveCommunityBoard(saved); results <- e }()
			}
			first, second := <-results, <-results
			if first != nil {
				first, second = second, first
			}
			require.NoError(t, first)
			assert.ErrorIs(t, second, ErrCommunityBoardConflict)
			saved, err = GetCommunityBoard()
			require.NoError(t, err)
			saved.Blocks = []CommunityBoardBlock{}
			saved, err = SaveCommunityBoard(saved)
			require.NoError(t, err)
			for range 2 {
				loaded, e := GetCommunityBoard()
				require.NoError(t, e)
				assert.Empty(t, loaded.Blocks)
				assert.Equal(t, saved.Version, loaded.Version)
			}
			var old Option
			require.NoError(t, db.Where(&Option{Key: "board-test-existing"}).First(&old).Error)
			assert.Equal(t, "preserved", old.Value)
		})
	}
}
