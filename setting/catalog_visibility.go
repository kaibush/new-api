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
	invalid   bool
	Audiences map[string][]int    `json:"audiences"`
	Models    map[string][]string `json:"models"`
	Groups    map[string][]string `json:"groups"`
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
	return rules != nil && (rules.invalid || len(rules.Models)+len(rules.Groups) > 0)
}

func (rules *CatalogVisibility) allows(resources map[string][]string, userID int, target string) bool {
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
	return !rules.invalid && rules.allows(rules.Groups, userID, target)
}

func CatalogModelAllowed(userID int, name string) bool {
	rules := catalogVisibility.Load()
	if rules == nil {
		return true
	}
	if rules.invalid || len(rules.Models) == 0 {
		return !rules.invalid
	}
	for _, target := range []string{name, reasoning.BaseModelName(name), ratio_setting.RoutingMatchModelName(name)} {
		if !rules.allows(rules.Models, userID, target) {
			return false
		}
	}
	return true
}
