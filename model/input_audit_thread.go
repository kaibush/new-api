package model

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// InputAuditThread stores one client conversation. Agent clients resend the
// whole history with every request; a request that extends a stored prefix
// only appends its new items, and identical excerpts share one compressed
// text (system/developer prompts are shared across users).
type InputAuditThread struct {
	Id             int64  `json:"id"`
	UserId         int    `json:"user_id" gorm:"index"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at" gorm:"index"`
	ItemCount      int    `json:"item_count"`
	ParentId       int64  `json:"parent_id"`
	StoredBytes    int64  `json:"stored_bytes"`
	Truncated      bool   `json:"truncated"`
	ContextMissing bool   `json:"context_missing"`
	Tools          string `json:"-" gorm:"type:text"`
}

// InputAuditThreadItem is one conversation item at its position (Seq) in
// every request sharing the prefix. ChainHash digests the item together with
// all earlier items, so a single lookup finds a request's longest stored prefix.
type InputAuditThreadItem struct {
	ThreadId      int64  `gorm:"primaryKey;autoIncrement:false"`
	Seq           int    `gorm:"primaryKey;autoIncrement:false"`
	UserId        int    `gorm:"index:idx_audit_item_user_chain,priority:1"`
	ChainHash     string `gorm:"type:varchar(64);index:idx_audit_item_user_chain,priority:2"`
	CreatedAt     int64
	Role          string `gorm:"type:varchar(16)"`
	Kind          string `gorm:"type:varchar(16)"`
	Name          string `gorm:"type:varchar(128)"`
	CallId        string `gorm:"type:varchar(128)"`
	TextId        int64  `gorm:"index"`
	OriginalChars int
	Media         int
	Truncated     bool
}

// InputAuditTranscript is one request's ordered conversation as captured by
// the gateway. Known items were already queued by an earlier request on this
// instance and carry no text.
type InputAuditTranscript struct {
	UserId         int
	RequestId      string
	ContentHash    string
	CreatedAt      int64
	Items          []InputAuditTranscriptItem
	Tools          []string
	Truncated      bool
	ContextMissing bool
}

type InputAuditTranscriptItem struct {
	Chain         string
	Role          string
	Kind          string
	Name          string
	CallId        string
	Text          string
	Known         bool
	OriginalChars int
	Media         int
	Truncated     bool
}

type InputAuditTranscriptEntry struct {
	Seq           int    `json:"seq"`
	Role          string `json:"role"`
	Kind          string `json:"kind"`
	Name          string `json:"name,omitempty"`
	CallId        string `json:"call_id,omitempty"`
	Text          string `json:"text"`
	OriginalChars int    `json:"original_chars"`
	Media         int    `json:"media,omitempty"`
	Truncated     bool   `json:"truncated,omitempty"`
	Unavailable   bool   `json:"unavailable,omitempty"`
	CreatedAt     int64  `json:"created_at,omitempty"`
}

type InputAuditOutlineEntry struct {
	Seq       int    `json:"seq"`
	Text      string `json:"text"`
	Requests  int    `json:"requests"`
	CreatedAt int64  `json:"created_at"`
}

// Estimated row and index overhead of one stored item, excluding its text.
const inputAuditThreadItemBytes = 160

// PersistInputAuditTranscripts serializes writers on the settings row, like
// request rows. It reports stale when the caller's known-prefix cache no
// longer describes stored threads (eviction or items that were never stored).
func PersistInputAuditTranscripts(db *gorm.DB, transcripts []InputAuditTranscript, now int64) (bool, error) {
	db = db.Session(&gorm.Session{Logger: gormlogger.Discard})
	stale := false
	err := db.Transaction(func(tx *gorm.DB) error {
		stale = false
		settings, err := LoadInputAuditSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		cutoff := now - int64(settings.RetentionDays)*86400
		for i := range transcripts {
			if len(transcripts[i].Items) == 0 {
				continue
			}
			// The caller already treats these items as stored.
			if !settings.Enabled || !settings.EvidenceEnabled || transcripts[i].CreatedAt < cutoff {
				stale = true
				continue
			}
			missing, err := appendInputAuditTranscript(tx, &transcripts[i], now)
			if err != nil {
				return err
			}
			stale = stale || missing
		}
		evicted, err := pruneInputAuditEvidence(tx, settings, cutoff)
		if err != nil {
			return err
		}
		stale = stale || evicted
		var cases []int64
		if err := tx.Model(&InputAuditCase{}).Where("expires_at <= ?", now).Pluck("id", &cases).Error; err != nil {
			return err
		}
		if len(cases) == 0 {
			return nil
		}
		if err := tx.Where("case_id IN ?", cases).Delete(&InputAuditDecision{}).Error; err != nil {
			return err
		}
		return tx.Where("id IN ?", cases).Delete(&InputAuditCase{}).Error
	})
	return stale, err
}

// appendInputAuditTranscript links a request to the thread holding its
// longest stored prefix. A request extending the thread tip appends to it, a
// replayed prefix adds nothing, and a request diverging from stored history
// forks a new thread that copies the shared prefix rows (not their texts).
func appendInputAuditTranscript(tx *gorm.DB, transcript *InputAuditTranscript, now int64) (bool, error) {
	var audit InputAudit
	if err := tx.Select("id").Where("user_id = ? AND content_hash = ?", transcript.UserId, transcript.ContentHash).Limit(1).Find(&audit).Error; err != nil {
		return false, err
	}
	if audit.Id == 0 {
		// The request row was not written, so neither are its items.
		return true, nil
	}
	items := transcript.Items
	var thread InputAuditThread
	prefix := 0
	// Stored threads always hold contiguous prefixes, so the newest chunk with
	// any match contains the longest one.
	for end := len(items); end > 0 && prefix == 0; end -= 500 {
		chains := make([]string, 0, 500)
		for _, item := range items[max(0, end-500):end] {
			chains = append(chains, item.Chain)
		}
		var longest sql.NullInt64
		if err := tx.Model(&InputAuditThreadItem{}).Select("MAX(seq)").Where("user_id = ? AND chain_hash IN ?", transcript.UserId, chains).Row().Scan(&longest); err != nil {
			return false, err
		}
		if !longest.Valid || longest.Int64 >= int64(len(items)) {
			continue
		}
		seq := int(longest.Int64)
		var threadIDs []int64
		if err := tx.Model(&InputAuditThreadItem{}).Where("user_id = ? AND chain_hash = ? AND seq = ?", transcript.UserId, items[seq].Chain, seq).Pluck("thread_id", &threadIDs).Error; err != nil {
			return false, err
		}
		var threads []InputAuditThread
		if err := tx.Where("id IN ?", threadIDs).Order("updated_at DESC").Order("id DESC").Find(&threads).Error; err != nil {
			return false, err
		}
		if len(threads) == 0 {
			continue
		}
		thread = threads[0]
		for _, candidate := range threads {
			if candidate.ItemCount == seq+1 {
				thread = candidate
				break
			}
		}
		prefix = seq + 1
	}
	known := 0
	for known < len(items) && items[known].Known {
		known++
	}
	// Items the sender assumed stored arrive without text. They are kept in a
	// separate thread whose new rows are never matched, so later requests that
	// carry the full text rebuild a complete conversation.
	stale := prefix < known
	if prefix == 0 || stale || (prefix < len(items) && prefix != thread.ItemCount) {
		parent := thread
		thread = InputAuditThread{UserId: transcript.UserId, CreatedAt: now, UpdatedAt: now, ParentId: parent.Id, ItemCount: prefix, StoredBytes: int64(prefix) * inputAuditThreadItemBytes, Truncated: parent.Truncated, ContextMissing: parent.ContextMissing}
		if err := tx.Create(&thread).Error; err != nil {
			return false, err
		}
		for offset := 0; offset < prefix; offset += 500 {
			var rows []InputAuditThreadItem
			if err := tx.Where("thread_id = ? AND seq >= ? AND seq < ?", parent.Id, offset, min(prefix, offset+500)).Order("seq").Find(&rows).Error; err != nil {
				return false, err
			}
			for i := range rows {
				rows[i].ThreadId = thread.Id
			}
			if len(rows) > 0 {
				if err := tx.Create(&rows).Error; err != nil {
					return false, err
				}
			}
		}
	}
	added := items[prefix:]
	type textKey struct {
		scope int
		hash  string
	}
	keys := make([]textKey, len(added))
	textIDs := make(map[textKey]int64)
	hashes := make([]string, 0, len(added))
	for i, item := range added {
		if item.Text == "" {
			continue
		}
		scope := transcript.UserId
		if item.Kind == "message" && (item.Role == "system" || item.Role == "developer") {
			scope = 0
		}
		digest := sha256.Sum256([]byte(item.Text))
		keys[i] = textKey{scope: scope, hash: hex.EncodeToString(digest[:])}
		if _, found := textIDs[keys[i]]; !found {
			textIDs[keys[i]] = 0
			hashes = append(hashes, keys[i].hash)
		}
	}
	for chunk := range slices.Chunk(hashes, 500) {
		var rows []InputAuditEvidenceText
		if err := tx.Select("id", "user_id", "hash").Where("user_id IN ? AND hash IN ?", []int{0, transcript.UserId}, chunk).Find(&rows).Error; err != nil {
			return false, err
		}
		for _, row := range rows {
			key := textKey{scope: row.UserId, hash: row.Hash}
			if _, wanted := textIDs[key]; wanted {
				textIDs[key] = row.Id
			}
		}
	}
	var created []InputAuditEvidenceText
	queued := make(map[textKey]bool)
	for i, key := range keys {
		if key.hash == "" || textIDs[key] != 0 || queued[key] {
			continue
		}
		queued[key] = true
		var compressed bytes.Buffer
		writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
		if err != nil {
			return false, err
		}
		if _, err := writer.Write([]byte(added[i].Text)); err != nil {
			return false, err
		}
		if err := writer.Close(); err != nil {
			return false, err
		}
		created = append(created, InputAuditEvidenceText{UserId: key.scope, Hash: key.hash, Body: compressed.Bytes(), StoredBytes: int64(compressed.Len())})
	}
	if len(created) > 0 {
		if err := tx.CreateInBatches(&created, 100).Error; err != nil {
			return false, err
		}
		for _, row := range created {
			textIDs[textKey{scope: row.UserId, hash: row.Hash}] = row.Id
		}
	}
	rows := make([]InputAuditThreadItem, 0, len(added))
	storedBytes := int64(0)
	for i, item := range added {
		row := InputAuditThreadItem{ThreadId: thread.Id, Seq: prefix + i, UserId: transcript.UserId, ChainHash: item.Chain, CreatedAt: now, Role: item.Role, Kind: item.Kind, Name: item.Name, CallId: item.CallId, OriginalChars: item.OriginalChars, Media: item.Media, Truncated: item.Truncated}
		if keys[i].hash != "" {
			row.TextId = textIDs[keys[i]]
		}
		if stale {
			row.ChainHash = ""
		}
		rows = append(rows, row)
		storedBytes += inputAuditThreadItemBytes + int64(len(item.Name)+len(item.CallId))
	}
	if len(rows) > 0 {
		if err := tx.CreateInBatches(&rows, 500).Error; err != nil {
			return false, err
		}
	}
	updates := map[string]any{"updated_at": now, "item_count": max(thread.ItemCount, len(items)), "stored_bytes": thread.StoredBytes + storedBytes, "truncated": thread.Truncated || transcript.Truncated, "context_missing": thread.ContextMissing || transcript.ContextMissing}
	if len(transcript.Tools) > 0 {
		encoded, err := common.Marshal(transcript.Tools)
		if err != nil {
			return false, err
		}
		updates["tools"] = string(encoded)
	}
	if err := tx.Model(&InputAuditThread{}).Where("id = ?", thread.Id).Updates(updates).Error; err != nil {
		return false, err
	}
	err := tx.Model(&InputAudit{}).Where("id = ?", audit.Id).Updates(map[string]any{"thread_id": thread.Id, "item_count": len(items), "new_items": len(added), "evidence_state": "retained"}).Error
	return stale, err
}

// pruneInputAuditEvidence enforces retention and the shared storage budget on
// conversation threads, their texts and legacy per-request evidence.
func pruneInputAuditEvidence(tx *gorm.DB, settings InputAuditSettings, cutoff int64) (bool, error) {
	evicted := false
	for {
		var ids []int64
		if err := tx.Model(&InputAuditThread{}).Where("updated_at < ?", cutoff).Order("updated_at").Limit(500).Pluck("id", &ids).Error; err != nil {
			return evicted, err
		}
		if len(ids) == 0 {
			break
		}
		if err := deleteInputAuditThreads(tx, ids, "expired"); err != nil {
			return evicted, err
		}
		evicted = true
	}
	for {
		var ids []int64
		if err := tx.Model(&InputAuditEvidence{}).Where("created_at < ?", cutoff).Limit(1000).Pluck("id", &ids).Error; err != nil {
			return evicted, err
		}
		if len(ids) == 0 {
			break
		}
		if err := DeleteInputAuditEvidence(tx, ids, "expired"); err != nil {
			return evicted, err
		}
	}
	for {
		var threads, legacy, threadBytes, legacyBytes, textBytes int64
		if err := tx.Model(&InputAuditThread{}).Count(&threads).Error; err != nil {
			return evicted, err
		}
		if err := tx.Model(&InputAuditEvidence{}).Count(&legacy).Error; err != nil {
			return evicted, err
		}
		if err := tx.Model(&InputAuditThread{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&threadBytes).Error; err != nil {
			return evicted, err
		}
		if err := tx.Model(&InputAuditEvidence{}).Select("COALESCE(SUM(body_bytes), 0)").Scan(&legacyBytes).Error; err != nil {
			return evicted, err
		}
		if err := tx.Model(&InputAuditEvidenceText{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&textBytes).Error; err != nil {
			return evicted, err
		}
		records := threads + legacy
		if records <= int64(settings.EvidenceMaxRecords) && threadBytes+legacyBytes+textBytes <= settings.EvidenceMaxBytes {
			return evicted, nil
		}
		// Amortize large budget reductions instead of rescanning totals once
		// per evicted conversation.
		amount := int(min(1000, max(32, records-int64(settings.EvidenceMaxRecords))))
		var ids []int64
		if legacy > 0 {
			if err := tx.Model(&InputAuditEvidence{}).Order("created_at").Order("id").Limit(amount).Pluck("id", &ids).Error; err != nil {
				return evicted, err
			}
			if err := DeleteInputAuditEvidence(tx, ids, "capacity_evicted"); err != nil {
				return evicted, err
			}
			continue
		}
		if err := tx.Model(&InputAuditThread{}).Order("updated_at").Order("id").Limit(amount).Pluck("id", &ids).Error; err != nil {
			return evicted, err
		}
		if len(ids) == 0 {
			return evicted, nil
		}
		if err := deleteInputAuditThreads(tx, ids, "capacity_evicted"); err != nil {
			return evicted, err
		}
		evicted = true
	}
}

// releaseInputAuditThreads deletes threads that no retained request references.
func releaseInputAuditThreads(tx *gorm.DB, ids []int64) error {
	ids = slices.DeleteFunc(ids, func(id int64) bool { return id == 0 })
	slices.Sort(ids)
	for chunk := range slices.Chunk(slices.Compact(ids), 500) {
		var orphaned []int64
		referenced := tx.Model(&InputAudit{}).Select("1").Where("input_audits.thread_id = input_audit_threads.id")
		if err := tx.Model(&InputAuditThread{}).Where("id IN ?", chunk).Where("NOT EXISTS (?)", referenced).Pluck("id", &orphaned).Error; err != nil {
			return err
		}
		if err := deleteInputAuditThreads(tx, orphaned, ""); err != nil {
			return err
		}
	}
	return nil
}

// deleteInputAuditThreads keeps request rows; a non-empty reason records why
// their transcript is no longer available. Case snapshots hold their own copy.
func deleteInputAuditThreads(tx *gorm.DB, ids []int64, reason string) error {
	if len(ids) == 0 {
		return nil
	}
	if reason != "" {
		if err := tx.Model(&InputAudit{}).Where("thread_id IN ?", ids).Updates(map[string]any{"evidence_state": reason, "thread_id": 0}).Error; err != nil {
			return err
		}
	}
	var textIDs []int64
	if err := tx.Model(&InputAuditThreadItem{}).Distinct().Where("thread_id IN ? AND text_id > 0", ids).Pluck("text_id", &textIDs).Error; err != nil {
		return err
	}
	if err := tx.Where("thread_id IN ?", ids).Delete(&InputAuditThreadItem{}).Error; err != nil {
		return err
	}
	if err := tx.Where("id IN ?", ids).Delete(&InputAuditThread{}).Error; err != nil {
		return err
	}
	return collectInputAuditTexts(tx, textIDs)
}

// collectInputAuditTexts removes candidate texts that no thread item or legacy
// manifest references any more. Call it in the transaction releasing them.
func collectInputAuditTexts(tx *gorm.DB, candidates []int64) error {
	for chunk := range slices.Chunk(candidates, 500) {
		threadRefs := tx.Model(&InputAuditThreadItem{}).Select("text_id").Where("text_id IN ?", chunk)
		legacyRefs := tx.Model(&InputAuditEvidenceTextRef{}).Select("text_id").Where("text_id IN ?", chunk)
		if err := tx.Where("id IN ?", chunk).Where("id NOT IN (?)", threadRefs).Where("id NOT IN (?)", legacyRefs).Delete(&InputAuditEvidenceText{}).Error; err != nil {
			return err
		}
	}
	return nil
}

func loadInputAuditTexts(db *gorm.DB, userID int, ids []int64) (map[int64]string, error) {
	ids = slices.DeleteFunc(slices.Clone(ids), func(id int64) bool { return id == 0 })
	slices.Sort(ids)
	texts := make(map[int64]string, len(ids))
	for chunk := range slices.Chunk(slices.Compact(ids), 200) {
		var rows []InputAuditEvidenceText
		if err := db.Where("id IN ? AND user_id IN ?", chunk, []int{0, userID}).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			text, err := decodeInputAuditText(row)
			if err != nil {
				return nil, err
			}
			texts[row.Id] = text
		}
	}
	return texts, nil
}

// ReadInputAuditThreadItems returns stored items in [offset, offset+limit).
func ReadInputAuditThreadItems(db *gorm.DB, thread InputAuditThread, offset, limit int) ([]InputAuditTranscriptEntry, error) {
	var rows []InputAuditThreadItem
	if err := db.Where("thread_id = ? AND seq >= ? AND seq < ?", thread.Id, offset, offset+limit).Order("seq").Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.TextId)
	}
	texts, err := loadInputAuditTexts(db, thread.UserId, ids)
	if err != nil {
		return nil, err
	}
	entries := make([]InputAuditTranscriptEntry, 0, len(rows))
	for _, row := range rows {
		text, found := texts[row.TextId]
		entries = append(entries, InputAuditTranscriptEntry{Seq: row.Seq, Role: row.Role, Kind: row.Kind, Name: row.Name, CallId: row.CallId, Text: text, OriginalChars: row.OriginalChars, Media: row.Media, Truncated: row.Truncated, Unavailable: row.OriginalChars > 0 && !found, CreatedAt: row.CreatedAt})
	}
	return entries, nil
}

// InputAuditThreadOutline lists the thread's user messages (newest 300) with
// short previews and the number of requests issued for each of them.
func InputAuditThreadOutline(db *gorm.DB, thread InputAuditThread) ([]InputAuditOutlineEntry, error) {
	var rows []InputAuditThreadItem
	if err := db.Where("thread_id = ? AND role = ? AND kind = ?", thread.Id, "user", "message").Order("seq DESC").Limit(300).Find(&rows).Error; err != nil {
		return nil, err
	}
	slices.Reverse(rows)
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.TextId)
	}
	texts, err := loadInputAuditTexts(db, thread.UserId, ids)
	if err != nil {
		return nil, err
	}
	var counts []struct {
		TurnItem int
		Requests int
	}
	if err := db.Model(&InputAudit{}).Select("turn_item, COUNT(*) AS requests").Where("thread_id = ?", thread.Id).Group("turn_item").Scan(&counts).Error; err != nil {
		return nil, err
	}
	requests := make(map[int]int, len(counts))
	for _, count := range counts {
		requests[count.TurnItem-1] = count.Requests
	}
	entries := make([]InputAuditOutlineEntry, 0, len(rows))
	for _, row := range rows {
		text := texts[row.TextId]
		if utf8.RuneCountInString(text) > 240 {
			text = string([]rune(text)[:240]) + "…"
		}
		entries = append(entries, InputAuditOutlineEntry{Seq: row.Seq, Text: text, Requests: requests[row.Seq], CreatedAt: row.CreatedAt})
	}
	return entries, nil
}

// InputAuditRequestDocument projects the conversation a request submitted
// into a citation document. User messages are retained first, then the newest
// other items within maxChars; requestOnly limits other items to the ones the
// request added. Legacy evidence and the preview remain fallbacks.
func InputAuditRequestDocument(db *gorm.DB, audit InputAudit, maxChars int, requestOnly bool) (InputAuditEvidenceDocument, error) {
	fallback := InputAuditEvidenceDocument{Source: "legacy_preview", Scope: "retained_user_text", Messages: []InputAuditEvidenceMessage{{Role: "user", Text: audit.Content}}, Truncated: audit.Truncated, ContextMissing: true, Omitted: []string{"original_context_unavailable"}}
	var thread InputAuditThread
	if audit.ThreadId > 0 {
		if err := db.Where("id = ? AND user_id = ?", audit.ThreadId, audit.UserId).Limit(1).Find(&thread).Error; err != nil {
			return fallback, err
		}
	}
	if thread.Id == 0 {
		if audit.RequestId == "" {
			return fallback, nil
		}
		var evidence InputAuditEvidence
		if err := db.Where("user_id = ? AND request_id = ?", audit.UserId, audit.RequestId).Limit(1).Find(&evidence).Error; err != nil || evidence.Id == 0 {
			return fallback, err
		}
		document, err := ReadInputAuditEvidence(db, evidence)
		if err != nil {
			return fallback, err
		}
		if !slices.ContainsFunc(document.Messages, func(message InputAuditEvidenceMessage) bool { return strings.TrimSpace(message.Text) != "" }) {
			return fallback, nil
		}
		return document, nil
	}
	var rows []InputAuditThreadItem
	if err := db.Where("thread_id = ? AND seq < ?", thread.Id, audit.ItemCount).Order("seq").Find(&rows).Error; err != nil {
		return fallback, err
	}
	if len(rows) == 0 {
		return fallback, nil
	}
	start := audit.ItemCount - audit.NewItems
	order := make([]int, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Role == "user" && rows[i].Kind == "message" {
			order = append(order, i)
		}
	}
	for i := len(rows) - 1; i >= 0; i-- {
		if (rows[i].Role != "user" || rows[i].Kind != "message") && (!requestOnly || rows[i].Seq >= start) {
			order = append(order, i)
		}
	}
	document := InputAuditEvidenceDocument{Version: 3, Source: "client_request", Scope: "conversation_transcript", Messages: []InputAuditEvidenceMessage{}, Truncated: thread.Truncated, ContextMissing: thread.ContextMissing, Omitted: []string{}}
	if requestOnly {
		document.Scope = "request_items"
	}
	omit := func(reason string) {
		document.Truncated = true
		if !slices.Contains(document.Omitted, reason) {
			document.Omitted = append(document.Omitted, reason)
		}
	}
	selected := make(map[int]string, len(order))
	remaining := maxChars
	for batch := range slices.Chunk(order, 100) {
		if remaining <= 0 {
			omit("history_budget")
			break
		}
		ids := make([]int64, 0, len(batch))
		for _, index := range batch {
			ids = append(ids, rows[index].TextId)
		}
		texts, err := loadInputAuditTexts(db, audit.UserId, ids)
		if err != nil {
			return fallback, err
		}
		for _, index := range batch {
			text := texts[rows[index].TextId]
			chars := utf8.RuneCountInString(text)
			if chars > remaining {
				omit("history_budget")
				continue
			}
			remaining -= chars
			selected[index] = text
		}
	}
	for i, row := range rows {
		text, ok := selected[i]
		if !ok {
			continue
		}
		if row.OriginalChars > 0 && text == "" {
			omit("text_unavailable")
		}
		if row.Media > 0 {
			omit("media_not_retained")
		}
		// Long tool output is always excerpted; only conversational text
		// excerpts make the document incomplete.
		if row.Truncated && (row.Kind == "message" || row.Kind == "context") {
			document.Truncated = true
		}
		document.Messages = append(document.Messages, InputAuditEvidenceMessage{Index: len(document.Messages), Role: row.Role, Text: text, Kind: row.Kind, Path: fmt.Sprintf("/items/%d", row.Seq), CallID: row.CallId, Name: row.Name, OriginalChars: row.OriginalChars, Truncated: row.Truncated})
	}
	slices.Sort(document.Omitted)
	return document, nil
}

// SearchInputAuditThread returns the sequence numbers of stored items whose
// text or tool name contains query, ignoring case, in conversation order. At
// most limit numbers are returned; the flag reports that more items matched.
func SearchInputAuditThread(db *gorm.DB, thread InputAuditThread, query string, limit int) ([]int, bool, error) {
	needle := strings.ToLower(query)
	seqs := []int{}
	// Shared prompts recur in many items; each stored text is decoded once.
	matched := make(map[int64]bool)
	for from := 0; from < thread.ItemCount; from += 500 {
		var rows []InputAuditThreadItem
		if err := db.Select("seq", "text_id", "name").Where("thread_id = ? AND seq >= ? AND seq < ?", thread.Id, from, from+500).Order("seq").Find(&rows).Error; err != nil {
			return nil, false, err
		}
		ids := make([]int64, 0, len(rows))
		for _, row := range rows {
			if _, known := matched[row.TextId]; !known {
				ids = append(ids, row.TextId)
			}
		}
		texts, err := loadInputAuditTexts(db, thread.UserId, ids)
		if err != nil {
			return nil, false, err
		}
		for id, text := range texts {
			matched[id] = strings.Contains(strings.ToLower(text), needle)
		}
		for _, row := range rows {
			if !matched[row.TextId] && !strings.Contains(strings.ToLower(row.Name), needle) {
				continue
			}
			if len(seqs) == limit {
				return seqs, true, nil
			}
			seqs = append(seqs, row.Seq)
		}
	}
	return seqs, false, nil
}

// summarizeInputAuditTurns attaches each turn's activity: the tool calls and
// the latest assistant message between its user message and the next one.
// Turns with many tool calls are scanned up to a bound and flagged as more.
func summarizeInputAuditTurns(db *gorm.DB, turns []InputAuditTurn) error {
	const scanLimit = 1000
	replyIDs := make([]int64, len(turns))
	userReplies := make(map[int][]int64)
	for i := range turns {
		turn := &turns[i]
		if turn.ThreadId == 0 || turn.TurnItem < 1 {
			continue
		}
		var rows []InputAuditThreadItem
		if err := db.Select("seq", "role", "kind", "name", "text_id").Where("thread_id = ? AND seq >= ? AND (kind = ? OR (kind = ? AND role IN ?))", turn.ThreadId, turn.TurnItem, "tool_call", "message", []string{"user", "assistant"}).Order("seq").Limit(scanLimit + 1).Find(&rows).Error; err != nil {
			return err
		}
		activity := &InputAuditTurnActivity{Tools: []string{}}
		for j, row := range rows {
			if j == scanLimit {
				activity.More = true
				break
			}
			if row.Role == "user" && row.Kind == "message" {
				break
			}
			if row.Kind != "tool_call" {
				if row.TextId > 0 {
					replyIDs[i] = row.TextId
				}
				continue
			}
			activity.ToolCalls++
			if row.Name != "" && !slices.Contains(activity.Tools, row.Name) && len(activity.Tools) < 8 {
				activity.Tools = append(activity.Tools, row.Name)
			}
		}
		turn.Activity = activity
		if replyIDs[i] > 0 {
			userReplies[turn.UserId] = append(userReplies[turn.UserId], replyIDs[i])
		}
	}
	for userID, ids := range userReplies {
		texts, err := loadInputAuditTexts(db, userID, ids)
		if err != nil {
			return err
		}
		for i, id := range replyIDs {
			if id == 0 || turns[i].UserId != userID {
				continue
			}
			reply := texts[id]
			if utf8.RuneCountInString(reply) > 240 {
				reply = string([]rune(reply)[:240]) + "…"
			}
			turns[i].Activity.Reply = reply
		}
	}
	return nil
}
