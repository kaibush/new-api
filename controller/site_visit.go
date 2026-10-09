package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var analyticsIDPattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)

// Only route templates are accepted, so path parameters cannot leak credentials or chat IDs.
var analyticsPages = map[string]bool{
	"/":                                    true,
	"/401":                                 true,
	"/403":                                 true,
	"/404":                                 true,
	"/500":                                 true,
	"/503":                                 true,
	"/about":                               true,
	"/channels":                            true,
	"/chat/$chatId":                        true,
	"/chat2link":                           true,
	"/dashboard":                           true,
	"/dashboard/$section":                  true,
	"/errors/$error":                       true,
	"/forgot-password":                     true,
	"/help-center":                         true,
	"/keys":                                true,
	"/models":                              true,
	"/models/$section":                     true,
	"/oauth":                               true,
	"/oauth/$provider":                     true,
	"/otp":                                 true,
	"/playground":                          true,
	"/pricing":                             true,
	"/pricing/$modelId":                    true,
	"/privacy-policy":                      true,
	"/profile":                             true,
	"/rankings":                            true,
	"/redemption-codes":                    true,
	"/register":                            true,
	"/reset":                               true,
	"/security":                            true,
	"/setup":                               true,
	"/sign-in":                             true,
	"/sign-up":                             true,
	"/subscriptions":                       true,
	"/system-info":                         true,
	"/system-settings":                     true,
	"/system-settings/auth":                true,
	"/system-settings/auth/$section":       true,
	"/system-settings/billing":             true,
	"/system-settings/billing/$section":    true,
	"/system-settings/content":             true,
	"/system-settings/content/$section":    true,
	"/system-settings/models":              true,
	"/system-settings/models/$section":     true,
	"/system-settings/operations":          true,
	"/system-settings/operations/$section": true,
	"/system-settings/request-policies":    true,
	"/system-settings/request-policies/$section": true,
	"/system-settings/security":                  true,
	"/system-settings/security/$section":         true,
	"/system-settings/site":                      true,
	"/system-settings/site/$section":             true,
	"/task-plugins":                              true,
	"/usage-logs":                                true,
	"/usage-logs/$section":                       true,
	"/usage-logs/audit":                          true,
	"/user-agreement":                            true,
	"/user/reset":                                true,
	"/users":                                     true,
	"/visit-analytics":                           true,
	"/wallet":                                    true,
}

func RecordSiteVisit(c *gin.Context) {
	var input struct {
		Page     string `json:"page"`
		Visitor  string `json:"visitor"`
		Session  string `json:"session"`
		Referrer string `json:"referrer"`
		Language string `json:"language"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 2048), &input); err != nil || !analyticsPages[input.Page] || !analyticsIDPattern.MatchString(input.Visitor) || !analyticsIDPattern.MatchString(input.Session) || len(input.Language) > 32 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid visit metadata"})
		return
	}
	// Reject cross-site browser submissions before accepting analytics metadata.
	if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	now := time.Now().UTC()
	visit := model.SiteVisit{
		CreatedAt: now.Unix(),
		Day:       now.Format("2006-01-02"),
		Page:      input.Page,
		UserID:    c.GetInt("id"),
		Username:  c.GetString("username"),
		IP:        c.ClientIP(),
		Language:  input.Language,
		Visitor:   "a:" + input.Visitor,
	}
	if visit.UserID > 0 {
		visit.Visitor = fmt.Sprintf("u:%d", visit.UserID)
	}
	// This identifier is exclusively for analytics; it is unrelated to authentication sessions.
	visit.Session = visit.Visitor + ":" + input.Session
	if ref, err := url.Parse(input.Referrer); err == nil && (ref.Scheme == "https" || ref.Scheme == "http") && len(ref.Hostname()) <= 255 {
		visit.Referrer = ref.Hostname()
	}
	ua := c.Request.UserAgent()
	visit.Browser, visit.OS, visit.Device = "Other", "Other", "Desktop"
	switch {
	case strings.Contains(ua, "Edg/"):
		visit.Browser = "Edge"
	case strings.Contains(ua, "OPR/"):
		visit.Browser = "Opera"
	case strings.Contains(ua, "Firefox/") || strings.Contains(ua, "FxiOS/"):
		visit.Browser = "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		visit.Browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		visit.Browser = "Safari"
	}
	switch {
	case strings.Contains(ua, "Android"):
		visit.OS = "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		visit.OS = "iOS"
	case strings.Contains(ua, "Windows"):
		visit.OS = "Windows"
	case strings.Contains(ua, "Macintosh"):
		visit.OS = "macOS"
	case strings.Contains(ua, "Linux"):
		visit.OS = "Linux"
	}
	if strings.Contains(ua, "Mobile") {
		visit.Device = "Mobile"
	}
	if strings.Contains(ua, "iPad") || (visit.OS == "Android" && !strings.Contains(ua, "Mobile")) {
		visit.Device = "Tablet"
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	if err := model.DB.WithContext(ctx).Create(&visit).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Visit recording unavailable"})
		return
	}
	c.Status(http.StatusNoContent)
}

func GetSiteVisits(c *gin.Context) {
	now := time.Now().UTC()
	start, errStart := strconv.ParseInt(c.Query("start"), 10, 64)
	end, errEnd := strconv.ParseInt(c.Query("end"), 10, 64)
	userID, errUser := strconv.Atoi(c.DefaultQuery("user_id", "0"))
	page, errPage := strconv.Atoi(c.DefaultQuery("page", "1"))
	path := c.Query("path")
	if errStart != nil || errEnd != nil || errUser != nil || errPage != nil || userID < 0 || page < 1 || page > 100000 || end <= start || start < now.AddDate(0, 0, -91).Unix() || end > now.AddDate(0, 0, 1).Unix() || (path != "" && !analyticsPages[path]) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid analytics filters"})
		return
	}
	filter := model.VisitFilter{Start: max(start, now.AddDate(0, 0, -90).Unix()), End: end, UserID: userID, Page: path, Offset: (page - 1) * 50, Limit: 50}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	if c.Query("view") == "details" {
		rows, total, err := model.QueryVisitDetails(db, filter)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load visit details"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
		return
	}
	report, err := model.QueryVisitReport(db, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load visit analytics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": report})
}
