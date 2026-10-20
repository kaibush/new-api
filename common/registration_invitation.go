package common

import (
	"crypto/sha256"
	"strings"
)

func RegistrationInvitationHash(code string) []byte {
	code = strings.TrimSpace(code)
	if len(code) < 16 || len(code) > 128 {
		return nil
	}
	hash := sha256.Sum256([]byte(code))
	return hash[:]
}

func IsRegistrationInvitationEnabled() bool {
	OptionMapRWMutex.RLock()
	defer OptionMapRWMutex.RUnlock()
	return RegistrationInvitationEnabled
}
