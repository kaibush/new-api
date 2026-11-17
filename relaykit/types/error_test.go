package types

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPolicyErrorMaskingPreservesOnlyLocalRuleCodes(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  *NewAPIError
		want string
	}{
		{"local policy", NewError(errors.New("Blocked https://private.example/secret?key=credential (code: reply.blocked)"), ErrorCodeRequestRejected), "Blocked https://***.example/***?key=*** (code: reply.blocked)"},
		{"upstream policy-like text", NewOpenAIError(errors.New("Blocked https://private.example/secret?key=credential (code: private.example)"), ErrorCodeRequestRejected, http.StatusBadRequest), "Blocked https://***.example/***?key=*** (code: ***.example)"},
		{"ordinary local error", NewError(errors.New("Failed https://private.example/secret?key=credential (code: private.example)"), ErrorCodeBadResponse), "Failed https://***.example/***?key=*** (code: ***.example)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.err.MaskSensitiveError())
			assert.Equal(t, tc.want, tc.err.ToOpenAIError().Message)
			assert.Equal(t, tc.want, tc.err.ToClaudeError().Message)
		})
	}
}
