package service

import (
	"maps"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

func enabledModelGroupsMap() map[string][]string {
	if model.DB == nil {
		return nil
	}
	if common.MemoryCacheEnabled {
		pricing := model.GetPricing()
		result := make(map[string][]string, len(pricing))
		for _, item := range pricing {
			groups := slices.Clone(item.EnableGroup)
			slices.Sort(groups)
			result[item.ModelName] = groups
		}
		return result
	}
	abilities := model.GetAllEnableAbilities()
	seen := make(map[string]map[string]struct{})
	for _, ability := range abilities {
		if ability.Group == "" || ability.Model == "" {
			continue
		}
		groupSet, ok := seen[ability.Model]
		if !ok {
			groupSet = make(map[string]struct{})
			seen[ability.Model] = groupSet
		}
		groupSet[ability.Group] = struct{}{}
	}
	result := make(map[string][]string, len(seen))
	for modelName, groupSet := range seen {
		groups := slices.Collect(maps.Keys(groupSet))
		slices.Sort(groups)
		result[modelName] = groups
	}
	return result
}

func activeCatalogGroupSet() map[string]struct{} {
	active := make(map[string]struct{})
	for name := range ratio_setting.GetGroupRatioCopy() {
		if name != "" && name != "auto" {
			active[name] = struct{}{}
		}
	}
	for name := range setting.GetUserUsableGroupsCopy() {
		if name != "" && name != "auto" {
			active[name] = struct{}{}
		}
	}
	for _, groups := range enabledModelGroupsMap() {
		for _, name := range groups {
			if name != "" && name != "auto" {
				active[name] = struct{}{}
			}
		}
	}
	return active
}

// AllConfiguredGroups returns all routing groups configured in group ratios,
// usable groups, or enabled channel abilities (excluding "auto").
func AllConfiguredGroups() []string {
	groups := slices.Collect(maps.Keys(activeCatalogGroupSet()))
	slices.Sort(groups)
	return groups
}

func GetUserUsableGroups(userID int, userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if after, ok := strings.CutPrefix(specialGroup, "-:"); ok {
					// 移除分组
					groupToRemove := after
					delete(groupsCopy, groupToRemove)
				} else if after, ok := strings.CutPrefix(specialGroup, "+:"); ok {
					// 添加分组
					groupToAdd := after
					groupsCopy[groupToAdd] = desc
				} else {
					// 直接添加分组
					groupsCopy[specialGroup] = desc
				}
			}
		}
		// 如果userGroup不在UserUsableGroups中，返回UserUsableGroups + userGroup
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "用户分组"
		}
	}
	if permitted := setting.CatalogPermittedGroups(userID); len(permitted) > 0 {
		active := activeCatalogGroupSet()
		for _, groupName := range permitted {
			if _, isActive := active[groupName]; !isActive {
				continue
			}
			if _, ok := groupsCopy[groupName]; !ok {
				groupsCopy[groupName] = setting.GetUsableGroupDescription(groupName)
			}
		}
	}
	maps.DeleteFunc(groupsCopy, func(name, _ string) bool { return !setting.CatalogGroupAllowed(userID, name) })
	return groupsCopy
}

func VisibleCatalogModels(userID int, groups []string) []string {
	visibleGroups := make([]string, 0, len(groups))
	for _, group := range groups {
		if setting.CatalogGroupAllowed(userID, group) {
			visibleGroups = append(visibleGroups, group)
		}
	}
	return slices.DeleteFunc(GetGroupsEnabledModels(visibleGroups), func(name string) bool { return !setting.CatalogModelAllowed(userID, name) })
}

// PermittedCatalogModels returns enabled models explicitly granted to userID by
// model-level or group-level CatalogVisibility rules, regardless of token group.
func PermittedCatalogModels(userID int) []string {
	if userID <= 0 || !setting.HasCatalogRestrictions() {
		return nil
	}
	byModel := enabledModelGroupsMap()
	if len(byModel) == 0 {
		return nil
	}
	modelNames := slices.Collect(maps.Keys(byModel))
	slices.Sort(modelNames)
	permitted := make([]string, 0)
	for _, modelName := range modelNames {
		if !setting.CatalogModelAllowed(userID, modelName) {
			continue
		}
		modelGranted := setting.CatalogModelGranted(userID, modelName)
		for _, group := range byModel[modelName] {
			if setting.CatalogGroupAllowed(userID, group) && (modelGranted || setting.CatalogGroupGranted(userID, group)) {
				permitted = append(permitted, modelName)
				break
			}
		}
	}
	return permitted
}

// PermittedModelFallbackGroups returns enabled channel groups that userID is
// permitted to fall back to for modelName via explicit CatalogVisibility grants.
func PermittedModelFallbackGroups(userID int, modelName string, excludeGroups []string) []string {
	if userID <= 0 || modelName == "" || !setting.HasCatalogRestrictions() || !setting.CatalogModelAllowed(userID, modelName) {
		return nil
	}
	byModel := enabledModelGroupsMap()
	if len(byModel) == 0 {
		return nil
	}
	candidateSet := make(map[string]struct{})
	for _, group := range byModel[modelName] {
		candidateSet[group] = struct{}{}
	}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != "" && normalized != modelName {
		for _, group := range byModel[normalized] {
			candidateSet[group] = struct{}{}
		}
	}
	if len(candidateSet) == 0 {
		return nil
	}
	candidates := slices.Collect(maps.Keys(candidateSet))
	slices.Sort(candidates)
	modelGranted := setting.CatalogModelGranted(userID, modelName)
	fallbacks := make([]string, 0, len(candidates))
	for _, group := range candidates {
		if group == "" || group == "auto" || slices.Contains(excludeGroups, group) {
			continue
		}
		if setting.CatalogGroupAllowed(userID, group) && (modelGranted || setting.CatalogGroupGranted(userID, group)) {
			fallbacks = append(fallbacks, group)
		}
	}
	return fallbacks
}

// PermittedCandidateGroupsForRequest returns the ordered routing groups eligible
// to serve modelName for the current request, starting with the token's bound
// group(s) and followed by any CatalogVisibility cross-group grants.
func PermittedCandidateGroupsForRequest(c *gin.Context, userGroup, tokenGroup, modelName string) []string {
	userID := c.GetInt("id")
	var base []string
	if tokenGroup == "auto" {
		base = GetRequestAutoGroups(c, userGroup)
	} else if tokenGroup != "" && setting.CatalogGroupAllowed(userID, tokenGroup) {
		base = []string{tokenGroup}
	}
	for _, fallbackGroup := range PermittedModelFallbackGroups(userID, modelName, base) {
		base = append(base, fallbackGroup)
	}
	return base
}

// PermittedViewerGroups returns all routing groups whose catalog/metrics entries
// userID may view, including groups backing explicitly granted models.
func PermittedViewerGroups(userID int, userGroup string) []string {
	usable := GetUserUsableGroups(userID, userGroup)
	seen := make(map[string]struct{}, len(usable))
	for group := range usable {
		if group != "" && group != "auto" {
			seen[group] = struct{}{}
		}
	}
	if userID > 0 && setting.HasCatalogRestrictions() {
		byModel := enabledModelGroupsMap()
		for modelName, groups := range byModel {
			if !setting.CatalogModelGranted(userID, modelName) {
				continue
			}
			for _, group := range groups {
				if group != "" && group != "auto" && setting.CatalogGroupAllowed(userID, group) {
					seen[group] = struct{}{}
				}
			}
		}
	}
	groups := slices.Collect(maps.Keys(seen))
	slices.Sort(groups)
	return groups
}

func GroupInUserUsableGroups(userID int, userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userID, userGroup)[groupName]
	return ok
}

func IsUserSelectableGroup(userID int, userGroup, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroups(userID, userGroup, groupName) &&
		(ratio_setting.ContainsGroupRatio(groupName) || setting.CatalogGroupGranted(userID, groupName))
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userID int, userGroup string) []string {
	autoGroups := make([]string, 0)
	seen := make(map[string]struct{})
	for _, group := range setting.GetAutoGroups() {
		if !IsUserSelectableGroup(userID, userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// FilterUserTokenAutoGroups applies current permissions before the current
// per-token limit. It intentionally does not fall back to the global Auto list.
func FilterUserTokenAutoGroups(userID int, userGroup string, groups []string) []string {
	maxCount := setting.GetMaxTokenAutoGroups()
	filtered := make([]string, 0, min(len(groups), maxCount))
	seen := make(map[string]struct{})
	for _, group := range groups {
		if !IsUserSelectableGroup(userID, userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		filtered = append(filtered, group)
		if len(filtered) == maxCount {
			break
		}
	}
	return filtered
}

// GetRequestAutoGroups resolves the ordered Auto groups for the current token.
// The absence of the context value means that the token inherits the complete
// global Auto list; a present (even empty) value is an explicit token snapshot.
func GetRequestAutoGroups(c *gin.Context, userGroup string) []string {
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenAutoGroups)
	if !ok {
		return GetUserAutoGroup(c.GetInt("id"), userGroup)
	}
	groups, ok := value.([]string)
	if !ok {
		return []string{}
	}
	return FilterUserTokenAutoGroups(c.GetInt("id"), userGroup, groups)
}

// GetGroupsEnabledModels 按 groups 顺序获取各分组启用的模型并去重
func GetGroupsEnabledModels(groups []string) []string {
	byGroup := model.EnabledModelsByGroup(groups)
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range byGroup[group] {
			if _, ok := seen[modelName]; !ok {
				seen[modelName] = struct{}{}
				models = append(models, modelName)
			}
		}
	}
	return models
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
// userGroup 用户分组
// group 需要获取倍率的分组
func GetUserGroupRatio(userGroup, group string) float64 {
	ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
	if ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
}
