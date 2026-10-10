package helpcenter

import (
	_ "embed"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const OptionKey = "HelpCenter"
const MaxConfigBytes = 2 * 1024 * 1024

//go:embed default.json
var DefaultJSON string

var itemID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type Item struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
	Enabled bool   `json:"enabled"`
	// Omitted in existing configurations, which allow both HTML views.
	HTMLViewMode string `json:"htmlViewMode,omitempty"`
}

type Config struct {
	Version int    `json:"version"`
	Items   []Item `json:"items"`
}

// Parse validates the public, ordered help content before it is persisted.
func Parse(raw string) (Config, error) {
	var config Config
	if len(raw) > MaxConfigBytes {
		return config, fmt.Errorf("help center configuration exceeds 2 MiB")
	}
	if err := common.UnmarshalJsonStr(raw, &config); err != nil {
		return config, fmt.Errorf("invalid help center JSON: %w", err)
	}
	if config.Version != 1 || config.Items == nil || len(config.Items) > 100 {
		return config, fmt.Errorf("help center requires version 1 and at most 100 items")
	}
	seen := make(map[string]bool)
	for _, item := range config.Items {
		if !itemID.MatchString(item.ID) || seen[item.ID] {
			return config, fmt.Errorf("help center item IDs must be unique letters, digits, underscores or hyphens (1–64 characters)")
		}
		seen[item.ID] = true
		switch item.HTMLViewMode {
		case "", "preview", "split", "both":
		default:
			return config, fmt.Errorf("unsupported help center HTML view mode: %s", item.HTMLViewMode)
		}
		if strings.TrimSpace(item.Title) == "" || len([]rune(item.Title)) > 120 {
			return config, fmt.Errorf("help center item titles must contain 1–120 characters")
		}
		switch item.Kind {
		case "markdown", "html":
		case "link":
			u, err := url.Parse(item.Content)
			if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
				return config, fmt.Errorf("help center links must be HTTP(S) URLs without credentials")
			}
		default:
			return config, fmt.Errorf("unsupported help center item kind: %s", item.Kind)
		}
	}
	return config, nil
}
