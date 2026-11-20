package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"reflect"
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

// ExtractInputAuditEvidence keeps bounded, deterministic excerpts rather than
// whole transcripts. Each text retains its source position, original digest and
// length; media bytes and media URLs never enter the recorder queue.
func ExtractInputAuditEvidence(request any, maxChars int) model.InputAuditEvidenceDocument {
	builder := inputAuditEvidenceBuilder{document: model.InputAuditEvidenceDocument{Version: 2, Source: "client_request", Scope: "submitted_text_excerpts", Messages: []model.InputAuditEvidenceMessage{}, Omitted: []string{}}}
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if len(req.Messages) == 0 {
			builder.content("user", "message", "/prompt", "", "", req.Prompt, 0)
		}
		for i, message := range req.Messages {
			if i >= 128 && i < len(req.Messages)-128 && message.Role != "system" && message.Role != "developer" {
				builder.omit("history_window")
				builder.document.Truncated = true
				continue
			}
			path := fmt.Sprintf("/messages/%d", i)
			name := ""
			if message.Name != nil {
				name = *message.Name
			}
			kind := "message"
			if message.Role == "tool" || message.Role == "function" {
				kind = "tool_result"
			}
			builder.content(message.Role, kind, path+"/content", message.ToolCallId, name, message.Content, 0)
			if len(message.ToolCalls) > 0 {
				builder.jsonContent("assistant", "tool_call", path+"/tool_calls", gjson.ParseBytes(message.ToolCalls), 0)
			}
			if len(message.Tools) > 0 {
				builder.jsonContent(message.Role, "tool_definition", path+"/tools", gjson.ParseBytes(message.Tools), 0)
			}
			if message.ReasoningContent != nil || message.Reasoning != nil {
				builder.omit("reasoning_not_retained")
			}
		}
		for i, tool := range req.Tools {
			if i >= 128 {
				builder.omit("tool_definition_limit")
				break
			}
			builder.add("system", "tool_definition", fmt.Sprintf("/tools/%d", i), tool.ID, tool.Function.Name, tool.Function.Description)
		}
	case *dto.ClaudeRequest:
		builder.content("system", "message", "/system", "", "", req.System, 0)
		if len(req.Messages) == 0 {
			builder.content("user", "message", "/prompt", "", "", req.Prompt, 0)
		}
		for i, message := range req.Messages {
			if i >= 128 && i < len(req.Messages)-128 && message.Role != "system" && message.Role != "developer" {
				builder.omit("history_window")
				builder.document.Truncated = true
				continue
			}
			builder.content(message.Role, "message", fmt.Sprintf("/messages/%d/content", i), "", "", message.Content, 0)
		}
		builder.content("system", "tool_definition", "/tools", "", "", req.Tools, 0)
	case *dto.GeminiChatRequest:
		if req.SystemInstructions != nil {
			builder.gemini("system", "/systemInstruction", *req.SystemInstructions)
		}
		for i, message := range req.Contents {
			if i >= 128 && i < len(req.Contents)-128 {
				builder.omit("history_window")
				builder.document.Truncated = true
				continue
			}
			role := message.Role
			if role == "model" {
				role = "assistant"
			}
			if role == "" {
				role = "user"
			}
			builder.gemini(role, fmt.Sprintf("/contents/%d", i), message)
		}
		if len(req.Tools) > 0 {
			builder.jsonContent("system", "tool_definition", "/tools", gjson.ParseBytes(req.Tools), 0)
		}
		if req.CachedContent != "" || len(req.ContinuationToken) > 0 {
			builder.document.ContextMissing = true
			builder.omit("external_context")
		}
	case *dto.OpenAIResponsesRequest:
		builder.document.PreviousResponseID = boundedAuditText(req.PreviousResponseID, 128)
		if req.PreviousResponseID != "" || (len(req.Conversation) > 0 && strings.TrimSpace(string(req.Conversation)) != "null") {
			builder.document.ContextMissing = true
			builder.omit("external_context")
		}
		instructions := gjson.ParseBytes(req.Instructions)
		if instructions.Type == gjson.String {
			builder.add("system", "message", "/instructions", "", "", instructions.Str)
		}
		builder.jsonContent("user", "message", "/input", gjson.ParseBytes(req.Input), 0)
		if len(req.Tools) > 0 {
			builder.jsonContent("system", "tool_definition", "/tools", gjson.ParseBytes(req.Tools), 0)
		}
	default:
		builder.document.ContextMissing = true
		builder.omit("unsupported_protocol")
	}
	// Reserve space for prompts and the latest user message before allocating
	// the remaining request budget to history. Preserve original order afterward.
	messages := builder.document.Messages
	latest := -1
	for i := range messages {
		if messages[i].Role == "user" && messages[i].Kind == "message" {
			latest = i
		}
	}
	order := make([]int, 0, len(messages))
	if latest >= 0 {
		order = append(order, latest)
	}
	for i := range messages {
		if i != latest && (messages[i].Role == "system" || messages[i].Role == "developer") {
			order = append(order, i)
		}
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if i != latest && messages[i].Role != "system" && messages[i].Role != "developer" {
			order = append(order, i)
		}
	}
	// A bounded prompt allocation leaves room for recent history/tool results.
	promptRemaining := maxChars / 3
	remaining := max(0, maxChars)
	for _, i := range order {
		message := &messages[i]
		if message.Text == "" {
			continue
		}
		limit := min(remaining, 4096)
		prompt := message.Role == "system" || message.Role == "developer"
		if prompt {
			limit = min(limit, promptRemaining)
		}
		if message.Kind == "tool_result" {
			limit = min(limit, 2048)
		}
		original := message.Text
		message.Text = inputAuditExcerpt(original, limit)
		stored := utf8.RuneCountInString(message.Text)
		remaining -= stored
		if prompt {
			promptRemaining -= stored
		}
		if original != message.Text {
			message.Truncated = true
			builder.document.Truncated = true
		}
	}
	for i := range messages {
		messages[i].Index = i
	}
	slices.Sort(builder.document.Omitted)
	return builder.document
}

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
	excerpt := inputAuditExcerpt(safe, 4096)
	truncated := excerpt != safe || redacted
	builder.document.Truncated = builder.document.Truncated || truncated
	builder.document.Messages = append(builder.document.Messages, model.InputAuditEvidenceMessage{Index: len(builder.document.Messages), Role: role, Kind: kind, Path: boundedAuditText(path, 256), CallID: boundedAuditText(callID, 128), Name: boundedAuditText(name, 128), Text: excerpt, OriginalChars: chars, OriginalHash: hex.EncodeToString(digest[:]), Truncated: truncated})
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

func (builder *inputAuditEvidenceBuilder) content(role, kind, path, callID, name string, content any, depth int) {
	if content == nil {
		return
	}
	if depth > 8 {
		builder.omit("content_depth_limit")
		return
	}
	switch value := content.(type) {
	case string:
		if (kind == "tool_result" || kind == "tool_call") && gjson.Valid(value) {
			parsed := gjson.Parse(value)
			if parsed.IsObject() || parsed.IsArray() {
				start := len(builder.document.Messages)
				builder.jsonContent(role, kind, path, parsed, depth+1)
				for i := start; i < len(builder.document.Messages); i++ {
					builder.document.Messages[i].CallID = boundedAuditText(callID, 128)
					builder.document.Messages[i].Name = boundedAuditText(name, 128)
				}
				return
			}
		}
		builder.add(role, kind, path, callID, name, value)
	case []any:
		for i, item := range value {
			if i >= 512 {
				builder.omit("content_block_limit")
				break
			}
			builder.content(role, kind, fmt.Sprintf("%s/%d", path, i), callID, name, item, depth+1)
		}
	case []dto.MediaContent:
		for i, item := range value {
			if i >= 512 {
				builder.omit("content_block_limit")
				break
			}
			if item.Type == "text" || item.Type == "input_text" || item.Type == "output_text" {
				builder.add(role, kind, fmt.Sprintf("%s/%d/text", path, i), callID, name, item.Text)
			} else {
				builder.omit("media_not_retained")
			}
		}
	case map[string]any:
		// The protocol object is already decoded. Do not marshal its media payload.
		blockType, _ := value["type"].(string)
		for _, key := range []string{"mimeType", "mime_type", "media_type", "mime"} {
			if mime, ok := value[key].(string); ok && inputAuditMediaType(mime) {
				builder.omit("media_not_retained")
				return
			}
		}
		switch blockType {
		case "text", "input_text", "output_text":
			builder.content(role, kind, path+"/text", callID, name, value["text"], depth+1)
		case "tool_result":
			id, _ := value["tool_use_id"].(string)
			builder.content("tool", "tool_result", path+"/content", id, name, value["content"], depth+1)
		case "tool_use":
			id, _ := value["id"].(string)
			toolName, _ := value["name"].(string)
			builder.content("assistant", "tool_call", path+"/input", id, toolName, value["input"], depth+1)
		case "image", "image_url", "input_image", "input_audio", "audio", "video", "file", "document":
			builder.omit("media_not_retained")
		default:
			// Tool arguments/results may be structured JSON rather than text blocks.
			keys := make([]string, 0, len(value))
			for key := range value {
				keys = append(keys, key)
			}
			slices.Sort(keys)
			for i, key := range keys {
				if i >= 128 {
					builder.omit("object_field_limit")
					break
				}
				if inputAuditMediaField(key) {
					builder.omit("media_not_retained")
					continue
				}
				builder.content(role, kind, path+"/"+boundedAuditText(key, 128), callID, name, value[key], depth+1)
			}
		}
	default:
		// DTO tool objects are small in normal use, but field-by-field processing
		// via reflection avoids serializing embedded images or giant byte arrays.
		builder.value(role, kind, path, callID, name, reflect.ValueOf(content), depth+1)
	}
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

func (builder *inputAuditEvidenceBuilder) value(role, kind, path, callID, name string, value reflect.Value, depth int) {
	if !value.IsValid() {
		return
	}
	if depth > 8 {
		builder.omit("content_depth_limit")
		return
	}
	for value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface {
		if value.IsNil() {
			return
		}
		value = value.Elem()
	}
	switch value.Kind() {
	case reflect.String:
		builder.add(role, kind, path, callID, name, value.String())
	case reflect.Slice, reflect.Array:
		if value.Type().Elem().Kind() == reflect.Uint8 {
			builder.omit("binary_not_retained")
			return
		}
		for i := 0; i < min(value.Len(), 128); i++ {
			builder.value(role, kind, fmt.Sprintf("%s/%d", path, i), callID, name, value.Index(i), depth+1)
		}
		if value.Len() > 128 {
			builder.omit("content_block_limit")
		}
	case reflect.Struct:
		typ := value.Type()
		for i := range value.NumField() {
			field := typ.Field(i)
			if !field.IsExported() {
				continue
			}
			key, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			if key == "-" {
				continue
			}
			if key == "" {
				key = field.Name
			}
			if inputAuditMediaField(key) {
				if !value.Field(i).IsZero() {
					builder.omit("media_not_retained")
				}
				continue
			}
			builder.value(role, kind, path+"/"+boundedAuditText(key, 128), callID, name, value.Field(i), depth+1)
		}
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String {
			builder.omit("unsupported_content")
			return
		}
		keys := value.MapKeys()
		slices.SortFunc(keys, func(a, b reflect.Value) int { return strings.Compare(a.String(), b.String()) })
		for i, key := range keys {
			if i >= 128 {
				builder.omit("object_field_limit")
				break
			}
			if inputAuditMediaField(key.String()) {
				builder.omit("media_not_retained")
				continue
			}
			builder.value(role, kind, path+"/"+key.String(), callID, name, value.MapIndex(key), depth+1)
		}
	case reflect.Bool, reflect.Int, reflect.Int64, reflect.Int32, reflect.Float64, reflect.Float32, reflect.Uint, reflect.Uint64:
		builder.add(role, kind, path, callID, name, fmt.Sprint(value.Interface()))
	}
}

func (builder *inputAuditEvidenceBuilder) jsonContent(role, kind, path string, item gjson.Result, depth int) {
	if depth > 8 {
		builder.omit("content_depth_limit")
		return
	}
	if item.Type == gjson.String {
		builder.content(role, kind, path, "", "", item.Str, depth+1)
		return
	}
	if item.IsArray() {
		count := item.Get("#").Int()
		index := 0
		item.ForEach(func(_, part gjson.Result) bool {
			position := index
			index++
			partRole := part.Get("role").Str
			if position >= 128 && int64(position) < count-128 && partRole != "system" && partRole != "developer" {
				builder.omit("history_window")
				builder.document.Truncated = true
				return true
			}
			builder.jsonContent(role, kind, fmt.Sprintf("%s/%d", path, position), part, depth+1)
			return true
		})
		return
	}
	if !item.IsObject() {
		if item.Exists() && item.Type != gjson.Null {
			builder.add(role, kind, path, "", "", item.Raw)
		}
		return
	}
	for _, key := range []string{"mimeType", "mime_type", "media_type", "mime"} {
		if inputAuditMediaType(item.Get(key).Str) {
			builder.omit("media_not_retained")
			return
		}
	}
	item.ForEach(func(key, value gjson.Result) bool {
		if inputAuditMediaField(key.Str) && value.Exists() {
			builder.omit("media_not_retained")
		}
		return true
	})
	blockType := item.Get("type").Str
	if candidate := item.Get("role").Str; candidate != "" {
		role = candidate
	}
	callID := item.Get("call_id").Str
	if callID == "" {
		callID = item.Get("id").Str
	}
	name := item.Get("name").Str
	switch blockType {
	case "function_call_output", "custom_tool_call_output":
		output := item.Get("output")
		if output.Type == gjson.String {
			builder.content("tool", "tool_result", path+"/output", callID, name, output.Str, depth+1)
		} else {
			builder.jsonContent("tool", "tool_result", path+"/output", output, depth+1)
		}
	case "function":
		function := item.Get("function")
		if function.Exists() {
			builder.content("assistant", "tool_call", path+"/function/arguments", callID, function.Get("name").Str, function.Get("arguments").Str, depth+1)
		} else {
			builder.add(role, "tool_definition", path+"/description", callID, name, item.Get("description").Str)
		}
	case "function_call", "custom_tool_call":
		arguments := item.Get("arguments")
		if !arguments.Exists() {
			arguments = item.Get("input")
		}
		if arguments.Type == gjson.String {
			builder.content("assistant", "tool_call", path+"/arguments", callID, name, arguments.Str, depth+1)
		} else {
			builder.jsonContent("assistant", "tool_call", path+"/arguments", arguments, depth+1)
		}
	case "image", "image_url", "input_image", "input_audio", "audio", "video", "file", "input_file", "document":
		builder.omit("media_not_retained")
	case "reasoning":
		builder.omit("reasoning_not_retained")
	default:
		if content := item.Get("content"); content.Exists() {
			builder.jsonContent(role, kind, path+"/content", content, depth+1)
			return
		}
		if text := item.Get("text"); text.Type == gjson.String {
			builder.add(role, kind, path+"/text", callID, name, text.Str)
			return
		}
		fields := 0
		item.ForEach(func(key, value gjson.Result) bool {
			if fields >= 128 {
				builder.omit("object_field_limit")
				return false
			}
			fields++
			if inputAuditMediaField(key.Str) {
				builder.omit("media_not_retained")
				return true
			}
			builder.jsonContent(role, kind, path+"/"+boundedAuditText(key.Str, 128), value, depth+1)
			return true
		})
	}
}

func (builder *inputAuditEvidenceBuilder) gemini(role, path string, message dto.GeminiChatContent) {
	for i, part := range message.Parts {
		if i >= 512 {
			builder.omit("content_block_limit")
			break
		}
		partPath := fmt.Sprintf("%s/parts/%d", path, i)
		if part.Thought {
			builder.omit("reasoning_not_retained")
			continue
		}
		if part.Text != "" {
			builder.add(role, "message", partPath+"/text", "", "", part.Text)
		}
		if part.FunctionCall != nil {
			builder.content("assistant", "tool_call", partPath+"/functionCall/args", part.FunctionCall.ID, part.FunctionCall.FunctionName, part.FunctionCall.Arguments, 0)
		}
		if part.FunctionResponse != nil {
			builder.content("tool", "tool_result", partPath+"/functionResponse/response", gjson.ParseBytes(part.FunctionResponse.ID).Str, part.FunctionResponse.Name, part.FunctionResponse.Response, 0)
			if len(part.FunctionResponse.Parts) > 0 {
				builder.omit("media_not_retained")
			}
		}
		if part.InlineData != nil || part.FileData != nil {
			builder.omit("media_not_retained")
		}
		if part.ExecutableCode != nil {
			builder.add("assistant", "tool_call", partPath+"/executableCode", "", "", part.ExecutableCode.Code)
		}
		if part.CodeExecutionResult != nil {
			builder.add("tool", "tool_result", partPath+"/codeExecutionResult", "", "", part.CodeExecutionResult.Output)
		}
	}
}

func (r *InputAuditRecorder) captureEvidence(c *gin.Context, document model.InputAuditEvidenceDocument, contentHash string) string {
	if len(r.evidenceQueue) >= cap(r.evidenceQueue) {
		r.evidenceDropped.Add(1)
		return "queue_dropped"
	}
	body, err := common.Marshal(document)
	if err != nil {
		r.evidenceDropped.Add(1)
		return "capture_failed"
	}
	policy := request_plugin_setting.GetAllowlist()
	policy.Entries = slices.DeleteFunc(slices.Clone(policy.Entries), func(entry request_plugin_setting.AllowlistEntry) bool {
		return entry.UserID != common.GetContextKeyInt(c, constant.ContextKeyUserId)
	})
	policyJSON, err := common.Marshal(policy)
	if err != nil {
		r.evidenceDropped.Add(1)
		return "capture_failed"
	}
	bytes := int64(len(body) + len(policyJSON))
	if r.evidenceQueuedBytes.Add(bytes) > 16<<20 {
		r.evidenceQueuedBytes.Add(-bytes)
		r.evidenceDropped.Add(1)
		return "queue_dropped"
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
			return "pending"
		default:
		}
	}
	r.evidenceQueuedBytes.Add(-bytes)
	r.evidenceDropped.Add(1)
	return "queue_dropped"
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
