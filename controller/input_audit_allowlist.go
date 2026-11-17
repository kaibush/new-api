package controller

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"github.com/gin-gonic/gin"
)

func GetInputAuditAllowlist(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	policy, err := model.LoadInputAuditAllowlist(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": policy})
}

func UpdateInputAuditAllowlist(c *gin.Context) {
	var policy request_plugin_setting.Allowlist
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20), &policy); err != nil || policy.Version < 0 || policy.Version >= 9007199254740991 || len(policy.Entries) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid allowlist settings"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	previous, err := model.LoadInputAuditAllowlist(model.DB.WithContext(ctx))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if previous.Version != policy.Version {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": model.ErrInputAuditConflict.Error()})
		return
	}
	if len(policy.Entries) > 0 {
		if recorder := service.CurrentInputAuditRecorder(); recorder == nil || !recorder.Status().Settings.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Enable input auditing before adding allowlist entries"})
			return
		}
	}
	old := make(map[string]request_plugin_setting.AllowlistEntry, len(previous.Entries))
	for _, entry := range previous.Entries {
		old[entry.ID] = entry
	}
	instances := make(map[string]string)
	for _, instance := range request_plugin_setting.GetInstances() {
		instances[instance.ID] = instance.Plugin
	}
	seen := make(map[int]bool)
	ids := make([]int, 0, len(policy.Entries))
	now, operator := time.Now().Unix(), c.GetInt("id")
	for i := range policy.Entries {
		entry := &policy.Entries[i]
		entry.Reason = strings.TrimSpace(entry.Reason)
		if entry.UserID < 1 || seen[entry.UserID] || entry.ExpiresAt <= now || entry.ExpiresAt > now+365*86400 || !utf8.ValidString(entry.Reason) || entry.Reason == "" || utf8.RuneCountInString(entry.Reason) > 500 || strings.ContainsRune(entry.Reason, '\x00') || len(entry.Instances) == 0 || len(entry.Instances) > 32 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid allowlist settings"})
			return
		}
		seen[entry.UserID] = true
		ids = append(ids, entry.UserID)
		slices.Sort(entry.Instances)
		entry.Instances = slices.Compact(entry.Instances)
		for _, id := range entry.Instances {
			if plugin := instances[id]; plugin != "request-filter" && plugin != "content-moderation" {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Allowlist entries must select content filtering instances"})
				return
			}
		}
		if entry.ID == "" {
			entry.ID, entry.CreatedAt, entry.CreatedBy = common.GetUUID(), now, operator
		} else if existing, ok := old[entry.ID]; ok && existing.UserID == entry.UserID {
			entry.CreatedAt, entry.CreatedBy = existing.CreatedAt, existing.CreatedBy
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid allowlist settings"})
			return
		}
		entry.UpdatedAt, entry.UpdatedBy = now, operator
	}
	if len(ids) > 0 {
		var count int64
		if err := model.DB.WithContext(ctx).Model(&model.User{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if count != int64(len(ids)) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "User not found"})
			return
		}
	}
	policy.Version++
	if err := model.SaveInputAuditAllowlist(model.DB.WithContext(ctx), policy); err != nil {
		if errors.Is(err, model.ErrInputAuditConflict) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	recordManageAudit(c, "input_audit.allowlist", map[string]any{"version": policy.Version, "user_ids": ids, "previous_entries": len(previous.Entries), "entries": len(policy.Entries)})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": policy})
}
