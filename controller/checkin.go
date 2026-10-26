package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetCheckinStatus 获取用户签到状态和历史记录
func GetCheckinStatus(c *gin.Context) {
	if c.Query("balance_only") == "true" {
		balances, err := model.GetCheckinBalances(c.GetInt("id"))
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, balances)
		return
	}
	setting, err := model.CurrentCheckinSettings()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userId := c.GetInt("id")
	// 获取月份参数，默认为当前月份
	month := c.DefaultQuery("month", time.Now().Format("2006-01"))
	if _, err := time.Parse("2006-01", month); err != nil {
		common.ApiErrorMsg(c, "Invalid month")
		return
	}

	eligibility, err := model.GetCheckinEligibility(userId)
	if err != nil {
		common.ApiErrorMsg(c, "Unable to verify check-in eligibility")
		return
	}
	stats, err := model.GetUserCheckinStats(userId, month)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	grants, err := model.GetCheckinGrants(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"grants":      grants,
			"enabled":     setting.Enabled,
			"min_quota":   eligibility.BaseMinQuota,
			"max_quota":   eligibility.BaseMaxQuota,
			"stats":       stats,
			"eligibility": eligibility,
		},
	})
}

// DoCheckin 执行用户签到
func DoCheckin(c *gin.Context) {

	userId := c.GetInt("id")

	checkin, err := model.UserCheckin(userId)
	if err != nil {
		var restricted *model.CheckinRestrictedError
		if errors.As(err, &restricted) {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": restricted.Error(), "data": gin.H{"eligibility": restricted.Eligibility}})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("用户签到，获得额度 %s", logger.LogQuota(checkin.QuotaAwarded)))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "签到成功",
		"data": gin.H{
			"quota_awarded": checkin.QuotaAwarded,
			"checkin_date":  checkin.CheckinDate},
	})
}

// Check-in administration uses the existing root/admin route groups.
func GetCheckinSettings(c *gin.Context) {
	config, err := model.CurrentCheckinConfiguration()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func UpdateCheckinSettings(c *gin.Context) {
	var request struct {
		Settings operation_setting.CheckinSetting `json:"settings"`
		Version  int64                            `json:"version"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "Invalid check-in settings")
		return
	}
	config, err := model.UpdateCheckinConfiguration(request.Settings, request.Version)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func GetCheckinOverview(c *gin.Context) {
	overview, err := model.GetCheckinOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}

func ListCheckinUsers(c *gin.Context) {
	request := model.CheckinUserQuery{Page: 1, PageSize: 20}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "Invalid check-in query")
		return
	}
	page, err := model.ListCheckinUsers(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func GetCheckinUserDetail(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID <= 0 {
		common.ApiErrorMsg(c, "Invalid user ID")
		return
	}
	detail, err := model.GetCheckinUserDetail(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}
