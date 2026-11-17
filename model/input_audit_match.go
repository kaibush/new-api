package model

import (
	"errors"
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
	Id            int64  `json:"id"`
	RequestId     string `json:"request_id" gorm:"type:varchar(64);index"`
	UserId        int    `json:"user_id" gorm:"index"`
	CreatedAt     int64  `json:"created_at" gorm:"index"`
	Instance      string `json:"instance" gorm:"type:varchar(128)"`
	Name          string `json:"name" gorm:"type:varchar(256)"`
	Plugin        string `json:"plugin" gorm:"type:varchar(128)"`
	PluginVersion string `json:"plugin_version" gorm:"type:varchar(64)"`
	Stage         string `json:"stage" gorm:"type:varchar(32)"`
	Rule          string `json:"rule" gorm:"type:varchar(256)"`
	Model         string `json:"model" gorm:"type:varchar(256)"`
	Evidence      string `json:"-" gorm:"type:text"`
	SearchText    string `json:"-" gorm:"type:text"`
	Status        string `json:"status" gorm:"type:varchar(32);index"`
	Version       int64  `json:"version"`
	Reason        string `json:"reason" gorm:"type:text"`
	ReviewedBy    int    `json:"reviewed_by"`
	UpdatedAt     int64  `json:"updated_at"`
}

func PersistInputAuditMatches(db *gorm.DB, rows []InputAuditMatch, now int64) error {
	return db.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		settings, err := LoadInputAuditSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if settings.Enabled && settings.EvidenceEnabled && len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("created_at < ?", now-int64(settings.RetentionDays)*86400).Delete(&InputAuditMatch{}).Error; err != nil {
			return err
		}
		// Fixed per-row bound plus the evidence budget bounds both disk and queue
		// growth. The budget includes the searchable copy and review note.
		limit := min(settings.EvidenceMaxRecords, int(settings.EvidenceMaxBytes/(24<<10)))
		var boundary []InputAuditMatch
		if err := tx.Select("id").Order("id DESC").Offset(limit).Limit(1).Find(&boundary).Error; err != nil {
			return err
		}
		if len(boundary) > 0 {
			return tx.Where("id <= ?", boundary[0].Id).Delete(&InputAuditMatch{}).Error
		}
		return nil
	})
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
