package model

import (
	"errors"
	"fmt"
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
	Id           int64  `json:"id" gorm:"index:idx_input_audit_time_id,priority:2"`
	UserId       int    `json:"user_id" gorm:"uniqueIndex:idx_input_audit_user_hash,priority:1;index:idx_input_audit_user_time,priority:1"`
	ContentHash  string `json:"content_hash" gorm:"type:varchar(64);uniqueIndex:idx_input_audit_user_hash,priority:2"`
	CreatedAt    int64  `json:"created_at" gorm:"index:idx_input_audit_time_id,priority:1;index:idx_input_audit_user_time,priority:2"`
	Username     string `json:"username" gorm:"type:varchar(64)"`
	TokenId      int    `json:"token_id"`
	Model        string `json:"model" gorm:"type:varchar(255)"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64)"`
	Route        string `json:"route" gorm:"type:varchar(255)"`
	Ip           string `json:"ip" gorm:"type:varchar(64)"`
	Content      string `json:"content" gorm:"type:text"`
	ContentChars int    `json:"content_chars"`
	Truncated    bool   `json:"truncated"`
}

type InputAuditSettings struct {
	Enabled       bool `json:"enabled"`
	RetentionDays int  `json:"retention_days"`
	MaxRecords    int  `json:"max_records"`
	MaxChars      int  `json:"max_chars"`
}

func DefaultInputAuditSettings() InputAuditSettings {
	return InputAuditSettings{RetentionDays: 7, MaxRecords: 20000, MaxChars: 2048}
}

func (s InputAuditSettings) Validate() error {
	if s.RetentionDays < 1 || s.RetentionDays > 90 || s.MaxRecords < 100 || s.MaxRecords > 1000000 || s.MaxChars < 256 || s.MaxChars > 8192 {
		return errors.New("input audit limits: retention 1–90 days, records 100–1000000, characters 256–8192")
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
		if len(ids) > 0 {
			if err := tx.Where("id IN ?", ids).Delete(&InputAudit{}).Error; err != nil {
				return err
			}
		}
		if settings.Enabled && len(rows) > 0 {
			current := make([]InputAudit, 0, len(rows))
			for _, row := range rows {
				if row.CreatedAt >= cutoff {
					current = append(current, row)
				}
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
		if len(ids) == 0 {
			return nil
		}
		if err := tx.Where("id IN ?", ids).Delete(&InputAudit{}).Error; err != nil {
			return fmt.Errorf("prune input audits: %w", err)
		}
		return nil
	})
}

type InputAuditFilter struct {
	UserId    int
	RequestId string
	Start     int64
	End       int64
}

func QueryInputAudits(db *gorm.DB, filter InputAuditFilter, offset, limit int) ([]InputAudit, int64, error) {
	rows := []InputAudit{}
	query := db.Model(&InputAudit{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.RequestId != "" {
		query = query.Where("request_id = ?", filter.RequestId)
	}
	if filter.Start > 0 {
		query = query.Where("created_at >= ?", filter.Start)
	}
	if filter.End > 0 {
		query = query.Where("created_at <= ?", filter.End)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return rows, 0, err
	}
	err := query.Order("created_at DESC").Order("id DESC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}
