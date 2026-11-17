package service

import (
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// Evidence owns capped text only; it never keeps a request, context, header,
// attachment, tool result, or an unbounded string in the recorder queue.
func ExtractInputAuditEvidence(request any, maxChars int) model.InputAuditEvidenceDocument {
	document := model.InputAuditEvidenceDocument{Source: "client_request", Scope: "submitted_text_messages", Messages: []model.InputAuditEvidenceMessage{}, Omitted: []string{}}
	remaining := maxChars
	omit := func(reason string) {
		if !slices.Contains(document.Omitted, reason) {
			document.Omitted = append(document.Omitted, reason)
		}
	}
	add := func(role string, content any) {
		if role != "user" && role != "assistant" && role != "system" && role != "developer" {
			omit("tool_or_unknown_role")
			return
		}
		if remaining <= 0 || len(document.Messages) >= 256 {
			document.Truncated = true
			return
		}
		switch blocks := content.(type) {
		case []any:
			if len(blocks) > 256 {
				content = blocks[:256]
				document.Truncated = true
			}
		case []dto.MediaContent:
			if len(blocks) > 256 {
				content = blocks[:256]
				document.Truncated = true
			}
		}
		parts := inputAuditTextParts(content)
		if _, plain := content.(string); !plain {
			// Non-text blocks may carry relevant context. Their bytes are never
			// retained and the reviewer sees that evidence is incomplete.
			switch blocks := content.(type) {
			case []any:
				if len(parts) != len(blocks) {
					omit("non_text_content")
				}
			case []dto.MediaContent:
				if len(parts) != len(blocks) {
					omit("non_text_content")
				}
			default:
				if content != nil {
					omit("unsupported_content")
				}
			}
		}
		if len(parts) == 0 {
			return
		}
		if len(document.Messages) >= 256 || remaining <= 0 {
			document.Truncated = true
			return
		}
		var text strings.Builder
		for i, part := range parts {
			if i > 0 {
				if remaining <= 0 {
					document.Truncated = true
					break
				}
				text.WriteByte('\n')
				remaining--
			}
			end := 0
			for end < len(part) && remaining > 0 {
				_, size := utf8.DecodeRuneInString(part[end:])
				end += size
				remaining--
			}
			text.WriteString(part[:end])
			if end < len(part) {
				document.Truncated = true
				break
			}
		}
		document.Messages = append(document.Messages, model.InputAuditEvidenceMessage{Index: len(document.Messages), Role: role, Text: text.String()})
	}
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if len(req.Messages) == 0 {
			add("user", req.Prompt)
		}
		for _, message := range req.Messages {
			add(message.Role, message.Content)
			if len(message.ToolCalls) > 0 || message.ReasoningContent != nil || message.Reasoning != nil {
				omit("auxiliary_message_content")
			}
			if remaining <= 0 || len(document.Messages) >= 256 {
				document.Truncated = true
				break
			}
		}
	case *dto.ClaudeRequest:
		if req.System != nil {
			add("system", req.System)
		}
		if len(req.Messages) == 0 && req.Prompt != "" {
			add("user", req.Prompt)
		}
		for _, message := range req.Messages {
			add(message.Role, message.Content)
			if remaining <= 0 || len(document.Messages) >= 256 {
				document.Truncated = true
				break
			}
		}
	case *dto.GeminiChatRequest:
		messages := req.Contents
		if len(messages) > 255 {
			messages = messages[:255]
			document.Truncated = true
		}
		if req.SystemInstructions != nil {
			messages = append([]dto.GeminiChatContent{*req.SystemInstructions}, messages...)
		}
		for i, message := range messages {
			role := message.Role
			if role == "model" {
				role = "assistant"
			} else if role == "" {
				role = "user"
			}
			if req.SystemInstructions != nil && i == 0 {
				role = "system"
			}
			parts := message.Parts
			if len(parts) > 256 {
				parts = parts[:256]
				document.Truncated = true
			}
			for _, part := range parts {
				if part.Text != "" && !part.Thought && part.FunctionCall == nil && part.FunctionResponse == nil {
					add(role, part.Text)
					if part.InlineData != nil || part.FileData != nil || part.ExecutableCode != nil || part.CodeExecutionResult != nil {
						omit("non_text_content")
					}
				} else {
					omit("non_text_content")
				}
			}
		}
	case *dto.OpenAIResponsesRequest:
		// Avoid copying unbounded tool/media input. Larger requests remain explicitly incomplete.
		if len(req.Input) > 1<<20 || len(req.Instructions) > 1<<20 {
			document.ContextMissing = true
			omit("request_extraction_limit")
			break
		}
		if req.PreviousResponseID != "" || (len(req.Conversation) > 0 && strings.TrimSpace(string(req.Conversation)) != "null") {
			document.ContextMissing = true
		}
		if instructions := gjson.ParseBytes(req.Instructions); instructions.Type == gjson.String {
			add("system", instructions.Str)
		}
		input := gjson.ParseBytes(req.Input)
		if input.Type == gjson.String {
			add("user", input.Str)
			break
		}
		input.ForEach(func(_, item gjson.Result) bool {
			role := item.Get("role").Str
			if role == "" {
				omit("tool_or_unknown_role")
				return true
			}
			content := item.Get("content")
			if content.Type == gjson.String {
				add(role, content.Str)
			} else {
				content.ForEach(func(_, part gjson.Result) bool {
					if kind := part.Get("type").Str; kind == "input_text" || kind == "output_text" || kind == "text" {
						add(role, part.Get("text").Str)
					} else {
						omit("non_text_content")
					}
					return true
				})
			}
			if remaining <= 0 || len(document.Messages) >= 256 {
				document.Truncated = true
				return false
			}
			return true
		})
	default:
		document.ContextMissing = true
	}
	slices.Sort(document.Omitted)
	document.Omitted = slices.Compact(document.Omitted)
	return document
}

func (r *InputAuditRecorder) captureEvidence(c *gin.Context, request any, contentHash string, settings *model.InputAuditSettings) {
	if !settings.EvidenceEnabled {
		return
	}
	if len(r.evidenceQueue) >= cap(r.evidenceQueue) {
		r.evidenceDropped.Add(1)
		return
	}
	document := ExtractInputAuditEvidence(request, settings.EvidenceMaxChars)
	body, err := common.Marshal(document)
	if err != nil {
		r.evidenceDropped.Add(1)
		return
	}
	policy := request_plugin_setting.GetAllowlist()
	policy.Entries = slices.DeleteFunc(slices.Clone(policy.Entries), func(entry request_plugin_setting.AllowlistEntry) bool {
		return entry.UserID != common.GetContextKeyInt(c, constant.ContextKeyUserId)
	})
	policyJSON, err := common.Marshal(policy)
	if err != nil {
		r.evidenceDropped.Add(1)
		return
	}
	bytes := int64(len(body) + len(policyJSON))
	if r.evidenceQueuedBytes.Add(bytes) > 16<<20 {
		r.evidenceQueuedBytes.Add(-bytes)
		r.evidenceDropped.Add(1)
		return
	}
	digest := sha256.Sum256(body)
	requestID := boundedAuditText(c.GetString(common.RequestIdKey), 64)
	if requestID == "" {
		requestID = common.GetUUID()
	}
	entry := model.InputAuditEvidence{RequestId: requestID, UserId: common.GetContextKeyInt(c, constant.ContextKeyUserId), CreatedAt: time.Now().Unix(), ContentHash: contentHash, DocumentHash: hex.EncodeToString(digest[:]), Body: string(body), BodyBytes: bytes, Policy: string(policyJSON)}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.closed {
		select {
		case r.evidenceQueue <- entry:
			return
		default:
		}
	}
	r.evidenceQueuedBytes.Add(-bytes)
	r.evidenceDropped.Add(1)
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
	if len(message) > 1<<20 {
		r.evidenceDropped.Add(1)
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
