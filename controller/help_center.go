package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/helpcenter"

	"github.com/gin-gonic/gin"
)

func GetHelpCenter(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	raw, exists := common.OptionMap[helpcenter.OptionKey]
	common.OptionMapRWMutex.RUnlock()
	if !exists {
		raw = helpcenter.DefaultJSON
	}
	config, err := helpcenter.Parse(raw)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Invalid help center configuration"})
		return
	}
	visible := make([]helpcenter.Item, 0, len(config.Items))
	for _, item := range config.Items {
		if item.Enabled {
			visible = append(visible, item)
		}
	}
	config.Items = visible
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}
