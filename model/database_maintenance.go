package model

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	DatabaseCleanupRequestLogs = "request_logs"
	DatabaseCleanupSiteVisits  = "site_visits"
	DatabaseCleanupBatchSize   = 200
)

var ErrDatabaseCleanupTarget = errors.New("This data cannot be cleaned from database maintenance.")

type DatabaseTableStorage struct {
	Name          string `json:"name"`
	Bytes         *int64 `json:"bytes"`
	DataBytes     *int64 `json:"data_bytes"`
	IndexBytes    *int64 `json:"index_bytes"`
	EstimatedRows *int64 `json:"estimated_rows"`
	CleanupTarget string `json:"cleanup_target,omitempty" gorm:"-"`
}

type DatabaseStorage struct {
	Scope     string                 `json:"scope"`
	Engine    common.DatabaseType    `json:"engine"`
	Name      string                 `json:"name"`
	Available bool                   `json:"available"`
	Bytes     int64                  `json:"bytes"`
	Tables    []DatabaseTableStorage `json:"tables"`
}

// GetDatabaseStorage reads metadata, never counts every row or modifies tables.
// Shared main/log connections are reported once. Separate log databases retain
// their own engine and storage figures rather than being queried through DB.
func GetDatabaseStorage(ctx context.Context) ([]DatabaseStorage, error) {
	connections := []struct {
		db    *gorm.DB
		kind  common.DatabaseType
		scope string
	}{{DB, common.MainDatabaseType(), "primary"}}
	if LOG_DB != nil && LOG_DB != DB {
		connections = append(connections, struct {
			db    *gorm.DB
			kind  common.DatabaseType
			scope string
		}{LOG_DB, common.LogDatabaseType(), "logs"})
	}
	result := make([]DatabaseStorage, 0, len(connections))
	for _, connection := range connections {
		storage, err := databaseStorage(ctx, connection.db, connection.kind, connection.scope)
		if err != nil {
			return nil, err
		}
		result = append(result, storage)
	}
	return result, nil
}

func databaseStorage(ctx context.Context, db *gorm.DB, kind common.DatabaseType, scope string) (DatabaseStorage, error) {
	storage := DatabaseStorage{Scope: scope, Engine: kind, Tables: []DatabaseTableStorage{}}
	if db == nil {
		return storage, errors.New("Database is unavailable.")
	}
	db = db.WithContext(ctx)
	switch kind {
	case common.DatabaseTypeMySQL:
		if err := db.Raw("SELECT DATABASE()").Scan(&storage.Name).Error; err != nil {
			return storage, err
		}
		if err := db.Raw(`SELECT TABLE_NAME AS name,
 COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS bytes,
 COALESCE(DATA_LENGTH, 0) AS data_bytes, COALESCE(INDEX_LENGTH, 0) AS index_bytes,
 TABLE_ROWS AS estimated_rows
 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`).Scan(&storage.Tables).Error; err != nil {
			return storage, err
		}
	case common.DatabaseTypePostgreSQL:
		if err := db.Raw("SELECT current_database()").Scan(&storage.Name).Error; err != nil {
			return storage, err
		}
		if err := db.Raw(`SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes,
 pg_total_relation_size(c.oid) - pg_indexes_size(c.oid) AS data_bytes,
 pg_indexes_size(c.oid) AS index_bytes,
 CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS estimated_rows
 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'm', 'p')`).Scan(&storage.Tables).Error; err != nil {
			return storage, err
		}
	case common.DatabaseTypeSQLite:
		storage.Name = "main"
		var pages, pageSize int64
		if err := db.Raw("PRAGMA page_count").Scan(&pages).Error; err != nil {
			return storage, err
		}
		if err := db.Raw("PRAGMA page_size").Scan(&pageSize).Error; err != nil {
			return storage, err
		}
		storage.Bytes = pages * pageSize
		// SQLite builds do not uniformly expose dbstat. Leave per-table sizes
		// and row estimates unknown instead of scanning every application table.
		if err := db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").Scan(&storage.Tables).Error; err != nil {
			return storage, err
		}
	default:
		// In particular, do not issue relational metadata queries or expose
		// bounded-delete controls against a separate ClickHouse log database.
		return storage, nil
	}
	storage.Available = true
	for i := range storage.Tables {
		table := &storage.Tables[i]
		if table.Bytes != nil {
			storage.Bytes += *table.Bytes
		}
		if table.Name == db.NamingStrategy.TableName("Log") && (scope == "logs" || LOG_DB == DB) {
			table.CleanupTarget = DatabaseCleanupRequestLogs
		}
		if table.Name == db.NamingStrategy.TableName("SiteVisit") && scope == "primary" {
			table.CleanupTarget = DatabaseCleanupSiteVisits
		}
	}
	slices.SortFunc(storage.Tables, func(a, b DatabaseTableStorage) int {
		var aBytes, bBytes int64
		if a.Bytes != nil {
			aBytes = *a.Bytes
		}
		if b.Bytes != nil {
			bBytes = *b.Bytes
		}
		if order := cmp.Compare(bBytes, aBytes); order != 0 {
			return order
		}
		return cmp.Compare(a.Name, b.Name)
	})
	return storage, nil
}

// DatabaseCleanupSnapshot freezes the cutoff and maximum ID displayed by the
// preview. New rows cannot enter the cleanup, even if backdated during import.
type DatabaseCleanupSnapshot struct {
	Target string `json:"target"`
	Before int64  `json:"before"`
	MaxID  int64  `json:"max_id"`
	Count  int64  `json:"count"`
}

func (snapshot DatabaseCleanupSnapshot) query(ctx context.Context) (*gorm.DB, error) {
	if snapshot.Before <= 0 || snapshot.Before > time.Now().Add(-24*time.Hour).Unix() || snapshot.MaxID < 0 {
		return nil, errors.New("Keep at least one day of recent data and preview the cleanup again.")
	}
	var query *gorm.DB
	switch snapshot.Target {
	case DatabaseCleanupRequestLogs:
		if !slices.Contains([]common.DatabaseType{common.DatabaseTypeSQLite, common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL}, common.LogDatabaseType()) || LOG_DB == nil {
			return nil, ErrDatabaseCleanupTarget
		}
		// Billing receipts, refunds, management, login and security audit
		// history are not eligible. No user/accounting tables are traversed.
		query = LOG_DB.WithContext(ctx).Model(&Log{}).Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	case DatabaseCleanupSiteVisits:
		if !slices.Contains([]common.DatabaseType{common.DatabaseTypeSQLite, common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL}, common.MainDatabaseType()) || DB == nil {
			return nil, ErrDatabaseCleanupTarget
		}
		query = DB.WithContext(ctx).Model(&SiteVisit{})
	default:
		return nil, ErrDatabaseCleanupTarget
	}
	return query.Where("created_at < ?", snapshot.Before), nil
}

func PreviewDatabaseCleanup(ctx context.Context, target string, retentionDays int) (*DatabaseCleanupSnapshot, error) {
	if retentionDays < 1 || retentionDays > 3650 {
		return nil, errors.New("Retention must be between 1 and 3650 days.")
	}
	snapshot := &DatabaseCleanupSnapshot{Target: target, Before: time.Now().UTC().AddDate(0, 0, -retentionDays).Unix()}
	query, err := snapshot.query(ctx)
	if err != nil {
		return nil, err
	}
	var totals struct {
		Count int64
		MaxID int64
	}
	if err := query.Select("COUNT(*) AS count, COALESCE(MAX(id), 0) AS max_id").Scan(&totals).Error; err != nil {
		return nil, err
	}
	snapshot.Count, snapshot.MaxID = totals.Count, totals.MaxID
	return snapshot, nil
}

func CountDatabaseCleanup(ctx context.Context, snapshot DatabaseCleanupSnapshot) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	query, err := snapshot.query(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	err = query.Where("id <= ?", snapshot.MaxID).Count(&count).Error
	return count, err
}

func DeleteDatabaseCleanupBatch(ctx context.Context, snapshot DatabaseCleanupSnapshot) (int64, error) {
	query, err := snapshot.query(ctx)
	if err != nil {
		return 0, err
	}
	var ids []int64
	if err := query.Where("id <= ?", snapshot.MaxID).Order("created_at").Order("id").Limit(DatabaseCleanupBatchSize).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	// Reapply eligibility to the DELETE; an external edit between selection
	// and deletion must not remove a now-ineligible record. IDs bound the write
	// on SQLite, MySQL and PostgreSQL without relying on DELETE ... LIMIT.
	query, err = snapshot.query(ctx)
	if err != nil {
		return 0, err
	}
	result := query.Where("id IN ? AND id <= ?", ids, snapshot.MaxID).Delete(query.Statement.Model)
	return result.RowsAffected, result.Error
}
