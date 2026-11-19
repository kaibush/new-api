package request_plugin_setting

import (
	"slices"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

const AllowlistOption = "request_plugin_setting.allowlist"

type AllowlistEntry struct {
	ID        string   `json:"id"`
	UserID    int      `json:"user_id"`
	Instances []string `json:"instances"`
	Reason    string   `json:"reason"`
	ExpiresAt int64    `json:"expires_at"`
	CreatedAt int64    `json:"created_at"`
	CreatedBy int      `json:"created_by"`
	UpdatedAt int64    `json:"updated_at"`
	UpdatedBy int      `json:"updated_by"`
}

type Allowlist struct {
	Version int64            `json:"version"`
	Entries []AllowlistEntry `json:"entries"`
}

var allowlistMu sync.RWMutex

func (policy *Allowlist) UnmarshalJSON(data []byte) error {
	type plain Allowlist
	var decoded plain
	if err := common.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.Entries == nil {
		decoded.Entries = []AllowlistEntry{}
	}
	allowlistMu.Lock()
	*policy = Allowlist(decoded)
	allowlistMu.Unlock()
	return nil
}

// Snapshots are immutable and retained by each request's plugin plan.
func GetAllowlist() Allowlist {
	allowlistMu.RLock()
	defer allowlistMu.RUnlock()
	return requestPluginSetting.Allowlist
}

// Match checks the policy against eligibility from the loaded plugin snapshot.
func (policy Allowlist) Match(userID int, instanceID string, supportsUserAllowlist bool, now int64) *AllowlistEntry {
	if userID < 1 || !supportsUserAllowlist {
		return nil
	}
	for i := range policy.Entries {
		entry := &policy.Entries[i]
		if entry.UserID == userID && entry.ExpiresAt > now && slices.Contains(entry.Instances, instanceID) {
			return entry
		}
	}
	return nil
}
