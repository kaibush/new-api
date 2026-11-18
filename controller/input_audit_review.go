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
	if err := model.DB.WithContext(ctx).Where("status IN ?", []string{"pending", "running"}).Order("id").Limit(100).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var history []model.InputAuditReviewJob
	if err := model.DB.WithContext(ctx).Where("status NOT IN ?", []string{"pending", "running"}).Order("id DESC").Limit(1000).Find(&history).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	rows = append(rows, history...)
	type jobResponse struct {
		model.InputAuditReviewJob
		Concurrency            int `json:"concurrency"`
		RequestIntervalSeconds int `json:"request_interval_seconds"`
	}
	response := make([]jobResponse, 0, len(rows))
	for _, row := range rows {
		settings := model.DefaultInputAuditReviewSettings()
		settings.Concurrency = 1
		if err := common.UnmarshalJsonStr(row.Settings, &settings); err != nil {
			common.ApiError(c, err)
			return
		}
		response = append(response, jobResponse{row, settings.Concurrency, settings.RequestIntervalSeconds})
	}
	c.JSON(200, gin.H{"success": true, "data": response})
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

// Count the latest retained verdict for each message so retries and re-review
// do not inflate user risk counts. A job filter scopes both selection and totals.
func GetInputAuditReviewUsers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	latest := db.Model(&model.InputAuditReviewResult{}).Select("MAX(id)").Group("audit_id")
	for _, key := range []string{"job_id", "user_id"} {
		if value := c.Query(key); value != "" {
			id, err := strconv.ParseInt(value, 10, 64)
			if err != nil || id < 1 {
				c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
				return
			}
			latest = latest.Where(key+" = ?", id)
		}
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 100000 || page.PageSize < 1 || page.PageSize > 100 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid pagination"})
		return
	}
	var groups []struct {
		UserId   int
		Status   string
		Category string
		Count    int64
	}
	if err := db.Model(&model.InputAuditReviewResult{}).Select("user_id, status, category, COUNT(*) AS count").Where("id IN (?)", latest).Group("user_id, status, category").Scan(&groups).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	type userReviewSummary struct {
		UserId       int              `json:"user_id"`
		Reviewed     int64            `json:"reviewed"`
		Suspected    int64            `json:"suspected"`
		Insufficient int64            `json:"insufficient"`
		Failed       int64            `json:"failed"`
		Categories   map[string]int64 `json:"categories"`
	}
	users := make(map[int]*userReviewSummary)
	var reviewed, suspected, affected int64
	for _, group := range groups {
		row := users[group.UserId]
		if row == nil {
			row = &userReviewSummary{UserId: group.UserId, Categories: make(map[string]int64)}
			users[group.UserId] = row
		}
		row.Reviewed += group.Count
		reviewed += group.Count
		switch group.Status {
		case "review":
			if row.Suspected == 0 {
				affected++
			}
			row.Suspected += group.Count
			suspected += group.Count
			row.Categories[group.Category] += group.Count
		case "insufficient_evidence":
			row.Insufficient += group.Count
		case "failed":
			row.Failed += group.Count
		}
	}
	rows := make([]userReviewSummary, 0, len(users))
	for _, row := range users {
		rows = append(rows, *row)
	}
	slices.SortFunc(rows, func(a, b userReviewSummary) int {
		if a.Suspected > b.Suspected {
			return -1
		}
		if a.Suspected < b.Suspected {
			return 1
		}
		if a.UserId < b.UserId {
			return -1
		}
		if a.UserId > b.UserId {
			return 1
		}
		return 0
	})
	start := min(page.GetStartIdx(), len(rows))
	end := min(start+page.PageSize, len(rows))
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows[start:end], "total": len(rows), "reviewed": reviewed, "suspected": suspected, "affected_users": affected}})
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

// Queued jobs may change scope and pacing before dispatch. The singleton guard
// serializes edits with claims so settings cannot change under a running worker.
func UpdateInputAuditReviewJob(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("job_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid job ID"})
		return
	}
	var request struct {
		Mode                   string `json:"mode"`
		UserID                 int    `json:"user_id"`
		Concurrency            int    `json:"concurrency"`
		RequestIntervalSeconds int    `json:"request_interval_seconds"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 2048), &request); err != nil || !slices.Contains([]string{"incremental", "all", "failed"}, request.Mode) || request.UserID < 0 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid model review scope"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	err = model.UpdateQueuedInputAuditReviewJob(model.DB.WithContext(ctx), id, request.Mode, request.UserID, request.Concurrency, request.RequestIntervalSeconds)
	if err != nil {
		c.JSON(409, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.model_job_update", map[string]any{"job_id": id, "mode": request.Mode, "user_id": request.UserID})
	c.JSON(200, gin.H{"success": true})
}

func ClearInputAuditReviewQueue(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	count, err := model.CancelInputAuditReviewQueue(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "input_audit.model_queue_clear", map[string]any{"count": count})
	c.JSON(200, gin.H{"success": true})
}

func PauseInputAuditReviewQueue(c *gin.Context) {
	var request struct {
		Paused *bool `json:"paused"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &request); err != nil || request.Paused == nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid model review settings"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := model.SetInputAuditReviewQueuePaused(model.DB.WithContext(ctx), *request.Paused); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "input_audit.model_queue_pause", map[string]any{"paused": *request.Paused})
	c.JSON(200, gin.H{"success": true})
}

func DeleteInputAuditReviewJobs(c *gin.Context) {
	var request struct {
		IDs     []int64 `json:"ids"`
		Stop    bool    `json:"stop"`
		History bool    `json:"history"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil || (len(request.IDs) == 0 && !request.History) || (request.History && len(request.IDs) > 0) || len(request.IDs) > 100 || slices.ContainsFunc(request.IDs, func(id int64) bool { return id < 1 }) {
		c.JSON(400, gin.H{"success": false, "message": "Invalid job ID"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if request.History {
		var rows []model.InputAuditReviewJob
		if err := model.DB.WithContext(ctx).Select("id").Where("status NOT IN ? AND lease_until <= ?", []string{"pending", "running"}, time.Now().Unix()).Limit(1000).Find(&rows).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		for _, row := range rows {
			request.IDs = append(request.IDs, row.Id)
		}
		if len(request.IDs) == 0 {
			c.JSON(200, gin.H{"success": true})
			return
		}
	}
	if request.Stop {
		update := model.DB.WithContext(ctx).Model(&model.InputAuditReviewJob{}).Where("id IN ? AND status IN ?", request.IDs, []string{"pending", "running"}).Updates(map[string]any{"status": "cancelled", "updated_at": time.Now().Unix()})
		if update.Error != nil {
			common.ApiError(c, update.Error)
			return
		}
		for {
			var active int64
			if err := model.DB.WithContext(ctx).Model(&model.InputAuditReviewJob{}).Where("id IN ? AND lease_until > ?", request.IDs, time.Now().Unix()).Count(&active).Error; err != nil {
				common.ApiError(c, err)
				return
			}
			if active == 0 {
				break
			}
			timer := time.NewTimer(100 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				c.JSON(409, gin.H{"success": false, "message": "Stop active review jobs before deleting them"})
				return
			case <-timer.C:
			}
		}
	}
	if err := model.DeleteInputAuditReviewJobs(model.DB.WithContext(ctx), request.IDs); err != nil {
		c.JSON(409, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.model_jobs_delete", map[string]any{"job_ids": request.IDs})
	c.JSON(200, gin.H{"success": true})
}

func DeleteInputAuditReviewResults(c *gin.Context) {
	var request struct {
		IDs    []int64 `json:"ids"`
		All    bool    `json:"all"`
		JobID  int64   `json:"job_id"`
		UserID int     `json:"user_id"`
		Status string  `json:"status"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil || len(request.IDs) > 100 || (!request.All && len(request.IDs) == 0) || (request.All && len(request.IDs) > 0) || request.JobID < 0 || request.UserID < 0 || slices.ContainsFunc(request.IDs, func(id int64) bool { return id < 1 }) || (request.Status != "" && !slices.Contains([]string{"safe", "review", "insufficient_evidence", "failed"}, request.Status)) {
		c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := model.DeleteInputAuditReviewResults(model.DB.WithContext(ctx), request.IDs, request.JobID, request.UserID, request.Status); err != nil {
		c.JSON(409, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.model_results_delete", map[string]any{"result_ids": request.IDs, "job_id": request.JobID, "user_id": request.UserID, "status": request.Status})
	c.JSON(200, gin.H{"success": true})
}
