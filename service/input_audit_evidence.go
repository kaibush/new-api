package service

import (
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// inputAuditEvidenceBuilder collects full-text citation documents for
// rejected requests; excerpts are allocated after collection.
type inputAuditEvidenceBuilder struct {
	document model.InputAuditEvidenceDocument
}

func (builder *inputAuditEvidenceBuilder) omit(reason string) {
	if !slices.Contains(builder.document.Omitted, reason) {
		builder.document.Omitted = append(builder.document.Omitted, reason)
	}
}

func (builder *inputAuditEvidenceBuilder) add(role, kind, path, callID, name, text string) {
	if text == "" {
		return
	}
	if !slices.Contains([]string{"user", "assistant", "system", "developer", "tool", "function"}, role) {
		builder.omit("unknown_role")
		return
	}
	if len(builder.document.Messages) >= 512 {
		// Keep recent evidence even when older history exhausts the metadata
		// cap. Prompt entries have priority over ordinary history.
		drop := 0
		for i, message := range builder.document.Messages {
			if message.Role != "system" && message.Role != "developer" {
				drop = i
				break
			}
		}
		// Tool activity must not displace the user's instruction. In long
		// agent runs it can precede hundreds of calls with no new user turn.
		for i, message := range builder.document.Messages {
			if message.Kind != "message" || message.Role == "tool" || message.Role == "assistant" {
				drop = i
				break
			}
		}
		builder.document.Messages = slices.Delete(builder.document.Messages, drop, drop+1)
		builder.omit("message_limit")
		builder.document.Truncated = true
	}
	digest := sha256.Sum256([]byte(text))
	chars := utf8.RuneCountInString(text)
	safe, redacted := inputAuditWithoutMedia(text)
	if redacted {
		builder.omit("media_not_retained")
	}
	builder.document.Truncated = builder.document.Truncated || redacted
	builder.document.Messages = append(builder.document.Messages, model.InputAuditEvidenceMessage{Index: len(builder.document.Messages), Role: role, Kind: kind, Path: boundedAuditText(path, 256), CallID: boundedAuditText(callID, 128), Name: boundedAuditText(name, 128), Text: safe, OriginalChars: chars, OriginalHash: hex.EncodeToString(digest[:]), Truncated: redacted})
}

// Fixed head/middle/tail excerpts avoid keeping enormous tool output while
// retaining some interior evidence. Markers count against the text budget.
func inputAuditExcerpt(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	count := utf8.RuneCountInString(text)
	if count <= limit {
		return strings.Clone(text)
	}
	const marker = "\n[… omitted …]\n"
	markerChars := utf8.RuneCountInString(marker)
	if limit <= 2*markerChars {
		return boundedAuditText(text, limit)
	}
	available := limit - 2*markerChars
	head := available / 2
	middle := available / 4
	tail := available - head - middle
	starts := []int{0, (count - middle) / 2, count - tail}
	lengths := []int{head, middle, tail}
	var result strings.Builder
	position, offset := 0, 0
	for i, start := range starts {
		if i > 0 {
			result.WriteString(marker)
		}
		for position < start {
			_, size := utf8.DecodeRuneInString(text[offset:])
			offset += size
			position++
		}
		begin := offset
		for range lengths[i] {
			_, size := utf8.DecodeRuneInString(text[offset:])
			offset += size
			position++
		}
		result.WriteString(text[begin:offset])
	}
	return result.String()
}

// Exclude embedded media URLs even when a client places them inside ordinary
// text or a JSON string tool result. Structured media fields are skipped below.
func inputAuditWithoutMedia(text string) (string, bool) {
	lower := strings.ToLower(text)
	var result strings.Builder
	scan, written := 0, 0
	redacted := false
	for scan < len(text) {
		relative := strings.Index(lower[scan:], "data:")
		if relative < 0 {
			break
		}
		index := scan + relative
		rest := lower[index:]
		if !strings.HasPrefix(rest, "data:image/") && !strings.HasPrefix(rest, "data:audio/") && !strings.HasPrefix(rest, "data:video/") && !strings.HasPrefix(rest, "data:application/") {
			scan = index + 5
			continue
		}
		result.WriteString(text[written:index])
		end := index
		for end < len(text) && !strings.ContainsRune(" \t\r\n\"'<>)]}", rune(text[end])) {
			end++
		}
		result.WriteString("[media omitted]")
		scan, written = end, end
		redacted = true
	}
	if !redacted {
		return text, false
	}
	result.WriteString(text[written:])
	return result.String(), true
}

func inputAuditMediaType(mime string) bool {
	return strings.HasPrefix(mime, "image/") || strings.HasPrefix(mime, "audio/") || strings.HasPrefix(mime, "video/") || strings.HasPrefix(mime, "application/")
}

func inputAuditMediaField(key string) bool {
	switch strings.ToLower(key) {
	case "image", "images", "image_url", "imageurl", "input_image", "input_audio", "audio", "video", "video_url", "file", "file_data", "file_url", "inlinedata", "inline_data", "filedata", "bytes", "b64_json", "base64", "thoughtsignature", "signature", "thinking", "reasoning_content":
		return true
	}
	return false
}

// CaptureRealtimeEvent retains submitted text before the event's content
// filters run. Each event gets a gateway ID; the session's earlier context
// is deliberately marked unavailable rather than reconstructed.
func (r *InputAuditRecorder) CaptureRealtimeEvent(c *gin.Context, eventType string, message []byte) {
	if !r.settings.Load().Enabled {
		return
	}
	var path string
	switch eventType {
	case "conversation.item.create":
		path = "item"
	case "response.create":
		path = "response.input"
	default:
		return
	}
	input := gjson.GetBytes(message, path)
	if !input.Exists() {
		return
	}
	raw := input.Raw
	if input.IsObject() {
		raw = "[" + raw + "]"
	}
	eventContext := c.Copy()
	eventContext.Set(common.RequestIdKey, common.GetUUID())
	r.Capture(eventContext, &dto.OpenAIResponsesRequest{Input: []byte(raw), PreviousResponseID: "realtime_session"})
}
