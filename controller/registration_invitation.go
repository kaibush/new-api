package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GenerateRegistrationInvitations(c *gin.Context) {
	var request struct {
		Count int `json:"count"`
		Days  int `json:"days"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Count < 1 || request.Count > 100 || request.Days < 1 || request.Days > 365 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	codes, err := model.GenerateRegistrationInvitations(request.Count, request.Days, c.GetInt("id"))
	recordManageAudit(c, "registration_invitation.generate", map[string]any{"count": request.Count, "days": request.Days, "success": err == nil})
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": codes})
}

func SearchRegistrationInvitations(c *gin.Context) {
	// Code searches use the request body so usable invitations never enter URLs.
	markAuditLogged(c)
	var request struct {
		Page int    `json:"page"`
		Code string `json:"code"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Page < 1 || request.Page > 1000000 || len(request.Code) > 128 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	rows, total, err := model.ListRegistrationInvitations((request.Page-1)*20, 20, strings.TrimSpace(request.Code))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": rows, "total": total}})
}

func RevokeRegistrationInvitation(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	err = model.RevokeRegistrationInvitation(id)
	recordManageAudit(c, "registration_invitation.revoke", map[string]any{"invitation_id": id, "success": err == nil})
	if err != nil {
		writeRegistrationInvitationError(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteRegistrationInvitations(c *gin.Context) {
	var request struct {
		IDs []int `json:"ids"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || len(request.IDs) < 1 || len(request.IDs) > 100 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	for _, id := range request.IDs {
		if id < 1 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
	}
	count, err := model.DeleteRegistrationInvitations(request.IDs)
	recordManageAudit(c, "registration_invitation.delete", map[string]any{"invitation_ids": request.IDs, "deleted_count": count, "success": err == nil})
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": count})
}
