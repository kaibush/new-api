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
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

// Each retained excerpt is compressed once per user; system/developer prompts
// share an internal scope across users. No public API exposes blob hashes. Request manifests preserve
// every occurrence and its original position, even for repeated identical text.
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
		reader, err := gzip.NewReader(bytes.NewReader(row.Body))
		if err != nil {
			return err
		}
		// Excerpts have a hard upper bound, independent of compressed input size.
		decoded, err := io.ReadAll(io.LimitReader(reader, 256<<10+1))
		closeErr := reader.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if len(decoded) > 256<<10 {
			return errors.New("audit excerpt exceeds decoding limit")
		}
		digest := sha256.Sum256(decoded)
		if hex.EncodeToString(digest[:]) != row.Hash {
			return errors.New("audit excerpt checksum mismatch")
		}
		texts[row.Hash] = string(decoded)
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

func PersistInputAuditEvidence(db *gorm.DB, rows []InputAuditEvidence, now int64) error {
	db = db.Session(&gorm.Session{Logger: gormlogger.Discard})
	return db.Transaction(func(tx *gorm.DB) error {
		settings, err := LoadInputAuditSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		cutoff := now - int64(settings.RetentionDays)*86400
		if settings.Enabled && settings.EvidenceEnabled {
			for _, entry := range rows {
				if entry.CreatedAt < cutoff {
					continue
				}
				var existing InputAuditEvidence
				err := tx.Select("id").Where("user_id = ? AND request_id = ?", entry.UserId, entry.RequestId).First(&existing).Error
				if err == nil {
					continue
				}
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				var document InputAuditEvidenceDocument
				if err := common.UnmarshalJsonStr(entry.Body, &document); err != nil {
					return err
				}
				refs := make(map[string]InputAuditEvidenceTextRef)
				for i := range document.Messages {
					message := &document.Messages[i]
					scopeUser := entry.UserId
					promptHash := ""
					if message.Kind == "message" && (message.Role == "system" || message.Role == "developer") {
						scopeUser = 0
						promptHash = message.OriginalHash
					}
					if message.Text == "" {
						if promptHash != "" {
							// Keep the prompt association even when its text budget
							// was exhausted. A zero text ID never refers to a blob.
							refs["0:"+promptHash] = InputAuditEvidenceTextRef{PromptHash: promptHash}
						}
						continue
					}
					digest := sha256.Sum256([]byte(message.Text))
					hash := hex.EncodeToString(digest[:])
					var blob InputAuditEvidenceText
					err := tx.Select("id").Where("user_id = ? AND hash = ?", scopeUser, hash).First(&blob).Error
					if errors.Is(err, gorm.ErrRecordNotFound) {
						var compressed bytes.Buffer
						writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
						if err != nil {
							return err
						}
						if _, err := writer.Write([]byte(message.Text)); err != nil {
							return err
						}
						if err := writer.Close(); err != nil {
							return err
						}
						blob = InputAuditEvidenceText{UserId: scopeUser, Hash: hash, Body: compressed.Bytes(), StoredBytes: int64(compressed.Len())}
						if err := tx.Create(&blob).Error; err != nil {
							return err
						}
					} else if err != nil {
						return err
					}
					refs[fmt.Sprintf("%d:%s", blob.Id, promptHash)] = InputAuditEvidenceTextRef{TextId: blob.Id, PromptHash: promptHash}
					message.Text, message.TextHash = "", hash
				}
				body, err := common.Marshal(document)
				if err != nil {
					return err
				}
				var manifest bytes.Buffer
				writer, err := gzip.NewWriterLevel(&manifest, gzip.BestSpeed)
				if err != nil {
					return err
				}
				if _, err := writer.Write(body); err != nil {
					return err
				}
				if err := writer.Close(); err != nil {
					return err
				}
				entry.Body = "gzip:" + base64.StdEncoding.EncodeToString(manifest.Bytes())
				entry.BodyBytes = int64(len(entry.Body) + len(entry.Policy) + len(refs)*96)
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
				if err := tx.Model(&InputAudit{}).Where("user_id = ? AND request_id = ?", entry.UserId, entry.RequestId).Update("evidence_state", "retained").Error; err != nil {
					return err
				}
				if len(refs) > 0 {
					links := make([]InputAuditEvidenceTextRef, 0, len(refs))
					for _, ref := range refs {
						ref.EvidenceId = entry.Id
						links = append(links, ref)
					}
					if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&links).Error; err != nil {
						return err
					}
				}
			}
		}
		for {
			var expired []int64
			if err := tx.Model(&InputAuditEvidence{}).Where("created_at < ?", cutoff).Limit(1000).Pluck("id", &expired).Error; err != nil {
				return err
			}
			if len(expired) == 0 {
				break
			}
			if err := DeleteInputAuditEvidence(tx, expired, "expired"); err != nil {
				return err
			}
		}
		// Enforce a budget on actual compressed excerpts plus request manifests.
		// Referenced excerpts are collected only after the final request releases them.
		for {
			var count int64
			if err := tx.Model(&InputAuditEvidence{}).Count(&count).Error; err != nil {
				return err
			}
			manifestBytes, textBytes, err := InputAuditEvidenceStorage(tx)
			if err != nil {
				return err
			}
			if count <= int64(settings.EvidenceMaxRecords) && manifestBytes+textBytes <= settings.EvidenceMaxBytes {
				break
			}
			// Amortize byte-budget cleanup as well as record-budget cleanup.
			// Large settings reductions must not rescan every retained payload
			// once per evicted request.
			amount := min(1000, int(count-int64(settings.EvidenceMaxRecords)))
			if amount <= 0 {
				amount = 32
			}
			var ids []int64
			if err := tx.Model(&InputAuditEvidence{}).Order("created_at").Order("id").Limit(amount).Pluck("id", &ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				break
			}
			if err := DeleteInputAuditEvidence(tx, ids, "capacity_evicted"); err != nil {
				return err
			}
		}
		var cases []int64
		if err := tx.Model(&InputAuditCase{}).Where("expires_at <= ?", now).Pluck("id", &cases).Error; err != nil {
			return err
		}
		if len(cases) > 0 {
			if err := tx.Where("case_id IN ?", cases).Delete(&InputAuditDecision{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", cases).Delete(&InputAuditCase{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// Call within the same transaction as request removal; never collect a blob
// while another retained request still references it.
func DeleteInputAuditEvidence(tx *gorm.DB, ids []int64, reason string) error {
	if len(ids) == 0 {
		return nil
	}
	var rows []InputAuditEvidence
	if err := tx.Select("user_id", "request_id").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := tx.Model(&InputAudit{}).Where("user_id = ? AND request_id = ?", row.UserId, row.RequestId).Update("evidence_state", reason).Error; err != nil {
			return err
		}
	}
	if err := tx.Where("evidence_id IN ?", ids).Delete(&InputAuditEvidenceTextRef{}).Error; err != nil {
		return err
	}
	if err := tx.Where("id IN ?", ids).Delete(&InputAuditEvidence{}).Error; err != nil {
		return err
	}
	return tx.Where("id NOT IN (?)", tx.Model(&InputAuditEvidenceTextRef{}).Select("text_id")).Delete(&InputAuditEvidenceText{}).Error
}

// Storage statistics describe retained payloads, excluding database page/index
// overhead. A database may retain reusable pages after records are removed.
func InputAuditEvidenceStorage(db *gorm.DB) (int64, int64, error) {
	var manifestBytes, textBytes int64
	if err := db.Model(&InputAuditEvidence{}).Select("COALESCE(SUM(body_bytes), 0)").Scan(&manifestBytes).Error; err != nil {
		return 0, 0, err
	}
	err := db.Model(&InputAuditEvidenceText{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&textBytes).Error
	return manifestBytes, textBytes, err
}
