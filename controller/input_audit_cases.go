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

func GetInputAuditEvidence(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("audit_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit ID"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var audit model.InputAudit
	if err := model.DB.WithContext(ctx).First(&audit, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Audit record not found"})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	settings, err := model.LoadInputAuditSettings(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var evidence model.InputAuditEvidence
	err = model.DB.WithContext(ctx).Where("request_id = ? AND user_id = ? AND content_hash = ? AND created_at >= ?", audit.RequestId, audit.UserId, audit.ContentHash, time.Now().Unix()-int64(settings.RetentionDays)*86400).First(&evidence).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || audit.RequestId == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"available": false, "complete": false, "reason": audit.EvidenceState}})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	document, err := model.ReadInputAuditEvidence(model.DB.WithContext(ctx), evidence)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"available": true, "complete": document.Complete(), "evidence": evidence, "document": document}})
}

func GetInputAuditCases(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	query := model.DB.WithContext(ctx).Model(&model.InputAuditCase{}).Where("expires_at > ?", time.Now().Unix())
	for _, key := range []string{"audit_id", "user_id"} {
		if value := c.Query(key); value != "" {
			id, err := strconv.ParseInt(value, 10, 64)
			if err != nil || id < 1 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit filters"})
				return
			}
			query = query.Where(key+" = ?", id)
		}
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
