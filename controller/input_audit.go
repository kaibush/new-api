package controller

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetInputAudits(c *gin.Context) {
	filter := model.InputAuditFilter{RequestId: c.Query("request_id")}
	values := []struct {
		key    string
		target *int64
	}{
		{"start_timestamp", &filter.Start},
		{"end_timestamp", &filter.End},
	}
	for _, value := range values {
		if text := c.Query(value.key); text != "" {
			number, err := strconv.ParseInt(text, 10, 64)
			if err != nil || number < 0 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid timestamp"})
				return
			}
			*value.target = number
		}
	}
	if text := c.Query("user_id"); text != "" {
		id, err := strconv.Atoi(text)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid user ID"})
			return
		}
		filter.UserId = id
	}
	if len(filter.RequestId) > 64 || (filter.Start > 0 && filter.End > 0 && filter.End < filter.Start) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit filters"})
		return
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.Page > 100000 || page.PageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid pagination"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	rows, total, err := model.QueryInputAudits(model.DB.WithContext(ctx), filter, page.GetStartIdx(), page.PageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
}

func GetInputAuditStatus(c *gin.Context) {
	r := service.CurrentInputAuditRecorder()
	if r == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Input audit recorder is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": r.Status()})
}

func UpdateInputAuditSettings(c *gin.Context) {
	r := service.CurrentInputAuditRecorder()
	if r == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Input audit recorder is unavailable"})
		return
	}
	var settings model.InputAuditSettings
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid audit settings"})
		return
	}
	if err := settings.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := r.UpdateSettings(ctx, settings); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "input_audit.settings", map[string]any{"enabled": settings.Enabled, "retention_days": settings.RetentionDays, "max_records": settings.MaxRecords, "max_chars": settings.MaxChars})
	c.JSON(http.StatusOK, gin.H{"success": true})
}
