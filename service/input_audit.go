package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type inputAuditKey struct {
	user int
	hash string
}

type inputAuditChainKey struct {
	user  int
	chain [32]byte
}

// inputAuditQueued keeps a request row with its transcript, so a transcript
// is written only after its request row.
type inputAuditQueued struct {
	audit      model.InputAudit
	transcript *model.InputAuditTranscript
	bytes      int64
}

type InputAuditRecorder struct {
	db                    *gorm.DB
	settings              atomic.Pointer[model.InputAuditSettings]
	queue                 chan inputAuditQueued
	matchQueue            chan model.InputAuditMatch
	matchDropped          atomic.Uint64
	matchFailures         atomic.Uint64
	matchQueuedBytes      atomic.Int64
	transcriptsQueued     atomic.Int64
	transcriptQueuedBytes atomic.Int64
	evidenceDropped       atomic.Uint64
	evidenceFailures      atomic.Uint64
	mu                    sync.Mutex
	configMu              sync.Mutex
	seen                  map[inputAuditKey]int64
	ring                  []inputAuditKey
	next                  int
	// Conversation prefixes already queued by this instance. Items up to the
	// longest known prefix are sent without text; writers report when the
	// cache no longer matches stored threads.
	chains    map[inputAuditChainKey]struct{}
	chainRing []inputAuditChainKey
	chainNext int
	closed    bool
	cancel    context.CancelFunc
	done      chan struct{}
	dropped   atomic.Uint64
	failures  atomic.Uint64
}

var inputAuditRecorder atomic.Pointer[InputAuditRecorder]

func NewInputAuditRecorder(db *gorm.DB) (*InputAuditRecorder, error) {
	settings, err := model.LoadInputAuditSettings(db)
	if err != nil {
		return nil, err
	}
	r := &InputAuditRecorder{db: db, matchQueue: make(chan model.InputAuditMatch, 128), queue: make(chan inputAuditQueued, 1024), seen: make(map[inputAuditKey]int64), ring: make([]inputAuditKey, 8192), chains: make(map[inputAuditChainKey]struct{}), chainRing: make([]inputAuditChainKey, 16384), done: make(chan struct{})}
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
	go RunInputAuditReviewer(ctx, model.DB)
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
		inputAuditRecorder.CompareAndSwap(r, nil)
	case <-ctx.Done():
		common.SysError("input audit shutdown timed out")
	}
}

type InputAuditStatus struct {
	MatchPending          int                      `json:"match_pending"`
	MatchDropped          uint64                   `json:"match_dropped"`
	MatchWriteFailures    uint64                   `json:"match_write_failures"`
	EvidencePending       int                      `json:"evidence_pending"`
	EvidenceDropped       uint64                   `json:"evidence_dropped"`
	EvidenceWriteFailures uint64                   `json:"evidence_write_failures"`
	Settings              model.InputAuditSettings `json:"settings"`
	Pending               int                      `json:"pending"`
	Dropped               uint64                   `json:"dropped"`
	WriteFailures         uint64                   `json:"write_failures"`
}

func (r *InputAuditRecorder) Status() InputAuditStatus {
	return InputAuditStatus{MatchPending: len(r.matchQueue), MatchDropped: r.matchDropped.Load(), MatchWriteFailures: r.matchFailures.Load(), Settings: *r.settings.Load(), Pending: len(r.queue), Dropped: r.dropped.Load(), WriteFailures: r.failures.Load(), EvidencePending: int(r.transcriptsQueued.Load()), EvidenceDropped: r.evidenceDropped.Load(), EvidenceWriteFailures: r.evidenceFailures.Load()}
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
	current := r.settings.Load()
	if current.Enabled != settings.Enabled {
		// Inputs deliberately discarded while disabled must not suppress
		// their first capture after collection is enabled again.
		clear(r.seen)
		clear(r.ring)
		r.next = 0
	}
	if current.Enabled != settings.Enabled || current.EvidenceEnabled != settings.EvidenceEnabled {
		r.forgetChainsLocked()
	}
	r.settings.Store(&settings)
}

// ForgetTranscripts discards known conversation prefixes, for example after
// administrators delete stored conversations.
func (r *InputAuditRecorder) ForgetTranscripts() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.forgetChainsLocked()
}

func (r *InputAuditRecorder) forgetChainsLocked() {
	clear(r.chains)
	clear(r.chainRing)
	r.chainNext = 0
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
	if c.GetString(common.RequestIdKey) == "" {
		c.Set(common.RequestIdKey, common.GetUUID())
	}
	builder := extractInputAuditTranscript(request)
	intent := builder.intent()
	var texts []string
	switch {
	case intent >= 0:
		texts = []string{builder.items[intent].text}
	case !builder.supported:
		texts = []string{"[non-text content omitted]"}
	case len(builder.items) > 0:
		texts = []string{"[no user text in this request]"}
	default:
		return
	}
	inputHash, chars := inputAuditFingerprint(texts)
	if chars == 0 {
		return
	}
	// Every request has its own event, including identical latest user text.
	// Keep the old unique index; content_hash now identifies a request event.
	digest := sha256.Sum256([]byte(strconv.Itoa(userId) + ":" + c.GetString(common.RequestIdKey)))
	hash := hex.EncodeToString(digest[:])
	now := time.Now().Unix()
	key := inputAuditKey{user: userId, hash: hash}
	r.mu.Lock()
	savedAt, found := r.seen[key]
	closed := r.closed
	r.mu.Unlock()
	if closed || (found && now-savedAt < 300) {
		return
	}
	chains := make([][32]byte, len(builder.items))
	var previous [32]byte
	for i, item := range builder.items {
		chains[i] = inputAuditChain(previous, item)
		previous = chains[i]
	}
	entry := inputAuditPreview(texts, hash, chars, settings.MaxChars)
	entry.InputHash = inputHash
	entry.TurnKey = hash
	if intent >= 0 {
		entry.TurnKey = hex.EncodeToString(chains[intent][:])
		entry.TurnItem = intent + 1
	}
	entry.ItemCount = len(builder.items)
	entry.EvidenceState = "disabled"
	entry.UserId = userId
	entry.CreatedAt = now
	entry.Username = boundedAuditText(common.GetContextKeyString(c, constant.ContextKeyUserName), 64)
	entry.TokenId = common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	entry.Model = boundedAuditText(common.GetContextKeyString(c, constant.ContextKeyOriginalModel), 255)
	entry.RequestId = boundedAuditText(c.GetString(common.RequestIdKey), 64)
	entry.Route = boundedAuditText(c.FullPath(), 255)
	entry.Ip = boundedAuditText(c.ClientIP(), 64)
	var queued inputAuditQueued
	if settings.EvidenceEnabled && len(builder.items) > 0 {
		queued.transcript, queued.bytes = r.transcriptOf(builder, chains, entry, settings.EvidenceMaxChars)
		entry.EvidenceState = "pending"
		if queued.transcript == nil {
			entry.EvidenceState = "queue_dropped"
		}
	}
	queued.audit = *entry
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		r.transcriptQueuedBytes.Add(-queued.bytes)
		return
	}
	if savedAt, found := r.seen[key]; found && now-savedAt < 300 {
		r.transcriptQueuedBytes.Add(-queued.bytes)
		return
	}
	select {
	case r.queue <- queued:
		delete(r.seen, r.ring[r.next])
		r.ring[r.next] = key
		r.next = (r.next + 1) % len(r.ring)
		r.seen[key] = now
		if queued.transcript != nil {
			r.transcriptsQueued.Add(1)
			last := inputAuditChainKey{user: userId, chain: chains[len(queued.transcript.Items)-1]}
			if _, exists := r.chains[last]; !exists {
				delete(r.chains, r.chainRing[r.chainNext])
				r.chainRing[r.chainNext] = last
				r.chainNext = (r.chainNext + 1) % len(r.chainRing)
				r.chains[last] = struct{}{}
			}
		}
	default:
		r.dropped.Add(1)
		r.transcriptQueuedBytes.Add(-queued.bytes)
	}
}

// transcriptOf keeps deterministic per-item excerpts: conversational text up
// to maxChars and tool activity up to an eighth of it. Items of a prefix this
// instance already queued carry no text; new text is bounded newest first.
func (r *InputAuditRecorder) transcriptOf(builder inputAuditTranscriptBuilder, chains [][32]byte, entry *model.InputAudit, maxChars int) (*model.InputAuditTranscript, int64) {
	known := 0
	r.mu.Lock()
	for i := len(chains) - 1; i >= 0; i-- {
		if _, found := r.chains[inputAuditChainKey{user: entry.UserId, chain: chains[i]}]; found {
			known = i + 1
			break
		}
	}
	r.mu.Unlock()
	count := min(len(builder.items), inputAuditTranscriptItemLimit)
	transcript := &model.InputAuditTranscript{UserId: entry.UserId, RequestId: entry.RequestId, ContentHash: entry.ContentHash, CreatedAt: entry.CreatedAt, Items: make([]model.InputAuditTranscriptItem, count), Tools: builder.tools, Truncated: count < len(builder.items), ContextMissing: builder.contextMissing}
	remaining := 1 << 20
	bytes := int64(count) * 160
	for i := count - 1; i >= 0; i-- {
		raw := builder.items[i]
		item := model.InputAuditTranscriptItem{Chain: hex.EncodeToString(chains[i][:]), Role: raw.role, Kind: raw.kind, Name: raw.name, CallId: raw.callID, Known: i < known, OriginalChars: utf8.RuneCountInString(raw.text), Media: raw.media}
		if !item.Known && raw.text != "" {
			limit := maxChars
			if raw.kind == "tool_call" || raw.kind == "tool_result" {
				limit = max(1024, maxChars/8)
			}
			item.Text = inputAuditExcerpt(raw.text, min(limit, remaining))
			stored := utf8.RuneCountInString(item.Text)
			remaining -= stored
			item.Truncated = stored < item.OriginalChars
			bytes += int64(len(item.Text))
		}
		transcript.Items[i] = item
	}
	if r.transcriptQueuedBytes.Add(bytes) > 16<<20 {
		r.transcriptQueuedBytes.Add(-bytes)
		r.evidenceDropped.Add(1)
		return nil, 0
	}
	return transcript, bytes
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

// ExtractInputAudit selects the latest text the user wrote, ignoring system,
// assistant, client-injected context, tool activity and media. Short inputs
// are saved in full; long ones retain both the beginning and end. Hashing uses
// the whole text, so two inputs with the same stored preview remain distinct.
func ExtractInputAudit(request any, maxChars int) *model.InputAudit {
	builder := extractInputAuditTranscript(request)
	intent := builder.intent()
	if intent < 0 || maxChars < 1 {
		return nil
	}
	texts := []string{builder.items[intent].text}
	hash, chars := inputAuditFingerprint(texts)
	if chars == 0 {
		return nil
	}
	return inputAuditPreview(texts, hash, chars, maxChars)
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
			for (len(r.queue) > 0 || len(r.matchQueue) > 0) && drainCtx.Err() == nil {
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
			if len(r.queue) > 0 || len(r.matchQueue) > 0 || now.Sub(lastCleanup) >= time.Minute {
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
	matches := make([]model.InputAuditMatch, 0, 32)
	for range 32 {
		select {
		case entry := <-r.matchQueue:
			r.matchQueuedBytes.Add(-int64(len(entry.RequestBody)))
			matches = append(matches, entry)
		default:
		}
	}
	if err := model.PersistInputAuditMatches(r.db.WithContext(ctx), matches, time.Now().Unix()); err != nil {
		r.matchFailures.Add(1)
		r.matchDropped.Add(uint64(len(matches)))
		common.SysError("input match evidence batch failed")
	}

	queued := make([]inputAuditQueued, 0, 100)
	for range 100 {
		select {
		case entry := <-r.queue:
			queued = append(queued, entry)
		default:
		}
	}
	batch := make([]model.InputAudit, 0, len(queued))
	transcripts := make([]model.InputAuditTranscript, 0, len(queued))
	for _, entry := range queued {
		batch = append(batch, entry.audit)
		if entry.transcript != nil {
			transcripts = append(transcripts, *entry.transcript)
			r.transcriptsQueued.Add(-1)
			r.transcriptQueuedBytes.Add(-entry.bytes)
		}
	}
	if err := model.PersistInputAudits(r.db.WithContext(ctx), batch, time.Now().Unix()); err != nil {
		r.failures.Add(1)
		r.dropped.Add(uint64(len(batch)))
		r.evidenceDropped.Add(uint64(len(transcripts)))
		r.mu.Lock()
		for _, entry := range batch {
			delete(r.seen, inputAuditKey{user: entry.UserId, hash: entry.ContentHash})
		}
		r.forgetChainsLocked()
		r.mu.Unlock()
		common.SysError("input audit batch failed: " + err.Error())
		return
	}
	// Transcripts follow their request rows. Small transactions bound the
	// lock time when new conversations arrive with long histories.
	for start := 0; start == 0 || start < len(transcripts); start += 16 {
		chunk := transcripts[start:min(start+16, len(transcripts))]
		stale, err := model.PersistInputAuditTranscripts(r.db.WithContext(ctx), chunk, time.Now().Unix())
		if err != nil {
			r.evidenceFailures.Add(1)
			r.evidenceDropped.Add(uint64(len(chunk)))
			common.SysError("input audit transcript batch failed")
			for _, transcript := range chunk {
				_ = r.db.WithContext(ctx).Model(&model.InputAudit{}).Where("user_id = ? AND content_hash = ?", transcript.UserId, transcript.ContentHash).Update("evidence_state", "write_failed").Error
			}
		}
		if err != nil || stale {
			r.ForgetTranscripts()
		}
	}
}
