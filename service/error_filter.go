package service

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

type cachedErrorPolicy struct {
	raw    string
	policy *errorfilter.Policy
}

var errorPolicyCache atomic.Pointer[cachedErrorPolicy]

func PublicErrorPolicy() *errorfilter.Policy {
	raw := setting.ErrorFilterConfig()
	if cached := errorPolicyCache.Load(); cached != nil && cached.raw == raw {
		return cached.policy
	}
	_, policy, err := setting.ParseErrorFilter(raw)
	if err != nil {
		// A corrupt stored policy must not expose errors while it is repaired.
		fallback := errorfilter.Defaults()
		fallback.Enabled, fallback.Fallback = true, "replace"
		policy, _ = errorfilter.Compile(fallback)
		common.SysError("invalid error filter configuration; using a generic public error")
	}
	errorPolicyCache.Store(&cachedErrorPolicy{raw: raw, policy: policy})
	return policy
}

// FilterRelayErrors runs at the final response boundary, after retry decisions
// and accounting. Internal consumers continue to see the original error.
func FilterRelayErrors(c *gin.Context) func() {
	policy := PublicErrorPolicy()
	if !policy.Enabled() {
		return func() {}
	}
	w := &errorFilterWriter{ResponseWriter: c.Writer, context: c, policy: policy}
	c.Writer = w
	return func() { w.finish(); c.Writer = w.ResponseWriter }
}

func ErrorFilterInput(c *gin.Context, status int, message, kind, code string) errorfilter.Input {
	return errorfilter.Input{Message: message, Type: kind, Code: code, Status: status,
		ChannelID: c.GetInt("channel_id"), Model: c.GetString("original_model"), RequestID: c.GetString(common.RequestIdKey)}
}

const errorFilterSourceMessage = "public_error_filter_source_message"

// SetErrorFilterSource lets rules match the original upstream message before
// New API's built-in URL masking. The original stays in process only.
func SetErrorFilterSource(c *gin.Context, message string) {
	c.Set(errorFilterSourceMessage, message)
	if writer, ok := c.Writer.(*errorFilterWriter); ok {
		writer.mu.Lock()
		writer.errorResponse = true
		writer.mu.Unlock()
	}
}

// RewritePublicError is shared by wire responses and the administrator's
// preview, so a preview uses the same matching and error shape as a real call.
func RewritePublicError(policy *errorfilter.Policy, in errorfilter.Input, body []byte, force bool) ([]byte, errorfilter.Result) {
	result := errorfilter.Result{Input: in, Action: "preserve"}
	if !policy.Enabled() {
		return body, result
	}
	var envelope map[string]any
	if err := common.Unmarshal(body, &envelope); err != nil || envelope == nil {
		if !force {
			return body, result
		}
		envelope = map[string]any{"error": map[string]any{"message": string(body)}}
	}
	container := envelope
	nested := false
	if response, ok := envelope["response"].(map[string]any); ok && response["error"] != nil {
		container, nested = response, true
	}
	var fields map[string]any
	flat := false
	switch value := container["error"].(type) {
	case map[string]any:
		fields = value
	case string:
		if value != "" {
			fields = map[string]any{"message": value}
		}
	}
	if fields == nil {
		if force || envelope["type"] == "error" || envelope["type"] == "response.failed" {
			fields, flat = container, true
		} else {
			return body, result
		}
	}
	message := ""
	for _, key := range []string{"message", "msg", "detail", "error_msg"} {
		if value, ok := fields[key].(string); ok && value != "" {
			message = value
			break
		}
	}
	if in.Message == "" {
		in.Message = message
	}
	if kind, ok := fields["type"].(string); ok {
		in.Type = kind
	}
	if code := fields["code"]; code != nil {
		in.Code = fmt.Sprint(code)
	}
	result = policy.Apply(in)
	if result.Action == "preserve" {
		return body, result
	}
	// Retain built-in address masking for the parts of the upstream message
	// kept by a partial replacement. Full replacements are administrator-authored.
	if result.Action == "redact" {
		result.Message = kitutil.MaskSensitiveInfo(result.Message)
	}
	output := fields
	if result.StripDetails {
		output = make(map[string]any)
		kind, code := publicErrorKinds(in.Status, in.Type, in.Code)
		if kind != "" {
			output["type"] = kind
		}
		if code != "" {
			output["code"] = code
		}
		if _, ok := fields["param"]; ok {
			output["param"] = nil
		}
		// Gemini has a numeric error code and a symbolic status.
		if _, numeric := fields["code"].(float64); numeric {
			output["code"] = in.Status
			if status, ok := fields["status"].(string); ok {
				for _, allowed := range []string{"INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"} {
					if status == allowed {
						output["status"] = status
					}
				}
			}
		}
	}
	for _, key := range []string{"msg", "detail", "error_msg"} {
		if _, ok := output[key]; ok {
			output[key] = result.Message
		}
	}
	output["message"] = result.Message
	if result.TypeChanged {
		output["type"] = result.Type
	}
	if result.CodeChanged {
		output["code"] = result.Code
	}
	result.Type, _ = output["type"].(string)
	result.Code = ""
	if code := output["code"]; code != nil {
		result.Code = fmt.Sprint(code)
	}
	if flat {
		if result.StripDetails {
			if envelope["type"] == "error" {
				output["type"] = "error"
				envelope = output
			} else if envelope["type"] == "response.failed" {
				envelope = map[string]any{"type": "response.failed", "response": map[string]any{"status": "failed", "error": output}}
			} else {
				envelope = map[string]any{"error": output}
			}
		} else {
			envelope = output
		}
	} else {
		container["error"] = output
		if result.StripDetails {
			if nested {
				response := map[string]any{"error": output, "status": "failed"}
				for _, key := range []string{"id", "object", "created_at"} {
					if v, ok := container[key]; ok {
						response[key] = v
					}
				}
				envelope = map[string]any{"type": "response.failed", "response": response}
			} else {
				kind := envelope["type"]
				envelope = map[string]any{"error": output}
				if kind == "error" {
					envelope["type"] = "error"
				}
			}
		}
	}
	rewritten, err := common.Marshal(envelope)
	if err != nil {
		return []byte(`{"error":{"message":"Request failed","type":"api_error"}}`), result
	}
	return rewritten, result
}

func publicErrorKinds(status int, kind, code string) (string, string) {
	switch kind {
	case "invalid_request_error", "authentication_error", "permission_error", "not_found_error", "request_too_large", "rate_limit_error", "rate_limit_exceeded", "overloaded_error", "server_error", "api_error":
	default:
		switch status {
		case 400, 422:
			kind = "invalid_request_error"
		case 401:
			kind = "authentication_error"
		case 403:
			kind = "permission_error"
		case 404:
			kind = "not_found_error"
		case 413:
			kind = "request_too_large"
		case 429:
			kind = "rate_limit_error"
		default:
			kind = "api_error"
		}
	}
	switch code {
	case "context_length_exceeded", "rate_limit_exceeded", "request_too_large", "max_output_tokens", "invalid_request_error":
	default:
		code = ""
	}
	return kind, code
}

// The writer only buffers HTTP failures and individual SSE events. Successful
// non-streaming payloads never enter the JSON parser.
type errorFilterWriter struct {
	gin.ResponseWriter
	context         *gin.Context
	policy          *errorfilter.Policy
	mu              sync.Mutex
	status          int
	body            bytes.Buffer
	stream          bytes.Buffer
	overflow        bool
	streamAborted   bool
	streamFailure   bool
	bufferedWritten bool
	errorResponse   bool
}

func (w *errorFilterWriter) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.bufferedWritten {
		return
	}
	if w.ResponseWriter.Written() {
		if (status >= 400 || w.errorResponse) && strings.HasPrefix(w.Header().Get("Content-Type"), "text/event-stream") {
			w.status, w.streamFailure = status, true
		}
		return
	}
	w.status = status
	w.policy.FilterHeaders(w.Header())
	if status < 400 && !w.errorResponse {
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *errorFilterWriter) WriteHeaderNow() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.policy.FilterHeaders(w.Header())
	if w.status >= 400 || w.errorResponse {
		w.bufferedWritten = true
		return
	}
	w.ResponseWriter.WriteHeaderNow()
}

func (w *errorFilterWriter) Status() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.status != 0 {
		return w.status
	}
	return w.ResponseWriter.Status()
}
func (w *errorFilterWriter) Written() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.bufferedWritten || w.ResponseWriter.Written()
}
func (w *errorFilterWriter) Size() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if (w.status >= 400 || w.errorResponse) && w.bufferedWritten {
		return w.body.Len()
	}
	return w.ResponseWriter.Size()
}
func (w *errorFilterWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }

func (w *errorFilterWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	size := len(data)
	w.policy.FilterHeaders(w.Header())
	if w.status >= 400 || w.errorResponse {
		w.bufferedWritten = true
		if !w.overflow && w.body.Len()+len(data) <= errorfilter.MaxErrorBytes {
			w.body.Write(data)
		} else {
			w.overflow = true
			w.body.Reset()
		}
		return len(data), nil
	}
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/event-stream") {
		return w.ResponseWriter.Write(data)
	}
	if w.streamAborted {
		return 0, errors.New("SSE event exceeds configured stream buffer")
	}
	// Use the existing stream scanner limit, including large image events.
	limit := 128 << 20
	if constant.StreamScannerMaxBufferMB > 0 {
		limit = constant.StreamScannerMaxBufferMB << 20
	}
	for len(data) > 0 {
		// Append one line at a time to enforce the bound before allocating a frame.
		count := len(data)
		if at := bytes.IndexByte(data, '\n'); at >= 0 {
			count = at + 1
		}
		if w.stream.Len()+count > limit {
			w.stream.Reset()
			w.streamAborted = true
			_, _ = w.ResponseWriter.Write([]byte("event: error\ndata: {\"error\":{\"message\":\"Stream event exceeds the configured size limit\",\"type\":\"api_error\"}}\n\n"))
			return 0, errors.New("SSE event exceeds configured stream buffer")
		}
		w.stream.Write(data[:count])
		data = data[count:]
		buffered := w.stream.Bytes()
		if bytes.HasSuffix(buffered, []byte("\n\n")) || bytes.HasSuffix(buffered, []byte("\r\n\r\n")) {
			if _, err := w.ResponseWriter.Write(w.rewriteEvent(buffered)); err != nil {
				return 0, err
			}
			w.stream.Reset()
		}
	}
	return size, nil
}

func (w *errorFilterWriter) rewriteEvent(event []byte) []byte {
	var lines []string
	eventName := ""
	for line := range strings.SplitSeq(strings.ReplaceAll(string(event), "\r\n", "\n"), "\n") {
		if value, ok := strings.CutPrefix(line, "data:"); ok {
			lines = append(lines, strings.TrimPrefix(value, " "))
		}
		if value, ok := strings.CutPrefix(line, "event:"); ok {
			eventName = strings.TrimSpace(value)
		}
	}
	data := []byte(strings.Join(lines, "\n"))
	if len(data) == 0 || string(data) == "[DONE]" {
		return event
	}
	in := ErrorFilterInput(w.context, w.ResponseWriter.Status(), "", "", "")
	var parsed map[string]any
	if common.Unmarshal(data, &parsed) == nil {
		if s, ok := parsed["status_code"].(float64); ok && s >= 400 && s <= 599 {
			in.Status = int(s)
		}
		container := parsed
		if r, ok := parsed["response"].(map[string]any); ok {
			container = r
		}
		if e, ok := container["error"].(map[string]any); ok {
			if s, ok := e["code"].(float64); ok && s >= 400 && s <= 599 {
				in.Status = int(s)
			}
			if e["type"] == "request_too_large" || e["code"] == "request_too_large" {
				in.Status = 413
			}
		}
	}
	rewritten, result := RewritePublicError(w.policy, in, data, eventName == "error" || eventName == "response.failed")
	if result.Action == "preserve" {
		return event
	}
	var out strings.Builder
	if result.StripDetails {
		if eventName == "error" || eventName == "response.failed" {
			out.WriteString("event: ")
			out.WriteString(eventName)
			out.WriteByte('\n')
		}
	} else {
		for line := range strings.SplitSeq(strings.ReplaceAll(string(event), "\r\n", "\n"), "\n") {
			if line != "" && !strings.HasPrefix(line, "data:") {
				out.WriteString(line)
				out.WriteByte('\n')
			}
		}
	}
	out.WriteString("data: ")
	out.Write(rewritten)
	out.WriteString("\n\n")
	return []byte(out.String())
}

func (w *errorFilterWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.policy.FilterHeaders(w.Header())
	if w.status < 400 && !w.errorResponse {
		w.ResponseWriter.Flush()
	}
}

func (w *errorFilterWriter) finish() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.policy.FilterHeaders(w.Header())
	if w.status >= 400 || w.errorResponse {
		data := w.body.Bytes()
		in := ErrorFilterInput(w.context, w.status, w.context.GetString(errorFilterSourceMessage), "", "")
		encoding := w.Header().Get("Content-Encoding")
		if encoding != "" && !w.streamFailure {
			w.overflow = true
			if encoding == "gzip" {
				reader, err := gzip.NewReader(bytes.NewReader(data))
				if err == nil {
					decoded, readErr := io.ReadAll(io.LimitReader(reader, errorfilter.MaxErrorBytes+1))
					_ = reader.Close()
					if readErr == nil && len(decoded) <= errorfilter.MaxErrorBytes {
						data, w.overflow = decoded, false
					}
				}
			}
			w.Header().Del("Content-Encoding")
		}
		if w.overflow {
			data = []byte(`{"error":{"message":"Unable to read upstream error response","type":"api_error"}}`)
			in.Message = ""
		}
		rewritten, result := RewritePublicError(w.policy, in, data, true)
		if w.streamFailure {
			// Headers were committed by earlier events, so finish with an SSE error.
			if w.stream.Len() > 0 {
				_, _ = w.ResponseWriter.Write(w.rewriteEvent(w.stream.Bytes()))
			}
			_, _ = w.ResponseWriter.Write(append(append([]byte("event: error\ndata: "), rewritten...), []byte("\n\n")...))
			w.ResponseWriter.Flush()
			return
		}
		if result.Action != "preserve" || w.overflow {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		w.Header().Del("Content-Length")
		w.ResponseWriter.WriteHeader(w.status)
		_, _ = w.ResponseWriter.Write(rewritten)
	} else if w.stream.Len() > 0 && !w.streamAborted {
		_, _ = w.ResponseWriter.Write(w.rewriteEvent(w.stream.Bytes()))
	}
}
