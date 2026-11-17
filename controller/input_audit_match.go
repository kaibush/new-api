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
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func GetInputAuditMatches(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	q := model.DB.WithContext(ctx).Session(&gorm.Session{Logger: gormlogger.Discard}).Model(&model.InputAuditMatch{})
	if value := c.Query("user_id"); value != "" {
		id, err := strconv.Atoi(value)
		if err != nil || id < 1 {
			c.JSON(400, gin.H{"success": false, "message": "Invalid user ID"})
			return
		}
		q = q.Where("user_id = ?", id)
	}
	for _, field := range []string{"request_id", "rule", "status"} {
		if value := c.Query(field); value != "" {
			if len(value) > 1024 || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
				c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
				return
			}
			q = q.Where(field+" = ?", value)
		}
	}
	if keyword := c.Query("keyword"); keyword != "" {
		if len(keyword) > 512 || !utf8.ValidString(keyword) || strings.ContainsRune(keyword, '\x00') {
			c.JSON(400, gin.H{"success": false, "message": "Invalid audit filters"})
			return
		}
		// Explicit portable escape character: percent/underscore remain literal.
		escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(keyword)
		q = q.Where("search_text LIKE ? ESCAPE '!'", "%"+escaped+"%")
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
	rows := []model.InputAuditMatch{}
	if err := q.Omit("evidence", "search_text").Order("id DESC").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
}

func GetInputAuditMatch(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("match_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid audit ID"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var row model.InputAuditMatch
	if err := model.DB.WithContext(ctx).Session(&gorm.Session{Logger: gormlogger.Discard}).First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"success": false, "message": "Audit evidence is unavailable or expired"})
		} else {
			common.ApiError(c, err)
		}
		return
	}
	var evidence *jsplugin.TransformMatchEvidence
	if row.Evidence != "" {
		if err := common.UnmarshalJsonStr(row.Evidence, &evidence); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	recordManageAudit(c, "input_audit.match_view", map[string]any{"match_id": id, "user_id": row.UserId})
	c.JSON(200, gin.H{"success": true, "data": gin.H{"record": row, "evidence": evidence}})
}

func DecideInputAuditMatch(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("match_id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"success": false, "message": "Invalid audit ID"})
		return
	}
	var body struct {
		Version int64  `json:"version"`
		Status  string `json:"status"`
		Reason  string `json:"reason"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 8192), &body); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid audit decision"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := model.DecideInputAuditMatch(model.DB.WithContext(ctx).Session(&gorm.Session{Logger: gormlogger.Discard}), id, body.Version, c.GetInt("id"), body.Status, body.Reason); err != nil {
		c.JSON(409, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "input_audit.match_decision", map[string]any{"match_id": id, "version": body.Version + 1, "status": body.Status})
	c.JSON(200, gin.H{"success": true})
}
