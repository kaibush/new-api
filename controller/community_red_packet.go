package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func CreateCommunityRedPacket(c *gin.Context) {
	markAuditLogged(c) // Redemption codes must never be included in request audits.
	var req struct {
		Greeting string   `json:"greeting"`
		Codes    []string `json:"codes"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if common.DecodeJson(c.Request.Body, &req) != nil {
		communityError(c, 400, model.ErrRedPacketCodes.Error())
		return
	}
	packet, err := model.CreateCommunityRedPacket(c.GetInt("id"), req.Greeting, req.Codes)
	if err != nil {
		if errors.Is(err, model.ErrRedPacketCodes) {
			communityError(c, 400, err.Error())
			return
		}
		communityError(c, 409, "Could not send red packet")
		return
	}
	recordManageAudit(c, "community.red_packet_create", map[string]any{"packet_id": packet.ID, "count": packet.Total})
	c.JSON(200, gin.H{"success": true, "data": packet})
}

func ListCommunityRedPackets(c *gin.Context) {
	before, _ := strconv.ParseInt(c.Query("before_id"), 10, 64)
	packets, err := model.ListCommunityRedPackets(before)
	if err != nil {
		communityError(c, 500, "Could not load red packets")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": packets})
}

func GetCommunityRedPacket(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, "Red packet is unavailable")
		return
	}
	packet, err := model.GetCommunityRedPacket(id, c.GetInt("id"))
	if err != nil {
		communityError(c, 404, "Red packet is unavailable")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": packet})
}

func ClaimCommunityRedPacket(c *gin.Context) {
	markAuditLogged(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, "Red packet is unavailable")
		return
	}
	if err := model.ClaimCommunityRedPacket(id, c.GetInt("id")); err != nil {
		communityError(c, 409, "Red packet is unavailable")
		return
	}
	recordManageAudit(c, "community.red_packet_claim", map[string]any{"packet_id": id})
	GetCommunityRedPacket(c)
}

func GetCommunityRedPacketCodes(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, "Red packet is unavailable")
		return
	}
	codes, err := model.GetCommunityRedPacketCodes(id, c.GetInt("id"))
	if err != nil {
		communityError(c, 404, "Red packet is unavailable")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": codes})
}
