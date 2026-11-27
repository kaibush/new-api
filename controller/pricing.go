package controller

import (
	"maps"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func filterPricingByUsableGroups(pricing []model.Pricing, userID int, usableGroup map[string]string) []model.Pricing {
	if len(pricing) == 0 {
		return pricing
	}

	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		if !setting.CatalogModelAllowed(userID, item.ModelName) {
			continue
		}
		modelGranted := setting.CatalogModelGranted(userID, item.ModelName)
		visible := make([]string, 0, len(item.EnableGroup))
		for _, group := range item.EnableGroup {
			if !setting.CatalogGroupAllowed(userID, group) {
				continue
			}
			if _, ok := usableGroup[group]; ok || group == "all" || modelGranted || setting.CatalogGroupGranted(userID, group) {
				visible = append(visible, group)
			}
		}
		if len(visible) > 0 {
			item.EnableGroup = visible
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func GetPricing(c *gin.Context) {
	userID := c.GetInt("id")
	pricing := model.GetPricing()
	group := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usableGroup := service.GetUserUsableGroups(userID, group)
	groupRatio := map[string]float64{}
	maps.Copy(groupRatio, ratio_setting.GetGroupRatioCopy())
	for target := range groupRatio {
		if ratio, ok := ratio_setting.GetGroupGroupRatio(group, target); ok {
			groupRatio[target] = ratio
		}
	}
	pricing = filterPricingByUsableGroups(pricing, userID, usableGroup)
	for _, item := range pricing {
		for _, enableGroup := range item.EnableGroup {
			if enableGroup == "" || enableGroup == "all" {
				continue
			}
			if _, ok := usableGroup[enableGroup]; !ok {
				usableGroup[enableGroup] = setting.GetUsableGroupDescription(enableGroup)
			}
			groupRatio[enableGroup] = service.GetUserGroupRatio(group, enableGroup)
		}
	}
	// check groupRatio contains usableGroup
	for target := range ratio_setting.GetGroupRatioCopy() {
		if _, ok := usableGroup[target]; !ok {
			delete(groupRatio, target)
		}
	}

	vendors := map[int]bool{}
	endpoints := map[string]common.EndpointInfo{}
	allEndpoints := model.GetSupportedEndpointMap()
	for _, item := range pricing {
		vendors[item.VendorID] = true
		for _, endpoint := range item.SupportedEndpointTypes {
			if info, ok := allEndpoints[string(endpoint)]; ok {
				endpoints[string(endpoint)] = info
			}
		}
	}
	c.JSON(200, gin.H{
		"success":            true,
		"data":               pricing,
		"vendors":            slices.DeleteFunc(slices.Clone(model.GetVendors()), func(vendor model.PricingVendor) bool { return !vendors[vendor.ID] }),
		"group_ratio":        groupRatio,
		"usable_group":       usableGroup,
		"supported_endpoint": endpoints,
		"auto_groups":        service.GetUserAutoGroup(userID, group),
		"pricing_version":    "a42d372ccf0b5dd13ecf71203521f9d2",
	})
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	err := model.UpdateOption("ModelRatio", defaultStr)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	err = ratio_setting.UpdateModelRatioByJSONString(defaultStr)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "重置模型倍率成功",
	})
}
