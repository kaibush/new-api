package controller

import (
	"context"
	"net/http"
	"os"
	"slices"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetInputAuditReviewSettings(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	s, err := model.LoadInputAuditReviewSettings(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	configured := s.APIKey != ""
	s.APIKey = ""
	c.JSON(http.StatusOK, gin.H{"success": true, "data": struct {
		model.InputAuditReviewSettings
		KeyConfigured       bool   `json:"key_configured"`
		DefaultSystemPrompt string `json:"default_system_prompt"`
	}{s, configured, model.DefaultInputAuditReviewSystemPrompt}})
}
func UpdateInputAuditReviewSettings(c *gin.Context) {
	var request struct {
		model.InputAuditReviewSettings
		ClearAPIKey bool `json:"clear_api_key"`
	}
	request.InputAuditReviewSettings = model.DefaultInputAuditReviewSettings()
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 40000), &request); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid model review settings"})
		return
	}
	s := request.InputAuditReviewSettings
	if err := s.Validate(); err != nil {
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	previous, err := model.LoadInputAuditReviewSettings(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if request.ClearAPIKey {
		s.APIKey = ""
		s.KeyEnv = ""
	} else if s.APIKey == "" {
		s.APIKey = previous.APIKey
		s.KeyEnv = previous.KeyEnv
	} else {
		s.KeyEnv = ""
	}
	if err := model.SaveInputAuditReviewSettings(model.DB.WithContext(ctx), s); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "input_audit.model_settings", map[string]any{"enabled": s.Enabled, "automatic": s.Automatic, "model": s.Model})
	c.JSON(200, gin.H{"success": true})
}
func CreateInputAuditReviewJob(c *gin.Context) {
	var request struct {
		Mode   string `json:"mode"`
		UserID int    `json:"user_id"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &request); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid model review scope"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	if _, err := model.LoadInputAuditReviewSettings(db); err != nil {
		common.ApiError(c, err)
		return
	}
	job, err := model.CreateInputAuditReviewJob(db, request.Mode, request.UserID, c.GetInt("id"), false)
	if err != nil {
		c.JSON(409, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.model_run", map[string]any{"job_id": job.Id, "mode": job.Mode, "user_id": job.UserId})
	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": job})
}
func CancelInputAuditReviewJob(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("job_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid job ID"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	update := model.DB.WithContext(ctx).Model(&model.InputAuditReviewJob{}).Where("id = ? AND status IN ?", id, []string{"pending", "running"}).Updates(map[string]any{"status": "cancelled", "updated_at": time.Now().Unix()})
	if update.Error != nil {
		common.ApiError(c, update.Error)
		return
	}
	recordManageAudit(c, "input_audit.model_cancel", map[string]any{"job_id": id})
	c.JSON(200, gin.H{"success": true})
}
func GetInputAuditReviewJobs(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	rows := []model.InputAuditReviewJob{}
	if err := model.DB.WithContext(ctx).Order("id DESC").Limit(20).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": rows})
}
func GetInputAuditReviewResults(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	q := model.DB.WithContext(ctx).Model(&model.InputAuditReviewResult{})
	for _, key := range []string{"job_id", "user_id"} {
		if value := c.Query(key); value != "" {
			id, err := strconv.ParseInt(value, 10, 64)
			if err != nil || id < 1 {
				c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
				return
			}
			q = q.Where(key+" = ?", id)
		}
	}
	if status := c.Query("status"); status != "" {
		if !slices.Contains([]string{"safe", "review", "insufficient_evidence", "failed"}, status) {
			c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
			return
		}
		q = q.Where("status = ?", status)
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 100000 || page.PageSize < 1 || page.PageSize > 100 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid pagination"})
		return
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	rows := []model.InputAuditReviewResult{}
	if err := q.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
}

func GetInputAuditReviewSummary(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	var pending int64
	if err := db.Model(&model.InputAudit{}).Where("review_attempted_at IS NULL OR review_attempted_at = ?", 0).Count(&pending).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"unreviewed": pending}})
}

func GetInputAuditReviewCredential(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if c.GetInt("role") != common.RoleRootUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": service.ErrVerificationForbidden.Error()})
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeInputAuditKeyRead}) == nil {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	s, err := model.LoadInputAuditReviewSettings(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	key := s.APIKey
	if key == "" && s.KeyEnv != "" {
		key = os.Getenv(s.KeyEnv)
	}
	recordManageAudit(c, "input_audit.credentials_view", nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"api_key": key}})
}
