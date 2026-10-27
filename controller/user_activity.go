package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetUserActivityOverview(c *gin.Context) {
	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	if err != nil {
		common.ApiErrorMsg(c, "Invalid activity window")
		return
	}
	data, err := model.GetUserActivityOverview(days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

func ListUserActivity(c *gin.Context) {
	query := model.UserActivityQuery{Days: 30, Page: 1, PageSize: 20}
	if err := c.ShouldBindJSON(&query); err != nil {
		common.ApiErrorMsg(c, "Invalid activity query")
		return
	}
	data, err := model.ListUserActivity(query)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

func GetUserActivityDetail(c *gin.Context) {
	userID, idErr := strconv.Atoi(c.Param("id"))
	days, daysErr := strconv.Atoi(c.DefaultQuery("days", "30"))
	if idErr != nil || daysErr != nil {
		common.ApiErrorMsg(c, "Invalid activity query")
		return
	}
	data, err := model.GetUserActivityDetail(userID, days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}
