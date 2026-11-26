package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetSupportTicketSettings(c *gin.Context) {
	settings, err := model.GetSupportTicketSettings()
	if err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": settings})
}

func SaveSupportTicketSettings(c *gin.Context) {
	var input struct {
		Enabled *bool   `json:"enabled"`
		Name    *string `json:"name"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	if c.ContentType() != "application/json" || common.DecodeJson(c.Request.Body, &input) != nil || input.Enabled == nil || input.Name == nil || strings.ContainsFunc(*input.Name, unicode.IsControl) || utf8.RuneCountInString(*input.Name) > 80 {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_SETTINGS", "message": "Invalid ticket settings."})
		return
	}
	settings := model.SupportTicketSettings{Enabled: *input.Enabled, Name: strings.TrimSpace(*input.Name)}
	if err := model.SaveSupportTicketSettings(settings); err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": settings})
}

func SupportTicketAccess(c *gin.Context) {
	settings, err := model.GetSupportTicketSettings()
	if err != nil {
		supportTicketError(c, err)
		c.Abort()
		return
	}
	if !settings.Enabled {
		c.AbortWithStatusJSON(403, gin.H{"success": false, "code": "TICKET_DISABLED", "message": "Support tickets are disabled."})
		return
	}
	c.Next()
}

func ListSupportTickets(c *gin.Context) {
	status := model.TicketStatus(c.Query("status"))
	search := strings.TrimSpace(c.Query("search"))
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1000000 || (status != "" && !status.Valid()) || utf8.RuneCountInString(search) > 120 {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_FILTER", "message": "Invalid ticket filter."})
		return
	}
	const pageSize = 25
	rows, total, err := model.ListSupportTickets(c.GetInt("id"), c.GetInt("role") >= common.RoleAdminUser, search, status, (page-1)*pageSize, pageSize)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows, "total": total, "has_more": int64(page*pageSize) < total}})
}

func GetSupportTicket(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	before, cursorErr := strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	if err != nil || id <= 0 || cursorErr != nil || before < 0 {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_FILTER", "message": "Invalid ticket filter."})
		return
	}
	ticket, messages, more, err := model.ReadSupportTicket(id, c.GetInt("id"), c.GetInt("role") >= common.RoleAdminUser, before)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"ticket": ticket, "messages": messages, "has_more": more}})
}

func WriteSupportTicket(c *gin.Context) {
	var input struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
	if c.ContentType() != "application/json" || common.DecodeJson(c.Request.Body, &input) != nil {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_MESSAGE", "message": "Invalid ticket message."})
		return
	}
	input.Body, input.Title = strings.TrimSpace(input.Body), strings.TrimSpace(input.Title)
	if input.Body == "" || utf8.RuneCountInString(input.Body) > 4000 || strings.ContainsRune(input.Body, 0) || strings.ContainsRune(input.Title, 0) {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_MESSAGE", "message": "Invalid ticket message."})
		return
	}
	userID := c.GetInt("id")
	if c.Param("id") == "" {
		if input.Title == "" || utf8.RuneCountInString(input.Title) > 120 {
			c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_TITLE", "message": "Invalid ticket title."})
			return
		}
		ticket, err := model.OpenSupportTicket(userID, input.Title, input.Body)
		if err != nil {
			supportTicketError(c, err)
			return
		}
		c.JSON(201, gin.H{"success": true, "data": ticket})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		supportTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := model.ReplyToSupportTicket(id, userID, c.GetInt("role") >= common.RoleAdminUser, input.Body); err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func UpdateSupportTicketStatus(c *gin.Context) {
	var input struct {
		Status model.TicketStatus `json:"status"`
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if err != nil || id <= 0 || c.ContentType() != "application/json" || common.DecodeJson(c.Request.Body, &input) != nil || !input.Status.Valid() {
		c.JSON(400, gin.H{"success": false, "code": "TICKET_INVALID_STATUS", "message": "Invalid ticket status."})
		return
	}
	if err := model.SetSupportTicketStatus(id, input.Status); err != nil {
		supportTicketError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func supportTicketError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(404, gin.H{"success": false, "code": "TICKET_NOT_FOUND", "message": "Ticket not found."})
	case errors.Is(err, model.ErrTicketClosed):
		c.JSON(409, gin.H{"success": false, "code": "TICKET_CLOSED", "message": model.ErrTicketClosed.Error()})
	default:
		c.JSON(500, gin.H{"success": false, "code": "TICKET_UNAVAILABLE", "message": "Could not update or load tickets."})
	}
}
