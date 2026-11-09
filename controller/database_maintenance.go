package controller

import (
	"context"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetDatabaseStorage(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	storage, err := model.GetDatabaseStorage(ctx)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, storage)
}

func PreviewDatabaseCleanup(c *gin.Context) {
	var request struct {
		Target        string `json:"target" binding:"required,oneof=request_logs site_visits"`
		RetentionDays int    `json:"retention_days" binding:"required,min=1,max=3650"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid cleanup target or retention period."})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	snapshot, err := model.PreviewDatabaseCleanup(ctx, request.Target, request.RetentionDays)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, snapshot)
}

func StartDatabaseCleanup(c *gin.Context) {
	var snapshot model.DatabaseCleanupSnapshot
	if err := c.ShouldBindJSON(&snapshot); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid database cleanup preview."})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	count, err := model.CountDatabaseCleanup(ctx, snapshot)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if count == 0 {
		common.ApiErrorMsg(c, "No eligible records remain. Preview the cleanup again.")
		return
	}
	snapshot.Count = count
	task, created, err := service.EnqueueSystemTask(model.SystemTaskTypeDatabaseCleanup, snapshot)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !created {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "A database cleanup is already running. Wait for it to finish."})
		return
	}
	recordManageAudit(c, "database.cleanup", map[string]any{"target": snapshot.Target, "before": snapshot.Before, "max_id": snapshot.MaxID, "count": count, "task_id": task.TaskID})
	common.ApiSuccess(c, task.ToResponse())
}
