package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func CreateCommunityEvent(c *gin.Context) {
	var input model.CommunityEventInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		communityError(c, 400, model.ErrCommunityEventInput.Error())
		return
	}
	event, err := model.CreateCommunityEvent(c.GetInt("id"), input)
	if err != nil {
		if errors.Is(err, model.ErrCommunityEventInput) {
			communityError(c, 400, err.Error())
			return
		}
		communityError(c, 409, "Could not publish event")
		return
	}
	recordManageAudit(c, "community.event_create", map[string]any{"event_id": event.ID})
	c.JSON(200, gin.H{"success": true, "data": event})
}

func ListCommunityEvents(c *gin.Context) {
	events, err := model.ListCommunityEvents()
	if err != nil {
		communityError(c, 500, "Could not load events")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": events})
}

func UpdateCommunityEvent(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, model.ErrCommunityEventUnavailable.Error())
		return
	}
	var input model.CommunityEventInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		communityError(c, 400, model.ErrCommunityEventInput.Error())
		return
	}
	event, err := model.UpdateCommunityEvent(c.GetInt("id"), id, input)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrCommunityEventInput):
			communityError(c, 400, err.Error())
		case errors.Is(err, model.ErrCommunityEventNotEditable):
			communityError(c, 409, err.Error())
		case errors.Is(err, model.ErrCommunityEventUnavailable), errors.Is(err, gorm.ErrRecordNotFound):
			communityError(c, 404, model.ErrCommunityEventUnavailable.Error())
		default:
			communityError(c, 500, "Could not update event")
		}
		return
	}
	recordManageAudit(c, "community.event_update", map[string]any{"event_id": event.ID})
	c.JSON(200, gin.H{"success": true, "data": event})
}

func GetCommunityEvent(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, model.ErrCommunityEventUnavailable.Error())
		return
	}
	event, err := model.GetCommunityEvent(id)
	if err != nil {
		communityError(c, 404, model.ErrCommunityEventUnavailable.Error())
		return
	}
	c.JSON(200, gin.H{"success": true, "data": event})
}

func CancelCommunityEvent(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, model.ErrCommunityEventUnavailable.Error())
		return
	}
	if err := model.CancelCommunityEvent(id); err != nil {
		communityError(c, 404, model.ErrCommunityEventUnavailable.Error())
		return
	}
	recordManageAudit(c, "community.event_cancel", map[string]any{"event_id": id})
	c.JSON(200, gin.H{"success": true})
}
