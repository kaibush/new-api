package service

import (
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
func (r *InputAuditRecorder) CaptureMatch(row model.InputAuditMatch, evidence *jsplugin.TransformMatchEvidence) {
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
	if evidence != nil {
		encoded, err := common.Marshal(evidence)
		if err == nil && len(encoded) <= 8192 {
			row.Evidence = string(encoded)
			row.SearchText = strings.ReplaceAll(evidence.Before+evidence.Match+evidence.After, "\x00", "␀")
		}
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
	r.matchDropped.Add(1)
}
