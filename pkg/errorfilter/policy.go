// Package errorfilter rewrites public error messages without changing routing,
// retries, HTTP status codes, or the upstream error used for diagnosis.
package errorfilter

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	MaxConfigBytes = 256 << 10
	MaxErrorBytes  = 1 << 20
	DefaultMessage = "The request could not be completed. Please try again later."
)

type Config struct {
	Enabled         bool     `json:"enabled"`
	Fallback        string   `json:"fallback"`
	FallbackMessage string   `json:"fallback_message"`
	StripDetails    bool     `json:"strip_details"`
	RemoveHeaders   []string `json:"remove_headers"`
	Rules           []Rule   `json:"rules"`
}

type Rule struct {
	Name          string  `json:"name"`
	Enabled       bool    `json:"enabled"`
	Channels      []int   `json:"channels"`
	ModelPattern  string  `json:"model_pattern"`
	Statuses      string  `json:"statuses"`
	Field         string  `json:"field"`
	Match         string  `json:"match"`
	Pattern       string  `json:"pattern"`
	CaseSensitive bool    `json:"case_sensitive"`
	Action        string  `json:"action"`
	Replacement   string  `json:"replacement"`
	OutputType    *string `json:"output_type,omitempty"`
	OutputCode    *string `json:"output_code,omitempty"`
}

type Input struct {
	Message   string `json:"message"`
	Type      string `json:"type"`
	Code      string `json:"code"`
	Status    int    `json:"status"`
	ChannelID int    `json:"channel_id"`
	Model     string `json:"model"`
	RequestID string `json:"request_id"`
}

type Result struct {
	Input
	Rule         string `json:"rule"`
	Action       string `json:"action"`
	StripDetails bool   `json:"strip_details"`
	TypeChanged  bool   `json:"-"`
	CodeChanged  bool   `json:"-"`
}

type statusRange struct{ min, max int }
type compiledRule struct {
	rule     Rule
	pattern  *regexp.Regexp
	model    *regexp.Regexp
	statuses []statusRange
}

// Policy is immutable after compilation and can be shared by concurrent requests.
type Policy struct {
	config Config
	rules  []compiledRule
}

func Defaults() Config {
	return Config{Fallback: "preserve", FallbackMessage: DefaultMessage, StripDetails: true,
		RemoveHeaders: []string{"X-Magpie-*"}, Rules: []Rule{}}
}

func Compile(config Config) (*Policy, error) {
	config.RemoveHeaders = slices.Clone(config.RemoveHeaders)
	config.Rules = slices.Clone(config.Rules)
	for i := range config.Rules {
		r := &config.Rules[i]
		r.Channels = slices.Clone(r.Channels)
		if r.OutputType != nil {
			value := *r.OutputType
			r.OutputType = &value
		}
		if r.OutputCode != nil {
			value := *r.OutputCode
			r.OutputCode = &value
		}
	}
	if config.Fallback != "preserve" && config.Fallback != "replace" {
		return nil, fmt.Errorf("fallback must be preserve or replace")
	}
	if len(config.FallbackMessage) > 8192 || config.Fallback == "replace" && strings.TrimSpace(config.FallbackMessage) == "" {
		return nil, fmt.Errorf("fallback_message must contain 1 to 8192 bytes when replacing errors")
	}
	if len(config.Rules) > 100 || len(config.RemoveHeaders) > 32 {
		return nil, fmt.Errorf("at most 100 rules and 32 response header patterns are allowed")
	}
	headerPattern := regexp.MustCompile(`^[A-Za-z0-9-]+$`)
	for _, header := range config.RemoveHeaders {
		base := strings.TrimSuffix(header, "*")
		if len(header) > 128 || base == "" || !headerPattern.MatchString(base) {
			return nil, fmt.Errorf("invalid response header pattern: %q", header)
		}
		for _, protected := range []string{"Content-Type", "Content-Length", "Content-Encoding", "Transfer-Encoding", "Connection", "Retry-After", "X-Oneapi-Request-Id"} {
			if headerMatches(header, protected) {
				return nil, fmt.Errorf("response header pattern %q includes protected header %s", header, protected)
			}
		}
	}
	p := &Policy{config: config}
	for i, rule := range config.Rules {
		if strings.TrimSpace(rule.Name) == "" || len(rule.Name) > 128 {
			return nil, fmt.Errorf("rule %d: name must contain 1 to 128 bytes", i+1)
		}
		if len(rule.Pattern) > 2048 || len(rule.ModelPattern) > 2048 || len(rule.Replacement) > 8192 || len(rule.Channels) > 256 || len(rule.Statuses) > 1024 {
			return nil, fmt.Errorf("rule %d: pattern, replacement, or scope is too large", i+1)
		}
		if !slices.Contains([]string{"message", "type", "code"}, rule.Field) || !slices.Contains([]string{"any", "contains", "exact", "regex"}, rule.Match) {
			return nil, fmt.Errorf("rule %d: invalid match field or mode", i+1)
		}
		if !slices.Contains([]string{"preserve", "replace", "redact"}, rule.Action) {
			return nil, fmt.Errorf("rule %d: invalid action", i+1)
		}
		if rule.Action == "replace" && strings.TrimSpace(rule.Replacement) == "" {
			return nil, fmt.Errorf("rule %d: replacement message is required", i+1)
		}
		if rule.Action == "redact" && (rule.Field != "message" || rule.Match == "any") {
			return nil, fmt.Errorf("rule %d: partial replacement requires a message pattern", i+1)
		}
		for _, value := range []*string{rule.OutputType, rule.OutputCode} {
			if value != nil && (len(*value) > 128 || strings.ContainsAny(*value, "\r\n")) {
				return nil, fmt.Errorf("rule %d: output type or code is invalid", i+1)
			}
		}
		for _, channel := range rule.Channels {
			if channel <= 0 {
				return nil, fmt.Errorf("rule %d: channel IDs must be positive", i+1)
			}
		}
		compiled := compiledRule{rule: rule}
		if rule.Match != "any" {
			if rule.Pattern == "" {
				return nil, fmt.Errorf("rule %d: match pattern is required", i+1)
			}
			pattern := rule.Pattern
			if rule.Match != "regex" {
				pattern = regexp.QuoteMeta(pattern)
			}
			if rule.Match == "exact" {
				pattern = `\A(?:` + pattern + `)\z`
			}
			if !rule.CaseSensitive {
				pattern = "(?i)" + pattern
			}
			var err error
			compiled.pattern, err = regexp.Compile(pattern)
			if err != nil {
				return nil, fmt.Errorf("rule %d: invalid message pattern: %w", i+1, err)
			}
		}
		if rule.ModelPattern != "" {
			var err error
			compiled.model, err = regexp.Compile(rule.ModelPattern)
			if err != nil {
				return nil, fmt.Errorf("rule %d: invalid model pattern: %w", i+1, err)
			}
		}
		if strings.TrimSpace(rule.Statuses) != "" {
			for _, part := range strings.Split(rule.Statuses, ",") {
				lo, hi, ranged := strings.Cut(strings.TrimSpace(part), "-")
				min, err := strconv.Atoi(strings.TrimSpace(lo))
				if err != nil || min < 100 || min > 599 {
					return nil, fmt.Errorf("rule %d: invalid HTTP status range", i+1)
				}
				max := min
				if ranged {
					max, err = strconv.Atoi(strings.TrimSpace(hi))
					if err != nil || max < min || max > 599 {
						return nil, fmt.Errorf("rule %d: invalid HTTP status range", i+1)
					}
				}
				compiled.statuses = append(compiled.statuses, statusRange{min, max})
			}
		}
		p.rules = append(p.rules, compiled)
	}
	return p, nil
}

func (p *Policy) Enabled() bool { return p != nil && p.config.Enabled }

func (p *Policy) Apply(in Input) Result {
	result := Result{Input: in, Action: "preserve"}
	if !p.Enabled() {
		return result
	}
	for _, compiled := range p.rules {
		r := compiled.rule
		if !r.Enabled || len(r.Channels) > 0 && !slices.Contains(r.Channels, in.ChannelID) || compiled.model != nil && !compiled.model.MatchString(in.Model) {
			continue
		}
		if len(compiled.statuses) > 0 && !slices.ContainsFunc(compiled.statuses, func(s statusRange) bool { return in.Status >= s.min && in.Status <= s.max }) {
			continue
		}
		value := in.Message
		switch r.Field {
		case "type":
			value = in.Type
		case "code":
			value = in.Code
		}
		if compiled.pattern != nil && !compiled.pattern.MatchString(value) {
			continue
		}
		result.Rule, result.Action = r.Name, r.Action
		switch r.Action {
		case "replace":
			result.Message = r.Replacement
		case "redact":
			if r.Match == "regex" {
				result.Message = compiled.pattern.ReplaceAllString(in.Message, r.Replacement)
			} else {
				result.Message = compiled.pattern.ReplaceAllLiteralString(in.Message, r.Replacement)
			}
		}
		if r.Action != "preserve" {
			result.StripDetails = p.config.StripDetails
			if r.OutputType != nil {
				result.Type, result.TypeChanged = *r.OutputType, true
			}
			if r.OutputCode != nil {
				result.Code, result.CodeChanged = *r.OutputCode, true
			}
			result.Message = expandMessage(result.Message, in)
		}
		return result
	}
	result.Action = p.config.Fallback
	if result.Action == "replace" {
		result.Message = expandMessage(p.config.FallbackMessage, in)
		result.StripDetails = p.config.StripDetails
	}
	return result
}

func expandMessage(message string, in Input) string {
	return strings.NewReplacer("{status}", strconv.Itoa(in.Status), "{request_id}", in.RequestID).Replace(message)
}

func headerMatches(pattern, header string) bool {
	pattern, header = strings.ToLower(pattern), strings.ToLower(header)
	if prefix, ok := strings.CutSuffix(pattern, "*"); ok {
		return strings.HasPrefix(header, prefix)
	}
	return pattern == header
}

func (p *Policy) FilterHeaders(headers http.Header) {
	if !p.Enabled() {
		return
	}
	for header := range headers {
		for _, pattern := range p.config.RemoveHeaders {
			if headerMatches(pattern, header) {
				delete(headers, header)
				break
			}
		}
	}
}
