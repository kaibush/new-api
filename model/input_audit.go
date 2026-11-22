package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

const InputAuditOptionKey = "InputAuditSettings"

// Input audits live in the main database, whose unique indexes provide
// cross-instance deduplication even when the log database is ClickHouse.
type InputAudit struct {
	ReviewAttemptedAt int64  `json:"model_reviewed_at" gorm:"index"`
	Id                int64  `json:"id" gorm:"index:idx_input_audit_time_id,priority:2"`
	UserId            int    `json:"user_id" gorm:"uniqueIndex:idx_input_audit_user_hash,priority:1;index:idx_input_audit_user_time,priority:1;index:idx_input_audit_user_turn,priority:1"`
	EvidenceState     string `json:"evidence_state,omitempty" gorm:"type:varchar(32)"`
	InputHash         string `json:"input_hash,omitempty" gorm:"type:varchar(64)"`
	ContentHash       string `json:"content_hash" gorm:"type:varchar(64);uniqueIndex:idx_input_audit_user_hash,priority:2"`
	CreatedAt         int64  `json:"created_at" gorm:"index:idx_input_audit_time_id,priority:1;index:idx_input_audit_user_time,priority:2"`
	Username          string `json:"username" gorm:"type:varchar(64)"`
	TokenId           int    `json:"token_id"`
	Model             string `json:"model" gorm:"type:varchar(255)"`
	RequestId         string `json:"request_id" gorm:"type:varchar(64)"`
	Route             string `json:"route" gorm:"type:varchar(255)"`
	Ip                string `json:"ip" gorm:"type:varchar(64)"`
	Content           string `json:"content" gorm:"type:text"`
	ContentChars      int    `json:"content_chars"`
	Truncated         bool   `json:"truncated"`
	// TurnKey groups the requests an agent issues for one user message: the
	// chain digest of that message (input_hash for rows captured earlier).
	TurnKey   string `json:"turn_key" gorm:"type:varchar(64);index:idx_input_audit_user_turn,priority:2"`
	TurnItem  int    `json:"turn_item"`
	ThreadId  int64  `json:"thread_id" gorm:"index"`
	ItemCount int    `json:"item_count"`
	NewItems  int    `json:"new_items"`
}

type InputAuditSettings struct {
	Enabled            bool  `json:"enabled"`
	RetentionDays      int   `json:"retention_days"`
	MaxRecords         int   `json:"max_records"`
	MaxChars           int   `json:"max_chars"`
	EvidenceEnabled    bool  `json:"evidence_enabled"`
	EvidenceMaxChars   int   `json:"evidence_max_chars"`
	EvidenceMaxRecords int   `json:"evidence_max_records"`
	EvidenceMaxBytes   int64 `json:"evidence_max_bytes"`
	CaseRetentionDays  int   `json:"case_retention_days"`
	MatchMaxChars      int   `json:"match_max_chars"`
	MatchMaxRecords    int   `json:"match_max_records"`
	MatchMaxBytes      int64 `json:"match_max_bytes"`
}

func DefaultInputAuditSettings() InputAuditSettings {
	return InputAuditSettings{RetentionDays: 7, MaxRecords: 20000, MaxChars: 2048, EvidenceEnabled: true, EvidenceMaxChars: 32768, EvidenceMaxRecords: 20000, EvidenceMaxBytes: 64 << 20, CaseRetentionDays: 30, MatchMaxChars: 131072, MatchMaxRecords: 2000, MatchMaxBytes: 64 << 20}
}

func (s InputAuditSettings) Validate() error {
	if s.RetentionDays < 1 || s.RetentionDays > 90 || s.MaxRecords < 100 || s.MaxRecords > 1000000 || s.MaxChars < 256 || s.MaxChars > 8192 {
		return errors.New("input audit limits: retention 1–90 days, records 100–1000000, characters 256–8192")
	}
	if s.EvidenceMaxChars < 1024 || s.EvidenceMaxChars > 262144 || s.EvidenceMaxRecords < 100 || s.EvidenceMaxRecords > 1000000 || s.EvidenceMaxBytes < 8<<20 || s.EvidenceMaxBytes > 512<<20 || s.CaseRetentionDays < 1 || s.CaseRetentionDays > 90 {
		return errors.New("invalid evidence retention limits")
	}
	if s.MatchMaxChars < 1024 || s.MatchMaxChars > 1048576 || s.MatchMaxRecords < 100 || s.MatchMaxRecords > 1000000 || s.MatchMaxBytes < 8<<20 || s.MatchMaxBytes > 512<<20 {
		return errors.New("invalid interception retention limits")
	}
	return nil
}

func LoadInputAuditSettings(db *gorm.DB) (InputAuditSettings, error) {
	settings := DefaultInputAuditSettings()
	var option Option
	err := db.Where(&Option{Key: InputAuditOptionKey}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		encoded, encodeErr := common.Marshal(settings)
		if encodeErr != nil {
			return settings, encodeErr
		}
		option = Option{Key: InputAuditOptionKey, Value: string(encoded)}
		if err = db.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
			return settings, err
		}
		// Another instance may have initialized or enabled collection meanwhile.
		err = db.Where(&Option{Key: InputAuditOptionKey}).First(&option).Error
	}
	if err != nil {
		return settings, err
	}
	if err = common.UnmarshalJsonStr(option.Value, &settings); err != nil {
		return DefaultInputAuditSettings(), err
	}
	return settings, settings.Validate()
}

func SaveInputAuditSettings(db *gorm.DB, settings InputAuditSettings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	encoded, err := common.Marshal(settings)
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&Option{Key: InputAuditOptionKey, Value: string(encoded)}).Error
}

// PersistInputAudits serializes background writers on the settings row, so
// rolling retention and the row cap also hold across gateway instances.
// A failed transaction never marks a queued input as durably saved.
func PersistInputAudits(db *gorm.DB, rows []InputAudit, now int64) error {
	// Failed SQL logging must not copy message bodies into ordinary server logs.
	db = db.Session(&gorm.Session{Logger: gormlogger.Discard})
	return db.Transaction(func(tx *gorm.DB) error {
		var option Option
		if err := lockForUpdate(tx).Where(&Option{Key: InputAuditOptionKey}).First(&option).Error; err != nil {
			return err
		}
		settings := DefaultInputAuditSettings()
		if err := common.UnmarshalJsonStr(option.Value, &settings); err != nil {
			return err
		}
		if err := settings.Validate(); err != nil {
			return err
		}
		cutoff := now - int64(settings.RetentionDays)*int64(24*time.Hour/time.Second)
		// Bound each cleanup transaction; the next worker tick continues cleanup.
		ids := []int64{}
		if err := tx.Model(&InputAudit{}).Where("created_at < ?", cutoff).Order("created_at").Order("id").Limit(1000).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if err := deleteInputAuditRows(tx, ids); err != nil {
			return err
		}
		if settings.Enabled && len(rows) > 0 {
			current := make([]InputAudit, 0, len(rows))
			for _, row := range rows {
				if row.CreatedAt < cutoff {
					continue
				}
				if row.TurnKey == "" {
					row.TurnKey = row.InputHash
				}
				if row.TurnKey == "" {
					row.TurnKey = row.ContentHash
				}
				current = append(current, row)
			}
			if len(current) > 0 {
				conflict := clause.OnConflict{DoNothing: true}
				if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
					// MySQL can reject id=id when a batch conflicts with an ID
					// generated earlier in that same batch. Never update the auto-ID.
					conflict = clause.OnConflict{DoUpdates: clause.Set{{Column: clause.Column{Name: "content_hash"}, Value: clause.Column{Name: "content_hash"}}}}
				}
				if err := tx.Clauses(conflict).Create(&current).Error; err != nil {
					return err
				}
			}
		}
		// Seek to the oldest retained input; deletion never uses dialect-specific
		// DELETE LIMIT syntax. Normal batches overflow by at most 100 rows.
		var boundary InputAudit
		err := tx.Select("id", "created_at").Order("created_at DESC").Order("id DESC").Offset(settings.MaxRecords - 1).Limit(1).Find(&boundary).Error
		if err != nil {
			return err
		}
		if boundary.Id == 0 {
			return nil
		}
		ids = nil
		if err := tx.Model(&InputAudit{}).Where("created_at < ? OR (created_at = ? AND id < ?)", boundary.CreatedAt, boundary.CreatedAt, boundary.Id).Order("created_at").Order("id").Limit(1000).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if err := deleteInputAuditRows(tx, ids); err != nil {
			return fmt.Errorf("prune input audits: %w", err)
		}
		return nil
	})
}

// deleteInputAuditRows removes request rows and conversation threads that no
// remaining request references.
func deleteInputAuditRows(tx *gorm.DB, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	var threads []int64
	if err := tx.Model(&InputAudit{}).Distinct().Where("id IN ? AND thread_id > 0", ids).Pluck("thread_id", &threads).Error; err != nil {
		return err
	}
	if err := tx.Where("id IN ?", ids).Delete(&InputAudit{}).Error; err != nil {
		return err
	}
	return releaseInputAuditThreads(tx, threads)
}

// BackfillInputAuditTurnKeys groups rows captured before conversation turns
// by their submitted text, matching the earlier list. Safe to run repeatedly.
func BackfillInputAuditTurnKeys(db *gorm.DB) error {
	return db.Model(&InputAudit{}).Where("turn_key IS NULL OR turn_key = ?", "").Update("turn_key", gorm.Expr("CASE WHEN input_hash IS NULL OR input_hash = '' THEN content_hash ELSE input_hash END")).Error
}

type InputAuditFilter struct {
	UserId    int
	RequestId string
	Keyword   string
	Start     int64
	End       int64
}

// InputAuditTurnRef identifies the requests issued for one user message.
type InputAuditTurnRef struct {
	UserId  int    `json:"user_id"`
	TurnKey string `json:"turn_key"`
}

// InputAuditTurn is the latest request of a turn with the turn's totals.
type InputAuditTurn struct {
	InputAudit
	RequestCount int                     `json:"request_count"`
	FirstAt      int64                   `json:"first_at"`
	LastAt       int64                   `json:"last_at"`
	Activity     *InputAuditTurnActivity `json:"activity,omitempty"`
}

// InputAuditTurnActivity summarizes what happened after a user message until
// the next one, so a reviewer can follow an agent loop from the list.
type InputAuditTurnActivity struct {
	ToolCalls int      `json:"tool_calls"`
	Tools     []string `json:"tools"`
	Reply     string   `json:"reply"`
	More      bool     `json:"more"`
}

// QueryInputAuditTurns lists one row per user message; agent loops issue many
// requests for the same message and they are counted, not repeated.
func QueryInputAuditTurns(db *gorm.DB, filter InputAuditFilter, offset, limit int) ([]InputAuditTurn, int64, error) {
	turns := []InputAuditTurn{}
	grouped := filteredInputAudits(db, filter).Select("user_id, turn_key, MAX(id) AS last_id, COUNT(*) AS request_count, MIN(created_at) AS first_at, MAX(created_at) AS last_at").Group("user_id, turn_key")
	var total int64
	if err := db.Table("(?) AS turns", grouped).Count(&total).Error; err != nil {
		return turns, 0, err
	}
	var stats []struct {
		LastId       int64
		RequestCount int
		FirstAt      int64
		LastAt       int64
	}
	if err := db.Table("(?) AS turns", grouped).Order("last_at DESC").Order("last_id DESC").Offset(offset).Limit(limit).Scan(&stats).Error; err != nil {
		return turns, 0, err
	}
	if len(stats) == 0 {
		return turns, total, nil
	}
	ids := make([]int64, 0, len(stats))
	for _, stat := range stats {
		ids = append(ids, stat.LastId)
	}
	var rows []InputAudit
	if err := db.Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return turns, 0, err
	}
	byID := make(map[int64]InputAudit, len(rows))
	for _, row := range rows {
		byID[row.Id] = row
	}
	for _, stat := range stats {
		if row, ok := byID[stat.LastId]; ok {
			turns = append(turns, InputAuditTurn{InputAudit: row, RequestCount: stat.RequestCount, FirstAt: stat.FirstAt, LastAt: stat.LastAt})
		}
	}
	if err := summarizeInputAuditTurns(db, turns); err != nil {
		return turns, 0, err
	}
	return turns, total, nil
}

func QueryInputAudits(db *gorm.DB, filter InputAuditFilter, offset, limit int) ([]InputAudit, int64, error) {
	rows := []InputAudit{}
	query := filteredInputAudits(db, filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return rows, 0, err
	}
	err := query.Order("created_at DESC").Order("id DESC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}

func filteredInputAudits(db *gorm.DB, filter InputAuditFilter) *gorm.DB {
	query := db.Model(&InputAudit{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.RequestId != "" {
		query = query.Where("request_id = ?", filter.RequestId)
	}
	if filter.Keyword != "" {
		// Treat SQL wildcard characters as literal message text. LOWER supports
		// ASCII case-insensitive search across all three database engines.
		keyword := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(filter.Keyword))
		query = query.Where("LOWER(content) LIKE ? ESCAPE '!'", "%"+keyword+"%")
	}
	if filter.Start > 0 {
		query = query.Where("created_at >= ?", filter.Start)
	}
	if filter.End > 0 {
		query = query.Where("created_at <= ?", filter.End)
	}
	return query
}

// DeleteInputAuditMessages removes live submitted text and its derived review
// evidence, selected by request IDs, whole turns or the filter. Conversation
// threads are deleted once no remaining request references them.
// Independently retained human case snapshots keep their audit trail.
func DeleteInputAuditMessages(db *gorm.DB, ids []int64, turns []InputAuditTurnRef, filter InputAuditFilter) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var guard Option
		if err := lockForUpdate(tx).Where(&Option{Key: InputAuditReviewOption}).First(&guard).Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&InputAuditReviewJob{}).Where("lease_until > ?", time.Now().Unix()).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("Pause or stop the review queue before deleting submitted messages")
		}
		// Writers append to conversations under the settings row; holding it
		// keeps them from extending a thread while it is deleted.
		var settings Option
		if err := lockForUpdate(tx).Where(&Option{Key: InputAuditOptionKey}).Limit(1).Find(&settings).Error; err != nil {
			return err
		}
		var upper InputAudit
		if err := tx.Select("id").Order("id DESC").Limit(1).Find(&upper).Error; err != nil {
			return err
		}
		query := filteredInputAudits(tx, filter).Where("id <= ?", upper.Id)
		if len(ids) > 0 {
			query = query.Where("id IN ?", ids)
		}
		if len(turns) > 0 {
			selected := tx.Session(&gorm.Session{NewDB: true})
			for i, turn := range turns {
				if i == 0 {
					selected = selected.Where("user_id = ? AND turn_key = ?", turn.UserId, turn.TurnKey)
				} else {
					selected = selected.Or("user_id = ? AND turn_key = ?", turn.UserId, turn.TurnKey)
				}
			}
			query = query.Where(selected)
		}
		for {
			var rows []InputAudit
			if err := query.Session(&gorm.Session{}).Select("id, user_id, request_id, content_hash").Order("id").Limit(100).Find(&rows).Error; err != nil {
				return err
			}
			if len(rows) == 0 {
				return nil
			}
			deleted := make([]int64, 0, len(rows))
			for _, row := range rows {
				deleted = append(deleted, row.Id)
				var evidenceIDs []int64
				if err := tx.Model(&InputAuditEvidence{}).Where("user_id = ? AND request_id = ? AND content_hash = ?", row.UserId, row.RequestId, row.ContentHash).Pluck("id", &evidenceIDs).Error; err != nil {
					return err
				}
				if err := DeleteInputAuditEvidence(tx, evidenceIDs, "deleted"); err != nil {
					return err
				}
				if err := tx.Where("user_id = ? AND request_id = ?", row.UserId, row.RequestId).Delete(&InputAuditMatch{}).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("audit_id IN ?", deleted).Delete(&InputAuditReviewResult{}).Error; err != nil {
				return err
			}
			if err := deleteInputAuditRows(tx, deleted); err != nil {
				return err
			}
		}
	})
}
