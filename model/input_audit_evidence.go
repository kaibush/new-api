package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

type InputAuditEvidenceMessage struct {
	Index         int    `json:"index"`
	Role          string `json:"role"`
	Text          string `json:"text"`
	Kind          string `json:"kind,omitempty"`
	Path          string `json:"path,omitempty"`
	CallID        string `json:"call_id,omitempty"`
	Name          string `json:"name,omitempty"`
	OriginalChars int    `json:"original_chars,omitempty"`
	OriginalHash  string `json:"original_hash,omitempty"`
	Truncated     bool   `json:"truncated,omitempty"`
	TextHash      string `json:"text_hash,omitempty"`
}

type InputAuditEvidenceDocument struct {
	Version            int                         `json:"version,omitempty"`
	PreviousResponseID string                      `json:"previous_response_id,omitempty"`
	Source             string                      `json:"source"`
	Scope              string                      `json:"scope"`
	Messages           []InputAuditEvidenceMessage `json:"messages"`
	Truncated          bool                        `json:"truncated"`
	ContextMissing     bool                        `json:"context_missing"`
	Omitted            []string                    `json:"omitted"`
}

func (document InputAuditEvidenceDocument) Complete() bool {
	return document.Source == "client_request" && !document.Truncated && !document.ContextMissing && len(document.Omitted) == 0 && len(document.Messages) > 0
}

// Reviewable reports whether retained original excerpts can be cited by a
// human. It deliberately does not imply complete context or an automated verdict.
func (document InputAuditEvidenceDocument) Reviewable() bool {
	if document.Complete() {
		return true
	}
	return document.Version >= 2 && document.Source == "client_request" && slices.ContainsFunc(document.Messages, func(message InputAuditEvidenceMessage) bool { return message.Text != "" && message.OriginalHash != "" })
}

type InputAuditEvidence struct {
	Id           int64  `json:"id"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);uniqueIndex:idx_input_evidence_user_request,priority:2"`
	UserId       int    `json:"user_id" gorm:"uniqueIndex:idx_input_evidence_user_request,priority:1;index:idx_input_evidence_user_time,priority:1"`
	CreatedAt    int64  `json:"created_at" gorm:"index:idx_input_evidence_user_time,priority:2;index"`
	ContentHash  string `json:"content_hash" gorm:"type:varchar(64)"`
	DocumentHash string `json:"document_hash" gorm:"type:varchar(64)"`
	Body         string `json:"-"`
	BodyBytes    int64  `json:"body_bytes"`
	Policy       string `json:"-"`
}

type InputAuditPolicyRevision struct {
	Id        int64  `json:"id"`
	Version   int64  `json:"version" gorm:"uniqueIndex"`
	CreatedAt int64  `json:"created_at" gorm:"index"`
	Policy    string `json:"-"`
}

type InputAuditCaseSnapshot struct {
	Audit        InputAudit                       `json:"audit"`
	EvidenceID   int64                            `json:"evidence_id"`
	DocumentHash string                           `json:"document_hash"`
	Document     InputAuditEvidenceDocument       `json:"document"`
	Allowlist    request_plugin_setting.Allowlist `json:"allowlist"`
}

type InputAuditCase struct {
	Id          int64  `json:"id"`
	AuditId     int64  `json:"audit_id" gorm:"uniqueIndex"`
	UserId      int    `json:"user_id" gorm:"index"`
	RequestId   string `json:"request_id" gorm:"type:varchar(64)"`
	CreatedAt   int64  `json:"created_at" gorm:"index"`
	CreatedBy   int    `json:"created_by"`
	ExpiresAt   int64  `json:"expires_at" gorm:"index"`
	UpdatedAt   int64  `json:"updated_at"`
	Version     int64  `json:"version"`
	Status      string `json:"status" gorm:"type:varchar(32);index"`
	Category    string `json:"category" gorm:"type:varchar(32)"`
	Reason      string `json:"reason" gorm:"type:text"`
	StoredBytes int64  `json:"stored_bytes"`
	Snapshot    string `json:"-"`
}

type InputAuditEvidenceReference struct {
	MessageIndex int    `json:"message_index"`
	Quote        string `json:"quote"`
	Start        int    `json:"start"`
	End          int    `json:"end"`
}

type InputAuditDecision struct {
	Id         int64  `json:"id"`
	CaseId     int64  `json:"case_id" gorm:"index"`
	CreatedAt  int64  `json:"created_at"`
	CreatedBy  int    `json:"created_by"`
	Version    int64  `json:"version"`
	Status     string `json:"status" gorm:"type:varchar(32)"`
	Category   string `json:"category" gorm:"type:varchar(32)"`
	Reason     string `json:"reason" gorm:"type:text"`
	References string `json:"-"`
}

func CreateInputAuditCase(db *gorm.DB, auditID int64, operator int, reason string) (InputAuditCase, error) {
	var review InputAuditCase
	if auditID < 1 || operator < 1 || !utf8.ValidString(reason) || strings.TrimSpace(reason) == "" || utf8.RuneCountInString(reason) > 500 || strings.ContainsRune(reason, '\x00') {
		return review, errors.New("Invalid audit case parameters")
	}
	err := db.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		settings, err := LoadInputAuditSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if err := tx.Where("audit_id = ?", auditID).First(&review).Error; err == nil {
			if review.ExpiresAt <= time.Now().Unix() {
				return errors.New("This audit case has expired")
			}
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&InputAuditCase{}).Count(&count).Error; err != nil {
			return err
		}
		if count >= 1000 {
			return errors.New("The audit case limit has been reached")
		}
		var audit InputAudit
		if err := tx.First(&audit, auditID).Error; err != nil {
			return err
		}
		snapshot := InputAuditCaseSnapshot{Audit: audit, Document: InputAuditEvidenceDocument{Source: "legacy_preview", Scope: "retained_user_text", Messages: []InputAuditEvidenceMessage{{Role: "user", Text: audit.Content}}, Truncated: audit.Truncated, ContextMissing: true, Omitted: []string{"original_context_unavailable"}}}
		var evidence InputAuditEvidence
		if audit.RequestId != "" {
			err := tx.Where("request_id = ? AND user_id = ? AND content_hash = ? AND created_at >= ?", audit.RequestId, audit.UserId, audit.ContentHash, time.Now().Unix()-int64(settings.RetentionDays)*86400).First(&evidence).Error
			if err == nil {
				var readErr error
				snapshot.Document, readErr = ReadInputAuditEvidence(tx, evidence)
				if readErr != nil {
					return readErr
				}
				if evidence.Policy != "" {
					if err := common.UnmarshalJsonStr(evidence.Policy, &snapshot.Allowlist); err != nil {
						return err
					}
				}
				snapshot.EvidenceID, snapshot.DocumentHash = evidence.Id, evidence.DocumentHash
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		encoded, err := common.Marshal(snapshot)
		if err != nil {
			return err
		}
		var storedBytes int64
		if err := tx.Model(&InputAuditCase{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&storedBytes).Error; err != nil {
			return err
		}
		if storedBytes+int64(len(encoded)) > 256<<20 {
			return errors.New("The audit case storage limit has been reached")
		}
		now := time.Now().Unix()
		review = InputAuditCase{AuditId: audit.Id, UserId: audit.UserId, RequestId: audit.RequestId, CreatedAt: now, UpdatedAt: now, CreatedBy: operator, ExpiresAt: now + int64(settings.CaseRetentionDays)*86400, Version: 1, Status: "pending", Category: "other", Reason: reason, Snapshot: string(encoded), StoredBytes: int64(len(encoded))}
		return tx.Create(&review).Error
	})
	return review, err
}

func DecideInputAuditCase(db *gorm.DB, caseID, version int64, operator int, status, category, reason string, references []InputAuditEvidenceReference) error {
	if operator < 1 || version < 1 || version >= 9007199254740991 || !slices.Contains([]string{"pending", "insufficient_evidence", "confirmed", "dismissed", "appeal_review"}, status) || !slices.Contains([]string{"fraud", "cyber_abuse", "sexual", "dangerous_materials", "self_harm", "prompt_injection", "other"}, category) || !utf8.ValidString(reason) || strings.TrimSpace(reason) == "" || utf8.RuneCountInString(reason) > 2000 || strings.ContainsRune(reason, '\x00') || len(references) > 16 {
		return errors.New("Invalid audit decision")
	}
	return db.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		if _, err := LoadInputAuditSettings(lockForUpdate(tx)); err != nil {
			return err
		}
		var review InputAuditCase
		if err := lockForUpdate(tx).First(&review, caseID).Error; err != nil {
			return err
		}
		if review.Version != version {
			return ErrInputAuditConflict
		}
		if review.ExpiresAt <= time.Now().Unix() {
			return errors.New("This audit case has expired")
		}
		var snapshot InputAuditCaseSnapshot
		if err := common.UnmarshalJsonStr(review.Snapshot, &snapshot); err != nil {
			return err
		}
		if status == "confirmed" && (!snapshot.Document.Reviewable() || len(references) == 0) {
			return errors.New("Retained original text and an exact quote are required")
		}
		for i := range references {
			reference := &references[i]
			if !utf8.ValidString(reference.Quote) || utf8.RuneCountInString(reference.Quote) > 4096 {
				return errors.New("Invalid evidence reference")
			}
			if reference.MessageIndex < 0 || reference.MessageIndex >= len(snapshot.Document.Messages) || reference.Quote == "" {
				return errors.New("Invalid evidence reference")
			}
			text := snapshot.Document.Messages[reference.MessageIndex].Text
			position := strings.Index(text, reference.Quote)
			if position < 0 || strings.Contains(reference.Quote, "[… omitted …]") || strings.Contains(reference.Quote, "[media omitted]") {
				return errors.New("The evidence quote does not exist in the original message")
			}
			reference.Start = utf8.RuneCountInString(text[:position])
			reference.End = reference.Start + utf8.RuneCountInString(reference.Quote)
		}
		encoded, err := common.Marshal(references)
		if err != nil {
			return err
		}
		if len(encoded) > 128<<10 {
			return errors.New("Evidence references exceed the storage limit")
		}
		var decisions int64
		if err := tx.Model(&InputAuditDecision{}).Where("case_id = ?", caseID).Count(&decisions).Error; err != nil {
			return err
		}
		if decisions >= 100 {
			return errors.New("The decision history limit has been reached")
		}
		addedBytes := int64(len(encoded) + len(reason))
		var storedBytes int64
		if err := tx.Model(&InputAuditCase{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&storedBytes).Error; err != nil {
			return err
		}
		if storedBytes+addedBytes > 256<<20 {
			return errors.New("The audit case storage limit has been reached")
		}
		now := time.Now().Unix()
		result := tx.Model(&InputAuditCase{}).Where("id = ? AND version = ?", caseID, version).Updates(map[string]any{"status": status, "category": category, "version": version + 1, "updated_at": now, "stored_bytes": review.StoredBytes + addedBytes})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInputAuditConflict
		}
		return tx.Create(&InputAuditDecision{CaseId: caseID, CreatedAt: now, CreatedBy: operator, Version: version + 1, Status: status, Category: category, Reason: reason, References: string(encoded)}).Error
	})
}

func InputAuditCaseSnapshotOf(review InputAuditCase) (InputAuditCaseSnapshot, error) {
	var snapshot InputAuditCaseSnapshot
	err := common.UnmarshalJsonStr(review.Snapshot, &snapshot)
	if err != nil {
		return snapshot, fmt.Errorf("read audit evidence: %w", err)
	}
	return snapshot, nil
}
