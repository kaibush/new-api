package common

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSQLiteDSNKeepsConcurrencyParamsForBarePaths(t *testing.T) {
	const params = "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "default file name", path: "one-api.db", want: "one-api.db" + params},
		{name: "bare absolute path", path: "/data/new-api.db", want: "/data/new-api.db" + params},
		{name: "bare file URI", path: "file:/data/new-api.db", want: "file:/data/new-api.db" + params},
		{name: "in-memory database", path: ":memory:", want: ":memory:" + params},
		{name: "own query string", path: "/data/new-api.db?_pragma=busy_timeout(5000)", want: "/data/new-api.db?_pragma=busy_timeout(5000)"},
		{name: "file URI with query", path: "file:test?mode=memory&cache=shared", want: "file:test?mode=memory&cache=shared"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, sqliteDSN(tc.path))
		})
	}
}

func TestSQLiteBarePathUsesConcurrencySettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(sqliteDSN(filepath.Join(t.TempDir(), "concurrency.db"))), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
	var journal string
	var timeout int
	require.NoError(t, db.Raw("PRAGMA journal_mode").Scan(&journal).Error)
	require.NoError(t, db.Raw("PRAGMA busy_timeout").Scan(&timeout).Error)
	assert.Equal(t, "wal", journal)
	assert.Equal(t, 30000, timeout)
	first, err := sqlDB.Conn(t.Context())
	require.NoError(t, err)
	defer first.Close()
	second, err := sqlDB.Conn(t.Context())
	require.NoError(t, err)
	defer second.Close()
	_, err = second.ExecContext(t.Context(), "PRAGMA busy_timeout=0")
	require.NoError(t, err)
	tx, err := first.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	defer tx.Rollback()
	blocked, err := second.BeginTx(t.Context(), nil)
	if blocked != nil {
		defer blocked.Rollback()
	}
	require.ErrorContains(t, err, "database is locked")
}
