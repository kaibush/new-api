package model

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Each retained excerpt is compressed once per user; system/developer prompts
// share an internal scope across users. No public API exposes blob hashes.
// Conversation thread items and legacy request manifests reference them.
type InputAuditEvidenceText struct {
	Id          int64  `json:"id"`
	UserId      int    `gorm:"uniqueIndex:idx_audit_text_user_hash,priority:1"`
	Hash        string `gorm:"type:varchar(64);uniqueIndex:idx_audit_text_user_hash,priority:2"`
	Body        []byte `json:"-"`
	StoredBytes int64
}

type InputAuditEvidenceTextRef struct {
	EvidenceId int64  `gorm:"primaryKey;autoIncrement:false"`
	TextId     int64  `gorm:"primaryKey;autoIncrement:false;index"`
	PromptHash string `gorm:"type:varchar(64);primaryKey;index"`
}

// ReadInputAuditEvidence also supports the original inline JSON format. Cases
// copy hydrated excerpts, so their retention never depends on live blob GC.
func ReadInputAuditEvidence(db *gorm.DB, evidence InputAuditEvidence) (InputAuditEvidenceDocument, error) {
	var document InputAuditEvidenceDocument
	body := []byte(evidence.Body)
	if encoded, ok := strings.CutPrefix(evidence.Body, "gzip:"); ok {
		compressed, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return document, err
		}
		reader, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			return document, err
		}
		decoded, err := io.ReadAll(io.LimitReader(reader, (2<<20)+1))
		closeErr := reader.Close()
		if err != nil {
			return document, err
		}
		if closeErr != nil {
			return document, closeErr
		}
		if len(decoded) > 2<<20 {
			return document, errors.New("audit manifest exceeds decoding limit")
		}
		body = decoded
	}
	if err := common.Unmarshal(body, &document); err != nil {
		return document, err
	}
	if err := HydrateInputAuditEvidence(db, evidence.UserId, document.Messages); err != nil {
		return document, err
	}
	return document, nil
}

func HydrateInputAuditEvidence(db *gorm.DB, userID int, messages []InputAuditEvidenceMessage) error {
	hashes := make([]string, 0, len(messages))
	for _, message := range messages {
		if message.TextHash != "" {
			hashes = append(hashes, message.TextHash)
		}
	}
	if len(hashes) == 0 {
		return nil
	}
	var rows []InputAuditEvidenceText
	if err := db.Where("user_id IN ? AND hash IN ?", []int{0, userID}, hashes).Find(&rows).Error; err != nil {
		return err
	}
	texts := make(map[string]string, len(rows))
	for _, row := range rows {
		text, err := decodeInputAuditText(row)
		if err != nil {
			return err
		}
		texts[row.Hash] = text
	}
	for i := range messages {
		if messages[i].TextHash == "" {
			continue
		}
		value, ok := texts[messages[i].TextHash]
		if !ok {
			return fmt.Errorf("audit excerpt unavailable")
		}
		messages[i].Text, messages[i].TextHash = value, ""
	}
	return nil
}

// Excerpts have a hard upper bound, independent of compressed input size.
func decodeInputAuditText(row InputAuditEvidenceText) (string, error) {
	reader, err := gzip.NewReader(bytes.NewReader(row.Body))
	if err != nil {
		return "", err
	}
	decoded, err := io.ReadAll(io.LimitReader(reader, 1<<20+1))
	closeErr := reader.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	if len(decoded) > 1<<20 {
		return "", errors.New("audit excerpt exceeds decoding limit")
	}
	digest := sha256.Sum256(decoded)
	if hex.EncodeToString(digest[:]) != row.Hash {
		return "", errors.New("audit excerpt checksum mismatch")
	}
	return string(decoded), nil
}

// DeleteInputAuditEvidence removes legacy per-request manifests. Call it within
// the transaction removing their requests; shared texts are collected only
// after no thread item or other manifest references them.
func DeleteInputAuditEvidence(tx *gorm.DB, ids []int64, reason string) error {
	if len(ids) == 0 {
		return nil
	}
	var rows []InputAuditEvidence
	if err := tx.Select("user_id", "request_id").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := tx.Model(&InputAudit{}).Where("user_id = ? AND request_id = ? AND thread_id = ?", row.UserId, row.RequestId, 0).Update("evidence_state", reason).Error; err != nil {
			return err
		}
	}
	var textIDs []int64
	if err := tx.Model(&InputAuditEvidenceTextRef{}).Distinct().Where("evidence_id IN ? AND text_id > 0", ids).Pluck("text_id", &textIDs).Error; err != nil {
		return err
	}
	if err := tx.Where("evidence_id IN ?", ids).Delete(&InputAuditEvidenceTextRef{}).Error; err != nil {
		return err
	}
	if err := tx.Where("id IN ?", ids).Delete(&InputAuditEvidence{}).Error; err != nil {
		return err
	}
	return collectInputAuditTexts(tx, textIDs)
}
