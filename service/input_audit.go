package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

type inputAuditKey struct {
	user int
	hash string
}

type InputAuditRecorder struct {
	db       *gorm.DB
	settings atomic.Pointer[model.InputAuditSettings]
	queue    chan model.InputAudit
	mu       sync.Mutex
	configMu sync.Mutex
	seen     map[inputAuditKey]int64
	ring     []inputAuditKey
	next     int
	closed   bool
	cancel   context.CancelFunc
	done     chan struct{}
	dropped  atomic.Uint64
	failures atomic.Uint64
}

var inputAuditRecorder atomic.Pointer[InputAuditRecorder]

func NewInputAuditRecorder(db *gorm.DB) (*InputAuditRecorder, error) {
	settings, err := model.LoadInputAuditSettings(db)
	if err != nil {
		return nil, err
	}
	r := &InputAuditRecorder{db: db, queue: make(chan model.InputAudit, 1024), seen: make(map[inputAuditKey]int64), ring: make([]inputAuditKey, 8192), done: make(chan struct{})}
	r.settings.Store(&settings)
	return r, nil
}

func CurrentInputAuditRecorder() *InputAuditRecorder {
	return inputAuditRecorder.Load()
}

func StartInputAuditRecorder() error {
	r, err := NewInputAuditRecorder(model.DB)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	inputAuditRecorder.Store(r)
	go r.Run(ctx)
	return nil
}

func StopInputAuditRecorder(ctx context.Context) {
	r := inputAuditRecorder.Load()
	if r == nil {
		return
	}
	r.mu.Lock()
	r.closed = true
	r.mu.Unlock()
	r.cancel()
	select {
	case <-r.done:
	case <-ctx.Done():
		common.SysError("input audit shutdown timed out")
	}
}

type InputAuditStatus struct {
	Settings      model.InputAuditSettings `json:"settings"`
	Pending       int                      `json:"pending"`
	Dropped       uint64                   `json:"dropped"`
	WriteFailures uint64                   `json:"write_failures"`
}

func (r *InputAuditRecorder) Status() InputAuditStatus {
	return InputAuditStatus{Settings: *r.settings.Load(), Pending: len(r.queue), Dropped: r.dropped.Load(), WriteFailures: r.failures.Load()}
}

func (r *InputAuditRecorder) UpdateSettings(ctx context.Context, settings model.InputAuditSettings) error {
	r.configMu.Lock()
	defer r.configMu.Unlock()
	if err := model.SaveInputAuditSettings(r.db.WithContext(ctx), settings); err != nil {
		return err
	}
	r.applySettings(settings)
	return nil
}

func (r *InputAuditRecorder) applySettings(settings model.InputAuditSettings) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.settings.Load().Enabled != settings.Enabled {
		// Inputs deliberately discarded while disabled must not suppress
		// their first capture after collection is enabled again.
		clear(r.seen)
		clear(r.ring)
		r.next = 0
	}
	r.settings.Store(&settings)
}

// Capture runs once before channel retries. It never queries a database or
// Redis, launches a goroutine, or retains the request/context in the queue.
func (r *InputAuditRecorder) Capture(c *gin.Context, request any) {
	settings := r.settings.Load()
	if !settings.Enabled {
		return
	}
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	if userId <= 0 {
		return
	}
	texts := inputAuditUserTexts(request)
	if len(texts) == 0 {
		return
	}
	hash, chars := inputAuditFingerprint(texts)
	if chars == 0 {
		return
	}
	now := time.Now().Unix()
	key := inputAuditKey{user: userId, hash: hash}
	r.mu.Lock()
	savedAt, found := r.seen[key]
	closed := r.closed
	r.mu.Unlock()
	if closed || (found && now-savedAt < 300) {
		return
	}
	entry := inputAuditPreview(texts, hash, chars, settings.MaxChars)
	entry.UserId = userId
	entry.CreatedAt = now
	entry.Username = boundedAuditText(common.GetContextKeyString(c, constant.ContextKeyUserName), 64)
	entry.TokenId = common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	entry.Model = boundedAuditText(common.GetContextKeyString(c, constant.ContextKeyOriginalModel), 255)
	entry.RequestId = boundedAuditText(c.GetString(common.RequestIdKey), 64)
	entry.Route = boundedAuditText(c.FullPath(), 255)
	entry.Ip = boundedAuditText(c.ClientIP(), 64)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if savedAt, found := r.seen[key]; found && now-savedAt < 300 {
		return
	}
	select {
	case r.queue <- *entry:
		delete(r.seen, r.ring[r.next])
		r.ring[r.next] = key
		r.next = (r.next + 1) % len(r.ring)
		r.seen[key] = now
	default:
		r.dropped.Add(1)
	}
}

func boundedAuditText(text string, limit int) string {
	end := 0
	for range limit {
		if end == len(text) {
			break
		}
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	return strings.Clone(text[:end])
}

// ExtractInputAudit selects the latest textual user input, ignoring system,
// assistant, tool results and media payloads. Short inputs are saved in full;
// long ones retain both the beginning and end. Hashing uses all selected text,
// so two inputs with the same stored preview remain distinct.
func ExtractInputAudit(request any, maxChars int) *model.InputAudit {
	texts := inputAuditUserTexts(request)
	if len(texts) == 0 || maxChars < 1 {
		return nil
	}
	hash, chars := inputAuditFingerprint(texts)
	if chars == 0 {
		return nil
	}
	return inputAuditPreview(texts, hash, chars, maxChars)
}

func inputAuditUserTexts(request any) []string {
	var texts []string
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role == "user" {
				texts = inputAuditTextParts(req.Messages[i].Content)
				if len(texts) > 0 {
					break
				}
			}
		}
		if len(req.Messages) == 0 {
			texts = inputAuditTextParts(req.Prompt)
		}
	case *dto.ClaudeRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role == "user" {
				texts = inputAuditTextParts(req.Messages[i].Content)
				if len(texts) > 0 {
					break
				}
			}
		}
		if len(req.Messages) == 0 && req.Prompt != "" {
			texts = []string{req.Prompt}
		}
	case *dto.GeminiChatRequest:
		for i := len(req.Contents) - 1; i >= 0; i-- {
			if req.Contents[i].Role != "user" && req.Contents[i].Role != "" {
				continue
			}
			for _, part := range req.Contents[i].Parts {
				if part.Text != "" && !part.Thought && part.FunctionResponse == nil && part.FunctionCall == nil {
					texts = append(texts, part.Text)
				}
			}
			if len(texts) > 0 {
				break
			}
		}
	case *dto.OpenAIResponsesRequest:
		var input gjson.Result
		if common.GetJsonType(req.Input) == "string" {
			input = gjson.ParseBytes(req.Input)
		} else {
			// Query bytes directly: tool-only continuation requests must not
			// allocate another copy of their potentially large tool outputs.
			input = gjson.GetBytes(req.Input, "#(role==user)#")
		}
		if input.Type == gjson.String {
			texts = []string{input.Str}
		} else {
			input.ForEach(func(_, item gjson.Result) bool {
				if item.Get("role").Str != "user" {
					return true
				}
				content := item.Get("content")
				parts := []string{}
				if content.Type == gjson.String && content.Str != "" {
					parts = append(parts, content.Str)
				} else {
					content.ForEach(func(_, part gjson.Result) bool {
						kind := part.Get("type").Str
						if kind == "input_text" || kind == "text" {
							if text := part.Get("text").Str; text != "" {
								parts = append(parts, text)
							}
						}
						return true
					})
				}
				if len(parts) > 0 {
					texts = parts
				}
				return true
			})
		}
	}
	return texts
}

func inputAuditFingerprint(texts []string) (string, int) {
	digest := sha256.New()
	var scratch [4096]byte
	chars := 0
	for i, text := range texts {
		if i > 0 {
			digest.Write([]byte{'\n'})
			chars++
		}
		chars += utf8.RuneCountInString(text)
		for len(text) > 0 {
			n := copy(scratch[:], text)
			digest.Write(scratch[:n])
			text = text[n:]
		}
	}
	return hex.EncodeToString(digest.Sum(nil)), chars
}

func inputAuditPreview(texts []string, hash string, chars, maxChars int) *model.InputAudit {
	entry := &model.InputAudit{ContentHash: hash, ContentChars: chars, Truncated: chars > maxChars}
	// Only the retained portion is allocated; never join the entire input.
	headLimit := maxChars
	tailLimit := 0
	if entry.Truncated {
		tailLimit = maxChars / 4
		headLimit -= tailLimit + 1 // Reserve one character for the ellipsis.
	}
	var head strings.Builder
	remaining := headLimit
	for i, text := range texts {
		if i > 0 && remaining > 0 {
			head.WriteByte('\n')
			remaining--
		}
		for _, char := range text {
			if remaining == 0 {
				break
			}
			// PostgreSQL TEXT cannot contain NUL; retain a visible marker
			// while the fingerprint continues to identify the original input.
			if char == 0 {
				char = '␀'
			}
			head.WriteRune(char)
			remaining--
		}
		if remaining == 0 {
			break
		}
	}
	if entry.Truncated {
		tail := make([]rune, 0, tailLimit)
		for i := len(texts) - 1; i >= 0 && len(tail) < tailLimit; i-- {
			text := texts[i]
			for len(text) > 0 && len(tail) < tailLimit {
				char, size := utf8.DecodeLastRuneInString(text)
				if char == 0 {
					char = '␀'
				}
				tail = append(tail, char)
				text = text[:len(text)-size]
			}
			if i > 0 && len(tail) < tailLimit {
				tail = append(tail, '\n')
			}
		}
		head.WriteRune('…')
		for i := len(tail) - 1; i >= 0; i-- {
			head.WriteRune(tail[i])
		}
	}
	entry.Content = head.String()
	return entry
}

func inputAuditTextParts(content any) []string {
	if text, ok := content.(string); ok && text != "" {
		return []string{text}
	}
	parts := []string{}
	switch blocks := content.(type) {
	case []any:
		for _, block := range blocks {
			if value, ok := block.(map[string]any); ok && (value["type"] == "text" || value["type"] == "input_text") {
				if text, ok := value["text"].(string); ok && text != "" {
					parts = append(parts, text)
				}
			}
		}
	case []dto.MediaContent:
		for _, block := range blocks {
			if (block.Type == "text" || block.Type == "input_text") && block.Text != "" {
				parts = append(parts, block.Text)
			}
		}
	}
	return parts
}

func (r *InputAuditRecorder) Run(ctx context.Context) {
	defer close(r.done)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	lastSync := time.Time{}
	lastCleanup := time.Time{}
	for {
		select {
		case <-ctx.Done():
			drainCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			for len(r.queue) > 0 && drainCtx.Err() == nil {
				r.Flush(drainCtx)
			}
			return
		case now := <-tick.C:
			if ctx.Err() != nil {
				continue
			}
			if now.Sub(lastSync) >= 30*time.Second {
				r.configMu.Lock()
				settings, err := model.LoadInputAuditSettings(r.db.WithContext(ctx))
				if err == nil {
					r.applySettings(settings)
				} else {
					common.SysError("input audit settings refresh failed: " + err.Error())
				}
				r.configMu.Unlock()
				lastSync = now
			}
			if ctx.Err() != nil {
				continue
			}
			if len(r.queue) > 0 || now.Sub(lastCleanup) >= time.Minute {
				writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				r.Flush(writeCtx)
				cancel()
				lastCleanup = now
			}
		}
	}
}

// Flush is also used during graceful shutdown. Persistent failures release
// cached keys, allowing subsequent requests to retry recording the input.
func (r *InputAuditRecorder) Flush(ctx context.Context) {
	batch := make([]model.InputAudit, 0, 100)
	for range 100 {
		select {
		case entry := <-r.queue:
			batch = append(batch, entry)
		default:
		}
	}
	if err := model.PersistInputAudits(r.db.WithContext(ctx), batch, time.Now().Unix()); err != nil {
		r.failures.Add(1)
		r.dropped.Add(uint64(len(batch)))
		r.mu.Lock()
		for _, entry := range batch {
			delete(r.seen, inputAuditKey{user: entry.UserId, hash: entry.ContentHash})
		}
		r.mu.Unlock()
		common.SysError("input audit batch failed: " + err.Error())
	}
}
