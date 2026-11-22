package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetInputAuditTranscript returns a window of the conversation a request
// belongs to, with the request's own items marked and the other requests
// issued for the same user message, so one turn can be read in context.
func GetInputAuditTranscript(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("audit_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit ID"})
		return
	}
	offset, limit := -1, 200
	for _, value := range []struct {
		key    string
		target *int
		max    int
	}{{"offset", &offset, 1 << 20}, {"limit", &limit, 500}} {
		text := c.Query(value.key)
		if text == "" {
			continue
		}
		number, err := strconv.Atoi(text)
		if err != nil || number < 0 || number > value.max || (value.key == "limit" && number < 1) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid transcript window"})
			return
		}
		*value.target = number
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	var audit model.InputAudit
	if err := db.First(&audit, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Audit record not found"})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	var turnTotal int64
	turnRequests := []model.InputAudit{}
	turnQuery := db.Model(&model.InputAudit{}).Where("user_id = ? AND turn_key = ?", audit.UserId, audit.TurnKey)
	if err := turnQuery.Session(&gorm.Session{}).Count(&turnTotal).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := turnQuery.Session(&gorm.Session{}).Select("id", "created_at", "request_id", "model", "route", "thread_id", "item_count", "new_items", "evidence_state").Order("id DESC").Limit(50).Find(&turnRequests).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	data := gin.H{"request": audit, "reason": audit.EvidenceState, "turn_seq": audit.TurnItem - 1, "turn_requests": turnRequests, "turn_request_count": turnTotal, "outline": []model.InputAuditOutlineEntry{}}
	var thread model.InputAuditThread
	if audit.ThreadId > 0 {
		if err := db.Where("id = ? AND user_id = ?", audit.ThreadId, audit.UserId).Limit(1).Find(&thread).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if thread.Id > 0 {
		tools := []string{}
		if thread.Tools != "" {
			if err := common.UnmarshalJsonStr(thread.Tools, &tools); err != nil {
				common.ApiError(c, err)
				return
			}
		}
		var stats struct {
			Requests int64
			FirstAt  int64
			LastAt   int64
		}
		if err := db.Model(&model.InputAudit{}).Select("COUNT(*) AS requests, MIN(created_at) AS first_at, MAX(created_at) AS last_at").Where("thread_id = ?", thread.Id).Scan(&stats).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		outline, err := model.InputAuditThreadOutline(db, thread)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		// By default the window starts at the previous user message, so the
		// exchange that led to this one is readable without paging back.
		if offset < 0 {
			turnSeq := audit.TurnItem - 1
			offset = max(0, turnSeq-150)
			for _, entry := range outline {
				if entry.Seq < turnSeq {
					offset = max(offset, entry.Seq)
				}
			}
		}
		items, err := model.ReadInputAuditThreadItems(db, thread, offset, limit)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		data["source"] = "thread"
		data["thread"] = gin.H{"id": thread.Id, "item_count": thread.ItemCount, "parent_id": thread.ParentId, "truncated": thread.Truncated, "context_missing": thread.ContextMissing, "tools": tools, "request_count": stats.Requests, "first_at": stats.FirstAt, "last_at": stats.LastAt}
		data["outline"] = outline
		data["offset"] = offset
		data["total"] = thread.ItemCount
		data["items"] = items
		data["request_range"] = gin.H{"start": max(0, audit.ItemCount-audit.NewItems), "end": audit.ItemCount}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
		return
	}
	// Requests captured before conversation threads keep their own evidence
	// document; requests without retained evidence show the saved preview.
	entries := []model.InputAuditTranscriptEntry{{Role: "user", Kind: "message", Text: audit.Content, OriginalChars: audit.ContentChars, Truncated: audit.Truncated, CreatedAt: audit.CreatedAt}}
	data["source"] = "preview"
	var evidence model.InputAuditEvidence
	if audit.RequestId != "" {
		if err := db.Where("user_id = ? AND request_id = ?", audit.UserId, audit.RequestId).Limit(1).Find(&evidence).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if evidence.Id > 0 {
		document, err := model.ReadInputAuditEvidence(db, evidence)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		data["source"] = "legacy"
		data["context_missing"] = document.ContextMissing
		entries = make([]model.InputAuditTranscriptEntry, 0, len(document.Messages))
		for i, message := range document.Messages {
			kind := message.Kind
			if kind == "" {
				kind = "message"
			}
			entries = append(entries, model.InputAuditTranscriptEntry{Seq: i, Role: message.Role, Kind: kind, Name: message.Name, CallId: message.CallID, Text: message.Text, OriginalChars: max(message.OriginalChars, utf8.RuneCountInString(message.Text)), Truncated: message.Truncated, CreatedAt: evidence.CreatedAt})
		}
	}
	offset = min(max(offset, 0), len(entries))
	data["offset"] = offset
	data["total"] = len(entries)
	data["items"] = entries[offset:min(len(entries), offset+limit)]
	data["request_range"] = gin.H{"start": 0, "end": len(entries)}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// SearchInputAuditTranscript finds the items of a request's conversation that
// contain a keyword, so reviewers can step through every occurrence, including
// items outside the loaded window.
func SearchInputAuditTranscript(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("audit_id"), 10, 64)
	query := strings.TrimSpace(c.Query("q"))
	if err != nil || id < 1 || query == "" || !utf8.ValidString(query) || utf8.RuneCountInString(query) > 256 || strings.ContainsRune(query, '\x00') {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid transcript search"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	var audit model.InputAudit
	if err := db.First(&audit, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Audit record not found"})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	const limit = 200
	var thread model.InputAuditThread
	if audit.ThreadId > 0 {
		if err := db.Where("id = ? AND user_id = ?", audit.ThreadId, audit.UserId).Limit(1).Find(&thread).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if thread.Id > 0 {
		seqs, more, err := model.SearchInputAuditThread(db, thread, query, limit)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"seqs": seqs, "more": more}})
		return
	}
	// Without a thread the transcript is the legacy document or the preview.
	texts := []string{audit.Content}
	var evidence model.InputAuditEvidence
	if audit.RequestId != "" {
		if err := db.Where("user_id = ? AND request_id = ?", audit.UserId, audit.RequestId).Limit(1).Find(&evidence).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if evidence.Id > 0 {
		document, err := model.ReadInputAuditEvidence(db, evidence)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		texts = texts[:0]
		for _, message := range document.Messages {
			texts = append(texts, message.Name+"\n"+message.Text)
		}
	}
	needle := strings.ToLower(query)
	seqs := []int{}
	for i, text := range texts {
		if !strings.Contains(strings.ToLower(text), needle) {
			continue
		}
		if len(seqs) == limit {
			c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"seqs": seqs, "more": true}})
			return
		}
		seqs = append(seqs, i)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"seqs": seqs, "more": false}})
}

func GetInputAuditCases(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	query := model.DB.WithContext(ctx).Model(&model.InputAuditCase{}).Where("expires_at > ?", time.Now().Unix())
	for _, key := range []string{"audit_id", "user_id", "turn_of"} {
		value := c.Query(key)
		if value == "" {
			continue
		}
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit filters"})
			return
		}
		if key != "turn_of" {
			query = query.Where(key+" = ?", id)
			continue
		}
		// A case opened on any request of the same user message belongs to
		// that message.
		var audit model.InputAudit
		if err := model.DB.WithContext(ctx).Select("id", "user_id", "turn_key").Where("id = ?", id).Limit(1).Find(&audit).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if audit.Id == 0 || audit.TurnKey == "" {
			query = query.Where("audit_id = ?", id)
			continue
		}
		query = query.Where("audit_id IN (?)", model.DB.WithContext(ctx).Model(&model.InputAudit{}).Select("id").Where("user_id = ? AND turn_key = ?", audit.UserId, audit.TurnKey))
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 100000 || page.PageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid pagination"})
		return
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	rows := []model.InputAuditCase{}
	if err := query.Omit("snapshot").Order("updated_at DESC").Order("id DESC").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
}

func GetInputAuditCase(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("case_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit case ID"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var review model.InputAuditCase
	if err := model.DB.WithContext(ctx).Where("expires_at > ?", time.Now().Unix()).First(&review, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Audit case not found"})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	snapshot, err := model.InputAuditCaseSnapshotOf(review)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	decisions := []model.InputAuditDecision{}
	if err := model.DB.WithContext(ctx).Where("case_id = ?", id).Order("version").Find(&decisions).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	history := make([]gin.H, 0, len(decisions))
	for _, decision := range decisions {
		var references []model.InputAuditEvidenceReference
		if err := common.UnmarshalJsonStr(decision.References, &references); err != nil {
			common.ApiError(c, err)
			return
		}
		history = append(history, gin.H{"id": decision.Id, "created_at": decision.CreatedAt, "created_by": decision.CreatedBy, "version": decision.Version, "status": decision.Status, "category": decision.Category, "reason": decision.Reason, "references": references})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"case": review, "snapshot": snapshot, "complete": snapshot.Document.Complete(), "reviewable": snapshot.Document.Reviewable(), "decisions": history}})
}

func CreateInputAuditCase(c *gin.Context) {
	var request struct {
		AuditID int64  `json:"audit_id"`
		Reason  string `json:"reason"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 8192), &request); err != nil || request.AuditID < 1 || !utf8.ValidString(request.Reason) || strings.TrimSpace(request.Reason) == "" || utf8.RuneCountInString(request.Reason) > 500 || strings.ContainsRune(request.Reason, '\x00') {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit case parameters"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	review, err := model.CreateInputAuditCase(model.DB.WithContext(ctx), request.AuditID, c.GetInt("id"), strings.TrimSpace(request.Reason))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "input_audit.case_created", map[string]any{"case_id": review.Id, "audit_id": review.AuditId})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": review})
}

func DecideInputAuditCase(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("case_id"), 10, 64)
	var request struct {
		Version    int64                               `json:"version"`
		Status     string                              `json:"status"`
		Category   string                              `json:"category"`
		Reason     string                              `json:"reason"`
		References []model.InputAuditEvidenceReference `json:"references"`
	}
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit case ID"})
		return
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10), &request); err != nil || len(request.References) > 16 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit decision"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := model.DecideInputAuditCase(model.DB.WithContext(ctx), id, request.Version, c.GetInt("id"), request.Status, request.Category, strings.TrimSpace(request.Reason), request.References); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, model.ErrInputAuditConflict) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.case_decided", map[string]any{"case_id": id, "version": request.Version + 1, "status": request.Status, "category": request.Category, "references": len(request.References)})
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ExportInputAuditLabels(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 100000 || page.PageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid pagination"})
		return
	}
	query := model.DB.WithContext(ctx).Where("status IN ? AND expires_at > ?", []string{"confirmed", "dismissed"}, time.Now().Unix())
	var total int64
	if err := query.Model(&model.InputAuditCase{}).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var rows []model.InputAuditCase
	if err := query.Order("id").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, review := range rows {
		snapshot, err := model.InputAuditCaseSnapshotOf(review)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if !snapshot.Document.Complete() {
			continue
		}
		items = append(items, gin.H{"case_id": review.Id, "user_id": review.UserId, "received_at": snapshot.Audit.CreatedAt, "document_hash": snapshot.DocumentHash, "messages": snapshot.Document.Messages, "labels": map[string]bool{review.Category: review.Status == "confirmed"}, "review_version": review.Version})
	}
	c.Header("Content-Disposition", "attachment; filename=input-audit-labels.json")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total_cases": total, "page": page.Page, "page_size": page.PageSize}})
}

func GetInputAuditAllowlistHistory(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	query := model.DB.WithContext(ctx).Order("version DESC").Limit(20)
	if value := c.Query("version"); value != "" {
		version, err := strconv.ParseInt(value, 10, 64)
		if err != nil || version < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid allowlist version"})
			return
		}
		query = query.Where("version = ?", version)
	}
	var rows []model.InputAuditPolicyRevision
	if err := query.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		var policy any
		if err := common.UnmarshalJsonStr(row.Policy, &policy); err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, gin.H{"created_at": row.CreatedAt, "policy": policy})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}
