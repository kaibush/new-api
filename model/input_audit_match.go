package model

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Separate from deduplicated last-user previews: every rejected request owns
// its evidence, including matches in system, tool and attachment text.
type InputAuditMatch struct {
	Id              int64  `json:"id"`
	RequestId       string `json:"request_id" gorm:"type:varchar(64);index"`
	UserId          int    `json:"user_id" gorm:"index"`
	CreatedAt       int64  `json:"created_at" gorm:"index"`
	Instance        string `json:"instance" gorm:"type:varchar(128)"`
	Name            string `json:"name" gorm:"type:varchar(256)"`
	Plugin          string `json:"plugin" gorm:"type:varchar(128)"`
	PluginVersion   string `json:"plugin_version" gorm:"type:varchar(64)"`
	Stage           string `json:"stage" gorm:"type:varchar(32)"`
	Rule            string `json:"rule" gorm:"type:varchar(256)"`
	Model           string `json:"model" gorm:"type:varchar(256)"`
	Evidence        string `json:"-" gorm:"type:text"`
	SearchText      string `json:"-" gorm:"type:text"`
	RequestBody     []byte `json:"-"`
	RequestState    string `json:"request_state,omitempty" gorm:"type:varchar(32)"`
	RequestMaxChars int    `json:"request_max_chars,omitempty"`
	StoredBytes     int64  `json:"stored_bytes"`
	Status          string `json:"status" gorm:"type:varchar(32);index"`
	Version         int64  `json:"version"`
	Reason          string `json:"reason" gorm:"type:text"`
	ReviewedBy      int    `json:"reviewed_by"`
	UpdatedAt       int64  `json:"updated_at"`
}

func PersistInputAuditMatches(db *gorm.DB, rows []InputAuditMatch, now int64) error {
	return db.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		settings, err := LoadInputAuditSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if settings.Enabled && settings.EvidenceEnabled && len(rows) > 0 {
			for i := range rows {
				// Reserve the bounded match/search/decision/metadata footprint even
				// before a reviewer writes a note. Context is charged at compressed size.
				rows[i].StoredBytes = int64(len(rows[i].RequestBody)) + 24<<10
			}
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("created_at < ?", now-int64(settings.RetentionDays)*86400).Delete(&InputAuditMatch{}).Error; err != nil {
			return err
		}
		limit := min(settings.MatchMaxRecords, int(settings.MatchMaxBytes/(24<<10)))
		var boundary []InputAuditMatch
		if err := tx.Select("id").Order("id DESC").Offset(limit).Limit(1).Find(&boundary).Error; err != nil {
			return err
		}
		if len(boundary) > 0 {
			if err := tx.Where("id <= ?", boundary[0].Id).Delete(&InputAuditMatch{}).Error; err != nil {
				return err
			}
		}
		// Legacy rows have no accounting field; apply the same fixed reserve.
		var retained []InputAuditMatch
		if err := tx.Select("id", "stored_bytes").Order("id DESC").Limit(limit + 1).Find(&retained).Error; err != nil {
			return err
		}
		var total int64
		for _, row := range retained {
			total += max(row.StoredBytes, 24<<10)
			if total > settings.MatchMaxBytes {
				return tx.Where("id <= ?", row.Id).Delete(&InputAuditMatch{}).Error
			}
		}
		return nil
	})
}

// DecodeInputAuditMatchRequest limits decompression independently of current
// settings: lowering a capture limit must not make older rows unreadable.
func DecodeInputAuditMatchRequest(body []byte) (*InputAuditEvidenceDocument, error) {
	if len(body) == 0 {
		return nil, nil
	}
	reader, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	decoded, err := io.ReadAll(io.LimitReader(reader, (8<<20)+1))
	if err != nil || len(decoded) > 8<<20 {
		return nil, errors.New("invalid interception request context")
	}
	var document InputAuditEvidenceDocument
	if err := common.Unmarshal(decoded, &document); err != nil {
		return nil, err
	}
	return &document, nil
}

func DecideInputAuditMatch(db *gorm.DB, id, version int64, operator int, status, reason string) error {
	if id < 1 || version < 1 || version >= 9007199254740991 || operator < 1 ||
		!slices.Contains([]string{"pending", "dismissed", "confirmed", "insufficient_evidence"}, status) ||
		strings.TrimSpace(reason) == "" || !utf8.ValidString(reason) || utf8.RuneCountInString(reason) > 1000 || strings.ContainsRune(reason, '\x00') {
		return errors.New("Invalid audit decision")
	}
	result := db.Session(&gorm.Session{Logger: gormlogger.Discard}).Model(&InputAuditMatch{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{
		"status": status, "reason": reason, "version": version + 1, "reviewed_by": operator, "updated_at": common.GetTimestamp(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("The audit record changed or expired; refresh and try again")
	}
	return nil
}
