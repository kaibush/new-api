package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetUserNames only serves bounded lookups, never the whole user directory.
func GetUserNames(c *gin.Context) {
	parts := strings.Split(c.Query("ids"), ",")
	if len(parts) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Too many user IDs"})
		return
	}
	ids := make([]int, 0, len(parts))
	seen := make(map[int]bool, len(parts))
	for _, part := range parts {
		id, err := strconv.Atoi(part)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid user ID"})
			return
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	users, err := model.GetUserNames(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, users)
}
