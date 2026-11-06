package setting

import (
	"fmt"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	"github.com/QuantumNous/new-api/setting/config"
)

const ErrorFilterOptionKey = "error_filter.config"

var errorFilterSettings struct {
	Config string `json:"config"`
}

func init() {
	data, _ := common.Marshal(errorfilter.Defaults())
	errorFilterSettings.Config = string(data)
	config.GlobalConfig.Register("error_filter", &errorFilterSettings)
}

// ErrorFilterConfig reads the single, atomically saved policy under the same
// lock that protects updates from the options store.
func ErrorFilterConfig() string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return errorFilterSettings.Config
}

func ParseErrorFilter(raw string) (errorfilter.Config, *errorfilter.Policy, error) {
	cfg := errorfilter.Defaults()
	if len(raw) > errorfilter.MaxConfigBytes {
		return cfg, nil, fmt.Errorf("error filter configuration exceeds 256 KiB")
	}
	var object map[string]common.RawMessage
	if err := common.UnmarshalJsonStr(raw, &object); err != nil || object == nil {
		return cfg, nil, fmt.Errorf("error filter configuration must be a JSON object")
	}
	for key, value := range object {
		if !slices.Contains([]string{"enabled", "fallback", "fallback_message", "strip_details", "remove_headers", "rules"}, key) || string(value) == "null" {
			return cfg, nil, fmt.Errorf("invalid error filter property: %s", key)
		}
	}
	if rawRules, ok := object["rules"]; ok {
		var rules []map[string]common.RawMessage
		if err := common.Unmarshal(rawRules, &rules); err != nil {
			return cfg, nil, fmt.Errorf("rules must be an array of objects")
		}
		for i, rule := range rules {
			for key := range rule {
				if !slices.Contains([]string{"name", "enabled", "channels", "model_pattern", "statuses", "field", "match", "pattern", "case_sensitive", "action", "replacement", "output_type", "output_code"}, key) {
					return cfg, nil, fmt.Errorf("rule %d: unknown property %s", i+1, key)
				}
			}
		}
	}
	if err := common.UnmarshalJsonStr(raw, &cfg); err != nil {
		return cfg, nil, fmt.Errorf("invalid error filter configuration: %w", err)
	}
	p, err := errorfilter.Compile(cfg)
	return cfg, p, err
}
