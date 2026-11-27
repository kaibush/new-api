package setting

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/reasoning"
)

const CatalogVisibilityKey = "CatalogVisibility"

type CatalogVisibility struct {
	invalid             bool
	Audiences           map[string][]int    `json:"audiences"`
	Models              map[string][]string `json:"models"`
	Groups              map[string][]string `json:"groups"`
	ModelUsers          map[string][]int    `json:"model_users,omitempty"`
	GroupUsers          map[string][]int    `json:"group_users,omitempty"`
	OpenModels          []string            `json:"open_models,omitempty"`
	OpenGroups          []string            `json:"open_groups,omitempty"`
	ModelExclusions     map[string][]int    `json:"model_exclusions,omitempty"`
	GroupExclusions     map[string][]int    `json:"group_exclusions,omitempty"`
	ModelExcludedGroups map[string][]string `json:"model_excluded_groups,omitempty"`
	GroupExcludedGroups map[string][]string `json:"group_excluded_groups,omitempty"`
}

var catalogVisibility atomic.Pointer[CatalogVisibility]

var knownCatalogVisibilityFields = map[string]struct{}{
	"audiences":             {},
	"models":                {},
	"groups":                {},
	"model_users":           {},
	"group_users":           {},
	"open_models":           {},
	"open_groups":           {},
	"model_exclusions":      {},
	"group_exclusions":      {},
	"model_excluded_groups": {},
	"group_excluded_groups": {},
}

func decodeCatalogAccountIDMap(raw common.RawMessage, allowEmpty bool) (map[string][]int, error) {
	var entries map[string][]int
	if err := common.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		return nil, errors.New("expected a map of account IDs")
	}
	for name, ids := range entries {
		if name == "" || strings.TrimSpace(name) != name || ids == nil {
			return nil, errors.New("invalid resource name or account ID list")
		}
		if !allowEmpty && len(ids) == 0 {
			return nil, errors.New("account ID list must not be empty")
		}
		if slices.ContainsFunc(ids, func(id int) bool { return id <= 0 }) {
			return nil, errors.New("account IDs must be positive")
		}
		slices.Sort(ids)
		entries[name] = slices.Compact(ids)
	}
	return entries, nil
}

func decodeCatalogAudienceRefsMap(raw common.RawMessage, audiences map[string][]int, allowEmpty bool) (map[string][]string, error) {
	var entries map[string][]string
	if err := common.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		return nil, errors.New("expected a map of permission group names")
	}
	for name, members := range entries {
		if name == "" || strings.TrimSpace(name) != name || members == nil {
			return nil, errors.New("invalid visibility rule")
		}
		if !allowEmpty && len(members) == 0 {
			return nil, errors.New("permission group list must not be empty")
		}
		for _, member := range members {
			if _, exists := audiences[member]; !exists {
				return nil, errors.New("invalid visibility audience")
			}
		}
		sorted := slices.Clone(members)
		slices.Sort(sorted)
		entries[name] = slices.Compact(sorted)
	}
	return entries, nil
}

func decodeCatalogOpenList(raw common.RawMessage) ([]string, error) {
	var items []string
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	if items == nil {
		return nil, errors.New("expected a list of resource names")
	}
	for _, name := range items {
		if name == "" || strings.TrimSpace(name) != name {
			return nil, errors.New("invalid open resource name")
		}
	}
	slices.Sort(items)
	return slices.Compact(items), nil
}

func ParseCatalogVisibility(raw string) (*CatalogVisibility, error) {
	var fields map[string]common.RawMessage
	if err := common.DecodeJsonBody(strings.NewReader(raw), &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, errors.New("expected catalog visibility object")
	}
	for key := range fields {
		if _, ok := knownCatalogVisibilityFields[key]; !ok {
			return nil, errors.New("unknown catalog visibility field: " + key)
		}
	}
	audiencesRaw, hasAudiences := fields["audiences"]
	modelsRaw, hasModels := fields["models"]
	groupsRaw, hasGroups := fields["groups"]
	if !hasAudiences || !hasModels || !hasGroups {
		return nil, errors.New("expected audiences, models and groups visibility maps")
	}

	audiences, err := decodeCatalogAccountIDMap(audiencesRaw, true)
	if err != nil {
		return nil, err
	}
	models, err := decodeCatalogAudienceRefsMap(modelsRaw, audiences, true)
	if err != nil {
		return nil, err
	}
	groups, err := decodeCatalogAudienceRefsMap(groupsRaw, audiences, true)
	if err != nil {
		return nil, err
	}

	rules := &CatalogVisibility{
		Audiences: audiences,
		Models:    models,
		Groups:    groups,
	}

	if rawField, ok := fields["model_users"]; ok {
		if rules.ModelUsers, err = decodeCatalogAccountIDMap(rawField, false); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["group_users"]; ok {
		if rules.GroupUsers, err = decodeCatalogAccountIDMap(rawField, false); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["open_models"]; ok {
		if rules.OpenModels, err = decodeCatalogOpenList(rawField); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["open_groups"]; ok {
		if rules.OpenGroups, err = decodeCatalogOpenList(rawField); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["model_exclusions"]; ok {
		if rules.ModelExclusions, err = decodeCatalogAccountIDMap(rawField, false); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["group_exclusions"]; ok {
		if rules.GroupExclusions, err = decodeCatalogAccountIDMap(rawField, false); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["model_excluded_groups"]; ok {
		if rules.ModelExcludedGroups, err = decodeCatalogAudienceRefsMap(rawField, audiences, false); err != nil {
			return nil, err
		}
	}
	if rawField, ok := fields["group_excluded_groups"]; ok {
		if rules.GroupExcludedGroups, err = decodeCatalogAudienceRefsMap(rawField, audiences, false); err != nil {
			return nil, err
		}
	}

	return rules, nil
}

func UpdateCatalogVisibility(raw string) error {
	rules, err := ParseCatalogVisibility(raw)
	if err != nil {
		rules = &CatalogVisibility{invalid: true}
	}
	catalogVisibility.Store(rules)
	return err
}

func (rules *CatalogVisibility) hasAnyModelRules() bool {
	return len(rules.Models)+len(rules.ModelUsers)+len(rules.OpenModels)+len(rules.ModelExclusions)+len(rules.ModelExcludedGroups) > 0
}

func (rules *CatalogVisibility) hasAnyGroupRules() bool {
	return len(rules.Groups)+len(rules.GroupUsers)+len(rules.OpenGroups)+len(rules.GroupExclusions)+len(rules.GroupExcludedGroups) > 0
}

func HasCatalogRestrictions() bool {
	rules := catalogVisibility.Load()
	return rules != nil && (rules.invalid || rules.hasAnyModelRules() || rules.hasAnyGroupRules())
}

func (rules *CatalogVisibility) allowsResource(
	allowGroups map[string][]string,
	allowUsers map[string][]int,
	openList []string,
	excludedUsers map[string][]int,
	excludedGroups map[string][]string,
	userID int,
	target string,
) bool {
	excludedAccountIDs, hasUserExclusions := excludedUsers[target]
	excludedGroupNames, hasGroupExclusions := excludedGroups[target]
	if hasUserExclusions || hasGroupExclusions {
		if userID <= 0 {
			return false
		}
		if hasUserExclusions {
			if _, denied := slices.BinarySearch(excludedAccountIDs, userID); denied {
				return false
			}
		}
		if hasGroupExclusions {
			for _, groupName := range excludedGroupNames {
				if _, denied := slices.BinarySearch(rules.Audiences[groupName], userID); denied {
					return false
				}
			}
		}
	}

	audiences, hasGroupAllowlist := allowGroups[target]
	directUsers, hasUserAllowlist := allowUsers[target]
	if hasGroupAllowlist || hasUserAllowlist {
		if userID <= 0 {
			return false
		}
		if hasUserAllowlist {
			if _, found := slices.BinarySearch(directUsers, userID); found {
				return true
			}
		}
		if hasGroupAllowlist {
			for _, audience := range audiences {
				if _, found := slices.BinarySearch(rules.Audiences[audience], userID); found {
					return true
				}
			}
		}
		return false
	}

	if _, isOpen := slices.BinarySearch(openList, target); isOpen {
		return userID > 0
	}

	return true
}

func hasResourceEntry(
	allowGroups map[string][]string,
	allowUsers map[string][]int,
	openList []string,
	excludedUsers map[string][]int,
	excludedGroups map[string][]string,
	target string,
) bool {
	if _, ok := allowGroups[target]; ok {
		return true
	}
	if _, ok := allowUsers[target]; ok {
		return true
	}
	if _, ok := excludedUsers[target]; ok {
		return true
	}
	if _, ok := excludedGroups[target]; ok {
		return true
	}
	_, isOpen := slices.BinarySearch(openList, target)
	return isOpen
}

func (rules *CatalogVisibility) allowsGroup(userID int, target string) bool {
	return rules.allowsResource(
		rules.Groups,
		rules.GroupUsers,
		rules.OpenGroups,
		rules.GroupExclusions,
		rules.GroupExcludedGroups,
		userID,
		target,
	)
}

func (rules *CatalogVisibility) hasGroupRule(target string) bool {
	return hasResourceEntry(
		rules.Groups,
		rules.GroupUsers,
		rules.OpenGroups,
		rules.GroupExclusions,
		rules.GroupExcludedGroups,
		target,
	)
}

func (rules *CatalogVisibility) allowsModel(userID int, target string) bool {
	return rules.allowsResource(
		rules.Models,
		rules.ModelUsers,
		rules.OpenModels,
		rules.ModelExclusions,
		rules.ModelExcludedGroups,
		userID,
		target,
	)
}

func (rules *CatalogVisibility) hasModelRule(target string) bool {
	return hasResourceEntry(
		rules.Models,
		rules.ModelUsers,
		rules.OpenModels,
		rules.ModelExclusions,
		rules.ModelExcludedGroups,
		target,
	)
}

func modelRuleTargets(name string) [3]string {
	return [3]string{
		name,
		reasoning.BaseModelName(name),
		ratio_setting.RoutingMatchModelName(name),
	}
}

func CatalogGroupAllowed(userID int, target string) bool {
	rules := catalogVisibility.Load()
	if rules == nil {
		return true
	}
	return !rules.invalid && rules.allowsGroup(userID, target)
}

// CatalogGroupGranted reports whether target has an explicit CatalogVisibility
// rule that authorizes logged-in userID (cross-group access).
func CatalogGroupGranted(userID int, target string) bool {
	if userID <= 0 || target == "" || target == "auto" {
		return false
	}
	rules := catalogVisibility.Load()
	if rules == nil || rules.invalid || !rules.hasAnyGroupRules() {
		return false
	}
	return rules.hasGroupRule(target) && rules.allowsGroup(userID, target)
}

// CatalogPermittedGroups returns all routing group names explicitly granted to
// logged-in userID by CatalogVisibility rules.
func CatalogPermittedGroups(userID int) []string {
	if userID <= 0 {
		return nil
	}
	rules := catalogVisibility.Load()
	if rules == nil || rules.invalid || !rules.hasAnyGroupRules() {
		return nil
	}
	candidates := make(map[string]struct{})
	for name := range maps.Keys(rules.Groups) {
		candidates[name] = struct{}{}
	}
	for name := range maps.Keys(rules.GroupUsers) {
		candidates[name] = struct{}{}
	}
	for _, name := range rules.OpenGroups {
		candidates[name] = struct{}{}
	}
	for name := range maps.Keys(rules.GroupExclusions) {
		candidates[name] = struct{}{}
	}
	for name := range maps.Keys(rules.GroupExcludedGroups) {
		candidates[name] = struct{}{}
	}
	permitted := make([]string, 0, len(candidates))
	for name := range candidates {
		if name != "" && name != "auto" && rules.allowsGroup(userID, name) {
			permitted = append(permitted, name)
		}
	}
	slices.Sort(permitted)
	return permitted
}

func CatalogModelAllowed(userID int, name string) bool {
	rules := catalogVisibility.Load()
	if rules == nil {
		return true
	}
	if rules.invalid || !rules.hasAnyModelRules() {
		return !rules.invalid
	}
	for _, target := range modelRuleTargets(name) {
		if !rules.allowsModel(userID, target) {
			return false
		}
	}
	return true
}

// CatalogModelGranted reports whether name (or its base/routing model name) has
// an explicit CatalogVisibility rule that authorizes logged-in userID.
func CatalogModelGranted(userID int, name string) bool {
	if userID <= 0 || name == "" {
		return false
	}
	rules := catalogVisibility.Load()
	if rules == nil || rules.invalid || !rules.hasAnyModelRules() {
		return false
	}
	hasRule := false
	for _, target := range modelRuleTargets(name) {
		if !rules.allowsModel(userID, target) {
			return false
		}
		if rules.hasModelRule(target) {
			hasRule = true
		}
	}
	return hasRule
}
