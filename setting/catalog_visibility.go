package setting

import (
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/reasoning"
)

const CatalogVisibilityKey = "CatalogVisibility"

type CatalogVisibility struct {
	invalid         bool
	Audiences       map[string][]int    `json:"audiences"`
	Models          map[string][]string `json:"models"`
	Groups          map[string][]string `json:"groups"`
	ModelExclusions catalogExclusions   `json:"model_exclusions,omitempty"`
	GroupExclusions catalogExclusions   `json:"group_exclusions,omitempty"`
}

type catalogExclusions map[string][]int

func (exclusions *catalogExclusions) UnmarshalJSON(data []byte) error {
	var entries map[string][]int
	if err := json.Unmarshal(data, &entries); err != nil {
		return err
	}
	if entries == nil {
		return errors.New("expected a map of catalog exclusions")
	}
	for name, ids := range entries {
		if name == "" || strings.TrimSpace(name) != name || len(ids) == 0 || slices.ContainsFunc(ids, func(id int) bool { return id <= 0 }) {
			return errors.New("invalid resource or excluded account IDs")
		}
		slices.Sort(ids)
		entries[name] = slices.Compact(ids)
	}
	*exclusions = entries
	return nil
}

var catalogVisibility atomic.Pointer[CatalogVisibility]

func ParseCatalogVisibility(raw string) (*CatalogVisibility, error) {
	var rules CatalogVisibility
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&rules); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF || rules.Models == nil || rules.Groups == nil || rules.Audiences == nil {
		return nil, errors.New("expected audiences, models and groups visibility maps")
	}
	for name, ids := range rules.Audiences {
		if name == "" || strings.TrimSpace(name) != name || ids == nil || slices.ContainsFunc(ids, func(id int) bool { return id <= 0 }) {
			return nil, errors.New("invalid permission group or member ID")
		}
		slices.Sort(ids)
	}
	for _, resources := range []map[string][]string{rules.Models, rules.Groups} {
		for name, members := range resources {
			if name == "" || strings.TrimSpace(name) != name || members == nil {
				return nil, errors.New("invalid visibility rule")
			}
			for _, member := range members {
				if _, exists := rules.Audiences[member]; !exists {
					return nil, errors.New("invalid visibility audience")
				}
			}
		}
	}
	return &rules, nil
}

func UpdateCatalogVisibility(raw string) error {
	rules, err := ParseCatalogVisibility(raw)
	if err != nil {
		rules = &CatalogVisibility{invalid: true}
	}
	catalogVisibility.Store(rules)
	return err
}

func HasCatalogRestrictions() bool {
	rules := catalogVisibility.Load()
	return rules != nil && (rules.invalid || len(rules.Models)+len(rules.Groups)+len(rules.ModelExclusions)+len(rules.GroupExclusions) > 0)
}

func (rules *CatalogVisibility) allows(resources map[string][]string, exclusions catalogExclusions, userID int, target string) bool {
	if ids, restricted := exclusions[target]; restricted {
		if userID <= 0 {
			return false
		}
		if _, denied := slices.BinarySearch(ids, userID); denied {
			return false
		}
	}
	audiences, restricted := resources[target]
	if !restricted {
		return true
	}
	for _, audience := range audiences {
		if _, found := slices.BinarySearch(rules.Audiences[audience], userID); found {
			return true
		}
	}
	return false
}

func CatalogGroupAllowed(userID int, target string) bool {
	rules := catalogVisibility.Load()
	if rules == nil {
		return true
	}
	return !rules.invalid && rules.allows(rules.Groups, rules.GroupExclusions, userID, target)
}

func CatalogModelAllowed(userID int, name string) bool {
	rules := catalogVisibility.Load()
	if rules == nil {
		return true
	}
	if rules.invalid || len(rules.Models)+len(rules.ModelExclusions) == 0 {
		return !rules.invalid
	}
	for _, target := range []string{name, reasoning.BaseModelName(name), ratio_setting.RoutingMatchModelName(name)} {
		if !rules.allows(rules.Models, rules.ModelExclusions, userID, target) {
			return false
		}
	}
	return true
}
