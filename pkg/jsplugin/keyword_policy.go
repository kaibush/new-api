package jsplugin

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/MoeForge/moejs"
	"github.com/QuantumNous/new-api/common"
	"github.com/tidwall/gjson"
)

const CapabilityKeywordPolicy = "keyword-policy@1"

// Bounds apply to the compiled policy and work at hits, never to the amount
// of text examined. Exhausting the hit budget is a failure, not a clean result.
const (
	maxPolicyRunes  = 256
	maxPolicyNodes  = 65536
	maxPolicyChecks = 100000
)

type keywordPolicyRule struct {
	ID            string `json:"id"`
	Keywords      string `json:"keywords"`
	Exceptions    string `json:"exceptions"`
	Before        string `json:"before"`
	After         string `json:"after"`
	Context       string `json:"context"`
	Window        int    `json:"window"`
	CaseSensitive bool   `json:"caseSensitive"`
}

type policyRule struct {
	keywordPolicyRule
	exceptions []string
	checks     [3]*regexp.Regexp
}

type policyException struct {
	before, after int
	phrase        string
}

type policyTerm struct {
	rule, length int
	word         string
	exceptions   []policyException
}
type policyNode struct {
	next         map[rune]int
	fail, output int
	terms        []policyTerm
}
type keywordPolicy struct {
	nodes []policyNode
	rules []policyRule
}
type policyHit struct {
	RuleID   string                  `json:"ruleId"`
	Start    int                     `json:"start"`
	End      int                     `json:"end"`
	Evidence *TransformMatchEvidence `json:"evidence,omitempty"`
}

// Policy compilation is bounded and shared across runtimes and option reloads.
// No request strings or results are retained in this cache.
var policyCache = struct {
	sync.Mutex
	items map[[32]byte]*keywordPolicy
	order [][32]byte
}{items: make(map[[32]byte]*keywordPolicy)}

func compileKeywordPolicy(raw []byte) (*keywordPolicy, error) {
	if len(raw) > 256<<10 {
		return nil, fmt.Errorf("keyword policy exceeds 256 KiB")
	}
	if !gjson.ValidBytes(raw) || !gjson.ParseBytes(raw).IsArray() {
		return nil, fmt.Errorf("keyword policy must be an array of rules")
	}
	var rules []keywordPolicyRule
	if err := common.Unmarshal(raw, &rules); err != nil {
		return nil, fmt.Errorf("keyword policy must be an array of rules")
	}
	if len(rules) > 128 {
		return nil, fmt.Errorf("keyword policy exceeds 128 rules")
	}
	p := &keywordPolicy{nodes: []policyNode{{next: make(map[rune]int)}}}
	ids := make(map[string]bool)
	terms, alignments := 0, 0
	compilationBudget := 4 << 20
	for index, rule := range rules {
		if rule.ID == "" {
			rule.ID = fmt.Sprintf("rule-%d", index+1)
		}
		if utf8.RuneCountInString(rule.ID) > 256 || ids[rule.ID] {
			return nil, fmt.Errorf("keyword policy rule IDs must be unique and at most 256 characters")
		}
		ids[rule.ID] = true
		if rule.Window == 0 {
			rule.Window = 64
		}
		if rule.Window < 1 || rule.Window > 1024 {
			return nil, fmt.Errorf("rule %s window must be 1 to 1024 characters", rule.ID)
		}
		compiled := policyRule{keywordPolicyRule: rule}
		for i, source := range []string{rule.Before, rule.After, rule.Context} {
			if len(source) > 1024 {
				return nil, fmt.Errorf("rule %s regular expression exceeds 1024 bytes", rule.ID)
			}
			if source == "" {
				continue
			}
			if !rule.CaseSensitive {
				source = "(?i)" + source
			}
			rx, err := regexp.Compile(source)
			if err != nil {
				return nil, fmt.Errorf("rule %s has an invalid RE2 expression: %w", rule.ID, err)
			}
			compiled.checks[i] = rx
		}
		for exception := range strings.SplitSeq(rule.Exceptions, "\n") {
			exception = strings.TrimSpace(exception)
			if exception == "" {
				continue
			}
			if utf8.RuneCountInString(exception) > maxPolicyRunes {
				return nil, fmt.Errorf("rule %s exception exceeds 256 characters", rule.ID)
			}
			compiled.exceptions = append(compiled.exceptions, exception)
			if len(compiled.exceptions) > 64 {
				return nil, fmt.Errorf("rule %s exceeds 64 exceptions", rule.ID)
			}
		}
		p.rules = append(p.rules, compiled)
		seen := make(map[string]bool)
		for word := range strings.SplitSeq(rule.Keywords, "\n") {
			word = strings.TrimSpace(word)
			if word == "" {
				continue
			}
			folded := strings.Map(unicode.ToLower, word)
			dedup := folded
			if rule.CaseSensitive {
				dedup = word
			}
			if seen[dedup] {
				continue
			}
			seen[dedup] = true
			length := utf8.RuneCountInString(word)
			if length > maxPolicyRunes {
				return nil, fmt.Errorf("rule %s keyword exceeds 256 characters", rule.ID)
			}
			terms++
			if terms > 4096 {
				return nil, fmt.Errorf("keyword policy exceeds 4096 keywords")
			}
			state := 0
			for _, char := range folded {
				next, exists := p.nodes[state].next[char]
				if !exists {
					if len(p.nodes) == maxPolicyNodes {
						return nil, fmt.Errorf("keyword policy exceeds its automaton size limit")
					}
					next = len(p.nodes)
					p.nodes[state].next[char] = next
					p.nodes = append(p.nodes, policyNode{next: make(map[rune]int)})
				}
				state = next
			}
			term := policyTerm{rule: index, length: length, word: word}
			needle := []rune(folded)
			for _, exception := range compiled.exceptions {
				hay := []rune(strings.Map(unicode.ToLower, exception))
				for at := 0; at+length <= len(hay); at++ {
					compilationBudget -= length
					if compilationBudget < 0 {
						return nil, fmt.Errorf("keyword policy exception compilation budget exceeded")
					}
					if !slices.Equal(hay[at:at+length], needle) {
						continue
					}
					alignments++
					if alignments > 65536 {
						return nil, fmt.Errorf("keyword policy exceeds its exception alignment limit")
					}
					term.exceptions = append(term.exceptions, policyException{before: at, after: len(hay) - at - length, phrase: exception})
				}
			}
			p.nodes[state].terms = append(p.nodes[state].terms, term)
		}
		if len(seen) == 0 {
			return nil, fmt.Errorf("rule %s needs at least one keyword", rule.ID)
		}
	}
	queue := make([]int, 0, len(p.nodes))
	for _, child := range p.nodes[0].next {
		queue = append(queue, child)
	}
	for head := 0; head < len(queue); head++ {
		state := queue[head]
		for char, child := range p.nodes[state].next {
			queue = append(queue, child)
			failure := p.nodes[state].fail
			for failure != 0 && p.nodes[failure].next[char] == 0 {
				failure = p.nodes[failure].fail
			}
			p.nodes[child].fail = p.nodes[failure].next[char]
			output := p.nodes[child].fail
			if len(p.nodes[output].terms) == 0 {
				output = p.nodes[output].output
			}
			p.nodes[child].output = output
		}
	}
	return p, nil
}

// match walks the complete input once, with constant request scratch space.
// Offsets refer to original UTF-8 bytes, even when Unicode case folding changes
// byte length. All exceptions must contain the particular keyword occurrence.
func (p *keywordPolicy) match(ctx context.Context, text string, budget *int) (*policyHit, error) {
	if len(p.rules) == 0 {
		return nil, ctx.Err()
	}
	var starts [maxPolicyRunes]int
	state, count, checked := 0, 0, -4096
	for offset, char := range text {
		if offset-checked >= 4096 {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			checked = offset
		}
		starts[count%maxPolicyRunes] = offset
		count++
		char = unicode.ToLower(char)
		for state != 0 && p.nodes[state].next[char] == 0 {
			state = p.nodes[state].fail
		}
		state = p.nodes[state].next[char]
		var decisive *policyHit
		best := len(p.rules)
		for node := state; node != 0; node = p.nodes[node].output {
			for _, term := range p.nodes[node].terms {
				*budget--
				if *budget < 0 {
					return nil, fmt.Errorf("keyword policy candidate budget exceeded")
				}
				if term.rule >= best {
					continue
				}
				start := starts[(count-term.length)%maxPolicyRunes]
				_, size := utf8.DecodeRuneInString(text[offset:])
				end := offset + size
				rule := &p.rules[term.rule]
				if rule.CaseSensitive && text[start:end] != term.word {
					continue
				}
				accepted, err := rule.accepts(ctx, text, start, end, term.exceptions)
				if err != nil {
					return nil, err
				}
				if !accepted {
					continue
				}
				best = term.rule
				decisive = &policyHit{RuleID: rule.ID, Start: start, End: end}
			}
		}
		if decisive != nil {
			return decisive, nil
		}
	}
	return nil, ctx.Err()
}

func (rule *policyRule) accepts(ctx context.Context, text string, start, end int, exceptions []policyException) (bool, error) {
	for _, exception := range exceptions {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		left, right := start, end
		for range exception.before {
			if left == 0 {
				left = -1
				break
			}
			_, n := utf8.DecodeLastRuneInString(text[:left])
			left -= n
		}
		if left < 0 {
			continue
		}
		for range exception.after {
			if right == len(text) {
				right = -1
				break
			}
			_, n := utf8.DecodeRuneInString(text[right:])
			right += n
		}
		if right < 0 {
			continue
		}
		if text[left:right] == exception.phrase || !rule.CaseSensitive && strings.EqualFold(text[left:right], exception.phrase) {
			return false, nil
		}
	}
	if rule.Before == "" && rule.After == "" && rule.Context == "" {
		return true, ctx.Err()
	}
	left, right := start, end
	for range rule.Window {
		if left > 0 {
			_, n := utf8.DecodeLastRuneInString(text[:left])
			left -= n
		}
		if right < len(text) {
			_, n := utf8.DecodeRuneInString(text[right:])
			right += n
		}
	}

	for i, part := range []string{text[left:start], text[end:right], text[left:right]} {
		if rule.checks[i] != nil && !rule.checks[i].MatchString(part) {
			return false, nil
		}
	}
	return true, nil
}

func (c *runtimeCall) keywordPolicy(r *moejs.Realm, fieldArg, textArg moejs.Value) (moejs.Value, error) {
	if c.transform == nil {
		return moejs.Undefined(), fmt.Errorf("utils.keywordPolicy is available in request processing hooks only")
	}
	field, err := stringValue(r, fieldArg)
	if err != nil {
		return moejs.Undefined(), err
	}
	plan := c.policyPlans[field]
	if plan == nil {
		value := gjson.GetBytes(c.transform.Config, gjson.Escape(field))
		if !value.IsArray() {
			return moejs.Undefined(), fmt.Errorf("utils.keywordPolicy field must be a rule array")
		}
		raw := []byte(value.Raw)
		hash := sha256.Sum256(raw)
		policyCache.Lock()
		plan = policyCache.items[hash]
		if plan == nil {
			plan, err = compileKeywordPolicy(raw)
			if err == nil {
				if len(policyCache.order) == 8 {
					delete(policyCache.items, policyCache.order[0])
					policyCache.order = policyCache.order[1:]
				}
				policyCache.items[hash] = plan
				policyCache.order = append(policyCache.order, hash)
			}
		}
		policyCache.Unlock()
		if err != nil {
			return moejs.Undefined(), err
		}
		if c.policyPlans == nil {
			c.policyPlans = make(map[string]*keywordPolicy)
		}
		c.policyPlans[field] = plan
	}
	if !textArg.IsString() {
		return moejs.Undefined(), r.TypeError("utils.keywordPolicy text must be a string")
	}
	text := textArg.AsString().GoString()
	// Native work consumes the same deadline as the rest of the hook.
	// Starting a fresh timer here would renew it for every text leaf.
	ctx := c.ctx
	if c.watchdog != nil {
		ctx = c.watchdog.watch
	}
	if c.policyBudget == nil {
		budget := maxPolicyChecks
		c.policyBudget = &budget
	}
	hit, err := plan.match(ctx, text, c.policyBudget)
	if err != nil {
		if ctx.Err() != nil {
			return moejs.Undefined(), &moejs.InterruptedError{Value: context.Cause(ctx)}
		}
		return moejs.Undefined(), err
	}
	if hit == nil {
		return moejs.Null(), nil
	}
	if c.transform.CaptureEvidence {
		left, right := hit.Start, hit.End
		for range 300 {
			if left > 0 {
				_, n := utf8.DecodeLastRuneInString(text[:left])
				left -= n
			}
			if right < len(text) {
				_, n := utf8.DecodeRuneInString(text[right:])
				right += n
			}
		}
		hit.Evidence = &TransformMatchEvidence{Method: "keyword", Representation: "original", Before: text[left:hit.Start], Match: text[hit.Start:hit.End], After: text[hit.End:right], Truncated: left > 0 || right < len(text)}
	}
	return r.FromGo(hit)
}

func validateKeywordPolicy(r *moejs.Realm, argument moejs.Value) (moejs.Value, error) {
	value, err := r.ToGoStrict(argument)
	if err != nil {
		return moejs.Undefined(), err
	}
	raw, err := common.Marshal(value)
	if err != nil {
		return moejs.Undefined(), err
	}
	_, err = compileKeywordPolicy(raw)
	return moejs.Undefined(), err
}
