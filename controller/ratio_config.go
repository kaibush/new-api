package controller

import (
	"maps"
	"net/http"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetRatioConfig(c *gin.Context) {
	if !ratio_setting.IsExposeRatioEnabled() {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "倍率配置接口未启用",
		})
		return
	}

	data := billing_setting.GetPricingSyncData(map[string]any(ratio_setting.GetExposedData()))
	if setting.HasCatalogRestrictions() {
		visible := viewerCatalogNames(c)
		for field, raw := range data {
			switch entries := raw.(type) {
			case map[string]float64:
				filtered := maps.Clone(entries)
				maps.DeleteFunc(filtered, func(name string, _ float64) bool { return !visible[name] })
				data[field] = filtered
			case map[string]string:
				filtered := maps.Clone(entries)
				maps.DeleteFunc(filtered, func(name, _ string) bool { return !visible[name] })
				data[field] = filtered
			default:
				delete(data, field)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}
