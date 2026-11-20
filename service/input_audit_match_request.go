package service

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
	"github.com/tidwall/gjson"
)

// ExtractInputAuditMatchRequest observes the body that the rejecting plugin
// checked. Earlier plugins may have changed it; it is not an inbound wire copy.
// Fields are retained in source order, excluding media and bounded structural gaps.
func ExtractInputAuditMatchRequest(body []byte, maxChars int) model.InputAuditEvidenceDocument {
	builder := inputAuditEvidenceBuilder{fullText: true, document: model.InputAuditEvidenceDocument{Version: 2, Source: "rejection_stage_request", Scope: "submitted_text_excerpts", Messages: []model.InputAuditEvidenceMessage{}, Omitted: []string{}}}
	if !gjson.ValidBytes(body) {
		builder.document.ContextMissing = true
		builder.omit("unsupported_protocol")
		return builder.document
	}
	root := gjson.ParseBytes(body)
	builder.document.PreviousResponseID = boundedAuditText(root.Get("previous_response_id").Str, 128)
	for _, field := range []string{"previous_response_id", "conversation", "cachedContent", "cached_content", "continuation_token"} {
		if value := root.Get(field); value.Exists() && value.Type != gjson.Null && value.Raw != `""` {
			builder.document.ContextMissing = true
			builder.omit("external_context")
		}
	}
	visited := 0
	builder.matchRequestJSON("user", "request_field", "", "", "", root, 0, &visited)
	allocateInputAuditMatchText(&builder.document, max(0, min(maxChars, 1048576)))
	for i := range builder.document.Messages {
		builder.document.Messages[i].Index = i
	}
	slices.Sort(builder.document.Omitted)
	return builder.document
}

func (builder *inputAuditEvidenceBuilder) matchRequestJSON(role, kind, path, callID, name string, item gjson.Result, depth int, visited *int) {
	(*visited)++
	if depth > 32 || *visited > 32768 {
		builder.omit("request_structure_limit")
		builder.document.Truncated = true
		return
	}
	if item.Type == gjson.String {
		// Tools sometimes wrap structured output in a JSON string. Inspect it
		// structurally so image/base64 fields cannot slip into retained text.
		if (kind == "tool_result" || kind == "tool_call") && gjson.Valid(item.Str) {
			parsed := gjson.Parse(item.Str)
			if parsed.IsArray() || parsed.IsObject() {
				builder.matchRequestJSON(role, kind, path, callID, name, parsed, depth+1, visited)
				return
			}
		}
		builder.add(role, kind, path, callID, name, item.Str)
		return
	}
	if item.IsArray() {
		index := 0
		item.ForEach(func(_, part gjson.Result) bool {
			builder.matchRequestJSON(role, kind, fmt.Sprintf("%s/%d", path, index), callID, name, part, depth+1, visited)
			index++
			return *visited <= 32768
		})
		return
	}
	if !item.IsObject() {
		if item.Exists() {
			builder.add(role, kind, path, callID, name, item.Raw)
		}
		return
	}
	for _, key := range []string{"mimeType", "mime_type", "media_type", "mime"} {
		if inputAuditMediaType(item.Get(key).Str) {
			builder.omit("media_not_retained")
			return
		}
	}
	blockType := item.Get("type").Str
	switch blockType {
	case "image", "image_url", "input_image", "input_audio", "audio", "video", "input_video", "file", "input_file", "document", "base64":
		builder.omit("media_not_retained")
		return
	case "reasoning", "thinking", "redacted_thinking":
		builder.omit("reasoning_not_retained")
		return
	case "function_call_output", "custom_tool_call_output", "tool_result":
		role, kind = "tool", "tool_result"
	case "tool_use", "function_call", "custom_tool_call":
		role, kind = "assistant", "tool_call"
	}
	if candidate := item.Get("role").Str; candidate != "" {
		role, kind = candidate, "message"
		if role == "model" {
			role = "assistant"
		}
		if role == "tool" || role == "function" {
			kind = "tool_result"
		}
	}
	for _, field := range []string{"tool_call_id", "tool_use_id", "call_id", "id"} {
		if id := item.Get(field).Str; id != "" {
			callID = id
			break
		}
	}
	if toolName := item.Get("name").Str; toolName != "" {
		name = toolName
	}
	fields := 0
	item.ForEach(func(key, value gjson.Result) bool {
		fields++
		if fields > 128 {
			builder.omit("object_field_limit")
			builder.document.Truncated = true
			return false
		}
		if inputAuditMediaField(key.Str) {
			builder.omit("media_not_retained")
			return true
		}
		nextRole, nextKind := role, kind
		switch key.Str {
		case "system", "instructions", "systemInstruction", "system_instruction":
			nextRole, nextKind = "system", "message"
		case "tools", "functions":
			nextRole, nextKind = "system", "tool_definition"
		case "tool_calls", "function_call", "functionCall":
			nextRole, nextKind = "assistant", "tool_call"
		case "functionResponse", "function_response":
			nextRole, nextKind = "tool", "tool_result"
		case "prompt", "input", "messages", "contents":
			if kind == "request_field" {
				nextKind = "message"
			}
		}
		escapedKey := strings.ReplaceAll(strings.ReplaceAll(key.Str, "~", "~0"), "/", "~1")
		builder.matchRequestJSON(nextRole, nextKind, path+"/"+boundedAuditText(escapedKey, 128), callID, name, value, depth+1, visited)
		return *visited <= 32768
	})
}

// Allocate a minimum quote for every user instruction and prompt before tools
// consume space. Then share the remaining budget in rounds, favouring recent
// instructions. Small requests retain every observed field without per-field caps.
func allocateInputAuditMatchText(document *model.InputAuditEvidenceDocument, maxChars int) {
	messages := document.Messages
	lengths, limits := make([]int, len(messages)), make([]int, len(messages))
	priority, other := []int{}, []int{}
	total := 0
	for i := range messages {
		lengths[i] = utf8.RuneCountInString(messages[i].Text)
		total += lengths[i]
	}
	if total <= maxChars {
		return
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Kind == "message" && slices.Contains([]string{"user", "system", "developer"}, messages[i].Role) {
			priority = append(priority, i)
		} else {
			other = append(other, i)
		}
	}
	remaining := maxChars
	minimum := min(512, maxChars/max(1, len(priority)))
	for _, i := range priority {
		limits[i] = min(lengths[i], minimum)
		remaining -= limits[i]
	}
	remaining -= distributeInputAuditMatchBudget(limits, lengths, priority, remaining*2/3)
	remaining -= distributeInputAuditMatchBudget(limits, lengths, other, remaining)
	distributeInputAuditMatchBudget(limits, lengths, priority, remaining)
	for i := range messages {
		messages[i].Text = inputAuditExcerpt(messages[i].Text, limits[i])
		if limits[i] < lengths[i] {
			messages[i].Truncated = true
		}
	}
	document.Truncated = true
	document.Omitted = append(document.Omitted, "request_character_limit")
}

func distributeInputAuditMatchBudget(limits, lengths, order []int, budget int) int {
	remaining := budget
	for remaining > 0 {
		spent := 0
		for _, i := range order {
			added := min(4096, lengths[i]-limits[i], remaining)
			limits[i] += added
			remaining -= added
			spent += added
		}
		if spent == 0 {
			break
		}
	}
	return budget - remaining
}
