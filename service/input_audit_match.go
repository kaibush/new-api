package service

import (
	"bytes"
	"compress/gzip"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
)

func (r *InputAuditRecorder) MatchCaptureEnabled() bool {
	s := r.settings.Load()
	return s.Enabled && s.EvidenceEnabled
}

// CaptureMatch never retains the request or performs I/O on the relay path.
// Invalid/missing evidence is still a useful rejection record, explicitly
// lacking a quote. The queue is independently bounded and drops are visible.
func (r *InputAuditRecorder) CaptureMatch(row model.InputAuditMatch, evidence *jsplugin.TransformMatchEvidence, requestBody ...[]byte) {
	settings := r.settings.Load()
	if !settings.Enabled || !settings.EvidenceEnabled || row.UserId < 1 || row.RequestId == "" {
		return
	}
	row.RequestId = boundedAuditText(row.RequestId, 64)
	row.Instance = boundedAuditText(row.Instance, 128)
	row.Name = boundedAuditText(row.Name, 256)
	row.Plugin = boundedAuditText(row.Plugin, 128)
	row.PluginVersion = boundedAuditText(row.PluginVersion, 64)
	row.Stage = boundedAuditText(row.Stage, 32)
	row.Rule = boundedAuditText(row.Rule, 256)
	row.Model = boundedAuditText(row.Model, 256)
	row.CreatedAt, row.Status, row.Version = time.Now().Unix(), "pending", 1
	row.RequestMaxChars = settings.MatchMaxChars
	row.RequestState = "not_captured"
	if evidence != nil {
		encoded, err := common.Marshal(evidence)
		if err == nil && len(encoded) <= 8192 {
			row.Evidence = string(encoded)
			row.SearchText = strings.ReplaceAll(evidence.Before+evidence.Match+evidence.After, "\x00", "␀")
		}
	}
	if len(requestBody) > 0 {
		document := ExtractInputAuditMatchRequest(requestBody[0], settings.MatchMaxChars)
		body, err := common.Marshal(document)
		if err == nil && len(body) <= 8<<20 {
			var compressed bytes.Buffer
			writer, zipErr := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
			if zipErr == nil {
				_, err = writer.Write(body)
				zipErr = writer.Close()
				if err == nil && zipErr == nil {
					row.RequestBody = compressed.Bytes()
					row.RequestState = "retained"
				}
			}
		}
		if row.RequestState != "retained" {
			row.RequestState = "capture_failed"
		}
	}
	queuedBytes := int64(len(row.RequestBody))
	if r.matchQueuedBytes.Add(queuedBytes) > 16<<20 {
		r.matchQueuedBytes.Add(-queuedBytes)
		queuedBytes = 0
		row.RequestBody = nil
		row.RequestState = "queue_dropped"
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.closed {
		select {
		case r.matchQueue <- row:
			return
		default:
		}
	}
	r.matchQueuedBytes.Add(-queuedBytes)
	r.matchDropped.Add(1)
}
