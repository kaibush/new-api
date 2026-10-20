package controller

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/fxamacker/cbor/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newSecurityLoginPasskey(t *testing.T, userID int) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	credentialID := sha256.Sum256(elliptic.Marshal(key.Curve, key.X, key.Y))
	publicKey, err := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.PasskeyCredential{
		UserID: userID, CredentialID: base64.StdEncoding.EncodeToString(credentialID[:]), PublicKey: base64.StdEncoding.EncodeToString(publicKey),
		UserPresent: true, UserVerified: true,
	}).Error)
	return key
}

func beginSecurityLoginPasskey(t *testing.T, parentToken string) (string, string) {
	t.Helper()
	body, err := common.Marshal(map[string]string{"flow_token": parentToken})
	require.NoError(t, err)
	response := securityEnrollmentRequest("POST", "/api/user/login/passkey/begin", string(body), "", service.AuthIdentity{}, LoginPasskeyBegin)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			FlowToken string `json:"flow_token"`
			Options   struct {
				PublicKey struct {
					Challenge        string `json:"challenge"`
					UserVerification string `json:"userVerification"`
				} `json:"publicKey"`
			} `json:"options"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	require.Equal(t, "required", result.Data.Options.PublicKey.UserVerification)
	return result.Data.FlowToken, result.Data.Options.PublicKey.Challenge
}

func TestSecurityLoginCodeCompletesOnce(t *testing.T) {
	for _, test := range []struct {
		path   string
		backup bool
	}{{"/api/user/login/verify", false}, {"/api/user/login/2fa", false}, {"/api/user/login/verify", true}} {
		t.Run(fmt.Sprintf("%s/backup=%t", test.path, test.backup), func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			factor := &model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
			require.NoError(t, model.DB.Create(factor).Error)
			challenge, err := service.StartLoginVerification(user, "password", nil)
			require.NoError(t, err)
			require.NotNil(t, challenge)
			code, err := totp.GenerateCode(factor.Secret, time.Now())
			require.NoError(t, err)
			if test.backup {
				code = "ABCD-1234"
				hash, err := common.HashBackupCode(code)
				require.NoError(t, err)
				require.NoError(t, model.DB.Create(&model.TwoFABackupCode{UserId: user.Id, CodeHash: hash}).Error)
			}
			body, err := common.Marshal(map[string]string{"flow_token": challenge.FlowToken, "code": code})
			require.NoError(t, err)
			router := gin.New()
			router.POST("/api/user/login/verify", VerifyLogin)
			router.POST("/api/user/login/2fa", Verify2FALogin)
			for attempt := range 2 {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("POST", test.path, strings.NewReader(string(body))))
				var result securityEnrollmentResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.Equal(t, attempt == 0, result.Success, response.Body.String())
				if attempt == 0 {
					var bundle service.AuthBundle
					require.NoError(t, common.Unmarshal(result.Data, &bundle))
					assert.NotEmpty(t, bundle.AccessToken)
					assert.Equal(t, "password", bundle.Session.LoginMethod)
					assert.NotEmpty(t, response.Header().Values("Set-Cookie"))
				} else {
					assert.Empty(t, response.Header().Values("Set-Cookie"))
				}
			}
			count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			assert.EqualValues(t, 2, count)
		})
	}
}

func TestSecurityLoginRejectsChangedOrExpiredAuthorization(t *testing.T) {
	for _, change := range []string{"expired", "disabled user", "auth version", "factor removed", "factor locked", "legacy flow", "wrong method", "other purpose"} {
		t.Run(change, func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			factor := &model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
			require.NoError(t, model.DB.Create(factor).Error)
			challenge, err := service.StartLoginVerification(user, "password", nil)
			require.NoError(t, err)
			method := "2fa"
			switch change {
			case "expired":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposeLoginVerification).Update("expires_at", time.Now().Add(-time.Minute)).Error)
			case "disabled user":
				require.NoError(t, model.DB.Model(user).Update("status", common.UserStatusDisabled).Error)
			case "auth version":
				require.NoError(t, model.DB.Model(user).Update("auth_version", user.AuthVersion+1).Error)
			case "factor removed":
				require.NoError(t, model.DB.Delete(factor).Error)
			case "factor locked":
				require.NoError(t, model.DB.Model(factor).Update("locked_until", time.Now().Add(time.Minute)).Error)
			case "legacy flow":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposeLoginVerification).Update("purpose", model.AuthFlowPurposeTwoFALogin).Error)
			case "wrong method":
				method = "password"
			case "other purpose":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposeLoginVerification).Update("purpose", model.AuthFlowPurposeSecurityProof).Error)
			}
			code, err := totp.GenerateCode(factor.Secret, time.Now())
			require.NoError(t, err)
			body, err := common.Marshal(map[string]string{"flow_token": challenge.FlowToken, "code": code, "method": method})
			require.NoError(t, err)
			response := securityEnrollmentRequest("POST", "/api/user/login/verify", string(body), "", service.AuthIdentity{}, VerifyLogin)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success, change)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			assert.EqualValues(t, 1, count)
		})
	}
}

func TestSecurityLoginPasskeyDoesNotRequireAdditionalTwoFA(t *testing.T) {
	for _, direct := range []bool{false, true} {
		t.Run(fmt.Sprintf("direct=%t", direct), func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			key := newSecurityLoginPasskey(t, user.Id)
			require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
			for _, verified := range []bool{false, true} {
				var flowToken, challenge, parentToken string
				if direct {
					response := securityEnrollmentRequest("POST", "/api/user/passkey/login/begin", "", "", service.AuthIdentity{}, PasskeyLoginBegin)
					var result struct {
						Data struct {
							FlowToken string `json:"flow_token"`
							Options   struct {
								PublicKey struct {
									Challenge        string `json:"challenge"`
									UserVerification string `json:"userVerification"`
								} `json:"publicKey"`
							} `json:"options"`
						} `json:"data"`
					}
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					require.Equal(t, "required", result.Data.Options.PublicKey.UserVerification)
					flowToken, challenge = result.Data.FlowToken, result.Data.Options.PublicKey.Challenge
				} else {
					pending, err := service.StartLoginVerification(user, "oauth:github", nil)
					require.NoError(t, err)
					parentToken = pending.FlowToken
					flowToken, challenge = beginSecurityLoginPasskey(t, parentToken)
				}
				var assertion map[string]any
				require.NoError(t, common.Unmarshal(securityPasskeyResponse(t, key, challenge, false, 0, verified), &assertion))
				if direct {
					response, ok := assertion["response"].(map[string]any)
					require.True(t, ok)
					response["userHandle"] = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprint(user.Id)))
				}
				payload := map[string]any{"flow_token": flowToken, "credential": assertion}
				handler, path := PasskeyLoginFinish, "/api/user/passkey/login/finish"
				if !direct {
					payload["flow_token"], payload["passkey_flow_token"] = parentToken, flowToken
					handler, path = LoginPasskeyFinish, "/api/user/login/passkey/finish"
				}
				body, err := common.Marshal(payload)
				require.NoError(t, err)
				router := gin.New()
				router.POST(path, handler)
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(string(body))))
				var result securityEnrollmentResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				require.Equal(t, verified, result.Success, response.Body.String())
				if verified {
					var bundle service.AuthBundle
					require.NoError(t, common.Unmarshal(result.Data, &bundle))
					assert.NotEmpty(t, bundle.AccessToken)
				} else {
					assert.Empty(t, response.Header().Values("Set-Cookie"))
				}
			}
		})
	}
}

func TestSecurityLoginPasskeyConcurrentCompletionCreatesOneSession(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	key := newSecurityLoginPasskey(t, user.Id)
	pending, err := service.StartLoginVerification(user, "password", nil)
	require.NoError(t, err)
	requests := make([]string, 2)
	for index := range requests {
		token, challenge := beginSecurityLoginPasskey(t, pending.FlowToken)
		body, err := common.Marshal(map[string]any{
			"flow_token": pending.FlowToken, "passkey_flow_token": token,
			"credential": securityPasskeyResponse(t, key, challenge, false, 0),
		})
		require.NoError(t, err)
		requests[index] = string(body)
	}
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	var workers sync.WaitGroup
	for _, body := range requests {
		workers.Go(func() {
			<-start
			responses <- securityEnrollmentRequest("POST", "/api/user/login/passkey/finish", body, "", service.AuthIdentity{}, LoginPasskeyFinish)
		})
	}
	close(start)
	workers.Wait()
	close(responses)
	successes := 0
	for response := range responses {
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		if result.Success {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
	require.NoError(t, err)
	assert.EqualValues(t, 2, count)
}

func TestSecurityLoginSessionFailureRollsBackChallengeConsumption(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	key := newSecurityLoginPasskey(t, user.Id)
	pending, err := service.StartLoginVerification(user, "password", nil)
	require.NoError(t, err)
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("login_session_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "user_sessions" {
			tx.AddError(errors.New("private session creation failure"))
		}
	}))
	t.Cleanup(func() { _ = model.DB.Callback().Create().Remove("login_session_failure") })
	for _, fail := range []bool{true, false} {
		token, challenge := beginSecurityLoginPasskey(t, pending.FlowToken)
		body, err := common.Marshal(map[string]any{"flow_token": pending.FlowToken, "passkey_flow_token": token, "credential": securityPasskeyResponse(t, key, challenge, false, 0)})
		require.NoError(t, err)
		response := securityEnrollmentRequest("POST", "/api/user/login/passkey/finish", string(body), "", service.AuthIdentity{}, LoginPasskeyFinish)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, !fail, result.Success, response.Body.String())
		if fail {
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			assert.NotContains(t, response.Body.String(), "private")
			_, err = model.GetAuthFlow(pending.FlowToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeLoginVerification})
			require.NoError(t, err, "a failed session transaction must leave the parent challenge usable")
			require.NoError(t, model.DB.Callback().Create().Remove("login_session_failure"))
		}
	}
	count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
	require.NoError(t, err)
	assert.EqualValues(t, 2, count)
}

func TestSecurityLoginFactorStateDoesNotAddPasswordLoginQueries(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	newSecurityLoginPasskey(t, user.Id)
	previousPasswordLogin := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() { common.PasswordLoginEnabled = previousPasswordLogin })
	queries := 0
	require.NoError(t, model.DB.Callback().Query().After("gorm:query").Register("login_query_count", func(tx *gorm.DB) {
		if !tx.DryRun {
			queries++
		}
	}))
	t.Cleanup(func() { _ = model.DB.Callback().Query().Remove("login_query_count") })
	state, err := model.GetUserVerificationState(user.Id)
	require.NoError(t, err)
	assert.True(t, state.HasPassword)
	assert.True(t, state.HasPasskey)
	assert.False(t, state.HasTwoFA)
	assert.Equal(t, 1, queries, "factor availability must be one database round trip")
	queries = 0
	response := securityEnrollmentRequest("POST", "/api/user/login", `{"username":"enrollment-user","password":"enrollment-password"}`, "", service.AuthIdentity{}, Login)
	assert.Contains(t, response.Body.String(), `"require_verification":true`)
	assert.Equal(t, 2, queries, "only the existing credential lookup and the replacement factor-state lookup run before the challenge")
}

type boundLoginOAuthProvider struct {
	authFlowTestOAuthProvider
	userID int
}

func (*boundLoginOAuthProvider) IsUserIDTaken(string) bool    { return true }
func (*boundLoginOAuthProvider) ProviderUserIDColumn() string { return "github_id" }
func (provider *boundLoginOAuthProvider) FillUserByProviderID(user *model.User, _ string) error {
	return model.DB.First(user, provider.userID).Error
}

func TestSecurityLoginAllPrimaryTransportsRequireAdditionalVerification(t *testing.T) {
	for _, transport := range []string{"oauth", "custom oauth", "wechat", "telegram"} {
		t.Run(transport, func(t *testing.T) {
			var user *model.User
			var telegram *telegramOAuthFixture
			if transport == "telegram" {
				telegram = setupTelegramOAuthTest(t)
				user = telegram.user
			} else {
				user, _ = setupSecurityEnrollmentTest(t)
			}
			newSecurityLoginPasskey(t, user.Id)
			var response *httptest.ResponseRecorder
			switch transport {
			case "telegram":
				require.NoError(t, model.DB.Model(user).Update("telegram_id", "42").Error)
				state, code := telegram.authorization(t, "login", service.AuthIdentity{}, "", telegramIdentityClaims(42))
				response = telegramOAuthCallback(state, code, service.AuthIdentity{})
			case "wechat":
				require.NoError(t, model.DB.Model(user).Update("wechat_id", "bound-wechat").Error)
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					assert.Equal(t, "wechat-code", r.URL.Query().Get("code"))
					_, _ = w.Write([]byte(`{"success":true,"data":"bound-wechat"}`))
				}))
				t.Cleanup(upstream.Close)
				previousEnabled, previousAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
				common.WeChatAuthEnabled, common.WeChatServerAddress = true, upstream.URL
				t.Cleanup(func() { common.WeChatAuthEnabled, common.WeChatServerAddress = previousEnabled, previousAddress })
				response = securityEnrollmentRequest("GET", "/api/oauth/wechat?code=wechat-code", "", "", service.AuthIdentity{}, WeChatAuth)
			default:
				const slug = "unified-login-test"
				if transport == "custom oauth" {
					upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						if r.URL.Path == "/token" {
							_, _ = w.Write([]byte(`{"access_token":"provider-token","token_type":"Bearer"}`))
							return
						}
						_, _ = w.Write([]byte(`{"sub":"bound-custom","name":"User"}`))
					}))
					t.Cleanup(upstream.Close)
					oauth.RegisterCustom(slug, oauth.NewGenericOAuthProvider(&model.CustomOAuthProvider{
						Id: 42, Slug: slug, Name: "Custom login", Enabled: true, ClientId: "client", ClientSecret: "secret", UserIdField: "sub",
						TokenEndpoint: upstream.URL + "/token", UserInfoEndpoint: upstream.URL + "/userinfo",
					}))
					require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: user.Id, ProviderId: 42, ProviderUserId: "bound-custom"}).Error)
				} else {
					oauth.Register(slug, &boundLoginOAuthProvider{userID: user.Id})
				}
				t.Cleanup(func() { oauth.Unregister(slug) })
				token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: model.AuthFlowPurposeOAuth, Provider: slug, Intent: model.AuthFlowIntentLogin, Payload: `{}`, ExpiresAt: time.Now().Add(time.Minute)})
				require.NoError(t, err)
				router := gin.New()
				router.GET("/api/oauth/:provider", HandleOAuth)
				response = httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("GET", "/api/oauth/"+slug+"?state="+token+"&code=provider-code", nil))
			}
			var result struct {
				Success bool                   `json:"success"`
				Data    service.LoginChallenge `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			assert.True(t, result.Data.RequireVerification)
			assert.Equal(t, []service.VerificationMethodOption{{Method: "passkey", Available: true}}, result.Data.Methods)
			assert.NotEmpty(t, result.Data.FlowToken)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			assert.EqualValues(t, 1, count)
		})
	}
}

func TestSecurityLoginPasskeyCannotCompleteAnotherChallenge(t *testing.T) {
	for _, otherUser := range []bool{false, true} {
		t.Run(fmt.Sprintf("other-user=%t", otherUser), func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			key := newSecurityLoginPasskey(t, user.Id)
			first, err := service.StartLoginVerification(user, "password", nil)
			require.NoError(t, err)
			passkeyToken, challenge := beginSecurityLoginPasskey(t, first.FlowToken)
			if otherUser {
				user = &model.User{Username: "other-login", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-login", AuthVersion: 1}
				require.NoError(t, model.DB.Create(user).Error)
				newSecurityLoginPasskey(t, user.Id)
			}
			second, err := service.StartLoginVerification(user, "password", nil)
			require.NoError(t, err)
			body, err := common.Marshal(map[string]any{"flow_token": second.FlowToken, "passkey_flow_token": passkeyToken, "credential": securityPasskeyResponse(t, key, challenge, false, 0)})
			require.NoError(t, err)
			response := securityEnrollmentRequest("POST", "/api/user/login/passkey/finish", string(body), "", service.AuthIdentity{}, LoginPasskeyFinish)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			var count int64
			require.NoError(t, model.DB.Model(&model.UserSession{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		})
	}
}

func TestSecurityLoginPasskeyCanManageTwoFAWithScopedProofs(t *testing.T) {
	for _, scope := range []string{service.VerificationScopeTwoFADisable, service.VerificationScopeTwoFABackupCodes} {
		t.Run(scope, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			key := newSecurityLoginPasskey(t, user.Id)
			require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
			hash, err := common.HashBackupCode("ABCD-1234")
			require.NoError(t, err)
			require.NoError(t, model.DB.Create(&model.TwoFABackupCode{UserId: user.Id, CodeHash: hash}).Error)
			if scope == service.VerificationScopeTwoFABackupCodes {
				_, err := service.VerifySecurityInput(identity, service.VerificationInput{Scope: scope, Method: "2fa", Code: "ABCD-1234"})
				assert.ErrorIs(t, err, service.ErrVerificationFailed)
				remaining, err := model.GetUnusedBackupCodeCount(user.Id)
				require.NoError(t, err)
				assert.Equal(t, 1, remaining, "backup codes cannot authorize generating replacement backup codes")
			}
			beginBody, err := common.Marshal(map[string]string{"scope": scope})
			require.NoError(t, err)
			response := securityEnrollmentRequest("POST", "/api/user/passkey/verify/begin", string(beginBody), "", identity, PasskeyVerifyBegin)
			var started struct {
				Success bool `json:"success"`
				Data    struct {
					FlowToken string `json:"flow_token"`
					Options   struct {
						PublicKey struct {
							Challenge        string `json:"challenge"`
							UserVerification string `json:"userVerification"`
						} `json:"publicKey"`
					} `json:"options"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &started))
			require.True(t, started.Success, response.Body.String())
			assert.Equal(t, "required", started.Data.Options.PublicKey.UserVerification)
			finish, err := common.Marshal(passkeyFinishRequest{FlowToken: started.Data.FlowToken, Credential: securityPasskeyResponse(t, key, started.Data.Options.PublicKey.Challenge, false, 0)})
			require.NoError(t, err)
			response = securityEnrollmentRequest("POST", "/api/user/passkey/verify/finish", string(finish), "", identity, PasskeyVerifyFinish)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			var proof service.SecurityProof
			require.NoError(t, common.Unmarshal(result.Data, &proof))
			handler, path := Disable2FA, "/api/user/2fa/disable"
			if scope == service.VerificationScopeTwoFABackupCodes {
				handler, path = RegenerateBackupCodes, "/api/user/2fa/backup_codes"
				response = securityEnrollmentRequest("POST", "/api/user/2fa/disable", `{}`, proof.ProofToken, identity, Disable2FA)
				assert.Contains(t, response.Body.String(), "SECURITY_PROOF_SCOPE_MISMATCH")
			}
			response = securityEnrollmentRequest("POST", path, `{}`, proof.ProofToken, identity, handler)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			stored, err := model.GetUserById(user.Id, false)
			require.NoError(t, err)
			assert.Equal(t, identity.UserAuthVersion+1, stored.AuthVersion)
			_, err = model.GetPasskeyByUserID(user.Id)
			require.NoError(t, err, "managing 2FA must retain the alternative Passkey factor")
			factor, err := model.GetTwoFAByUserId(user.Id)
			require.NoError(t, err)
			if scope == service.VerificationScopeTwoFADisable {
				assert.Nil(t, factor)
			} else {
				require.NotNil(t, factor)
				assert.True(t, factor.IsEnabled)
				assert.Contains(t, string(result.Data), "backup_codes")
			}
			response = securityEnrollmentRequest("POST", path, `{}`, proof.ProofToken, identity, handler)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success, "the proof cannot authorize a second mutation")
		})
	}
}

func TestSecurityLoginRegisteredPasskeyRequiresUserVerification(t *testing.T) {
	for _, verified := range []bool{false, true} {
		t.Run(fmt.Sprintf("verified=%t", verified), func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			require.NoError(t, err)
			proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopePasskeyRegister}, service.VerificationMethodPassword)
			response := securityEnrollmentRequest("POST", "/api/user/passkey/register/begin", "", proof, identity, PasskeyRegisterBegin)
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					FlowToken string `json:"flow_token"`
					Options   struct {
						PublicKey struct {
							Challenge              string `json:"challenge"`
							AuthenticatorSelection struct {
								UserVerification string `json:"userVerification"`
							} `json:"authenticatorSelection"`
						} `json:"publicKey"`
					} `json:"options"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			assert.Equal(t, "required", result.Data.Options.PublicKey.AuthenticatorSelection.UserVerification)
			body, err := common.Marshal(passkeyFinishRequest{FlowToken: result.Data.FlowToken, Credential: securityPasskeyResponse(t, key, result.Data.Options.PublicKey.Challenge, true, 0, verified)})
			require.NoError(t, err)
			response = securityEnrollmentRequest("POST", "/api/user/passkey/register/finish", string(body), "", identity, PasskeyRegisterFinish)
			var finished securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &finished))
			assert.Equal(t, verified, finished.Success, response.Body.String())
			_, err = model.GetPasskeyByUserID(user.Id)
			if verified {
				require.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, model.ErrPasskeyNotFound)
			}
		})
	}
}

func TestSecurityLoginRequiresConfiguredFactors(t *testing.T) {
	for _, test := range []struct {
		name             string
		twoFA, passkey   bool
		locked, disabled bool
		methods          []service.VerificationMethodOption
		unavailable      bool
	}{
		{name: "password without additional factors"},
		{name: "passkey requires verification", passkey: true, methods: []service.VerificationMethodOption{{Method: "passkey", Available: true}}},
		{name: "twofa requires verification", twoFA: true, methods: []service.VerificationMethodOption{{Method: "2fa", Available: true}}},
		{name: "both factors are alternatives", twoFA: true, passkey: true, methods: []service.VerificationMethodOption{{Method: "2fa", Available: true}, {Method: "passkey", Available: true}}},
		{name: "locked twofa permits passkey", twoFA: true, passkey: true, locked: true, methods: []service.VerificationMethodOption{{Method: "2fa", Available: false, Reason: service.ErrVerificationLocked.Error()}, {Method: "passkey", Available: true}}},
		{name: "disabled passkey permits twofa", twoFA: true, passkey: true, disabled: true, methods: []service.VerificationMethodOption{{Method: "2fa", Available: true}, {Method: "passkey", Available: false, Reason: "Passkey authentication is disabled."}}},
		{name: "only passkey disabled blocks password", passkey: true, disabled: true, unavailable: true},
		{name: "both factors unavailable block password", passkey: true, twoFA: true, disabled: true, locked: true, unavailable: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			previousPasswordLogin := common.PasswordLoginEnabled
			common.PasswordLoginEnabled = true
			t.Cleanup(func() { common.PasswordLoginEnabled = previousPasswordLogin })
			if test.passkey {
				require.NoError(t, model.DB.Create(&model.PasskeyCredential{UserID: user.Id, CredentialID: "login-key", PublicKey: "public-key"}).Error)
			}
			if test.twoFA {
				factor := &model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
				if test.locked {
					until := time.Now().Add(time.Minute)
					factor.LockedUntil = &until
				}
				require.NoError(t, model.DB.Create(factor).Error)
			}
			system_setting.GetPasskeySettings().Enabled = !test.disabled
			before, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			response := securityEnrollmentRequest(http.MethodPost, "/api/user/login", `{"username":"enrollment-user","password":"enrollment-password"}`, "", service.AuthIdentity{}, Login)
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					RequireVerification bool                               `json:"require_verification"`
					FlowToken           string                             `json:"flow_token"`
					ExpiresAt           int64                              `json:"expires_at"`
					AccessToken         string                             `json:"access_token"`
					Methods             []service.VerificationMethodOption `json:"methods"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			after, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			if test.unavailable {
				assert.False(t, result.Success)
				assert.Equal(t, before, after)
				assert.Empty(t, response.Header().Values("Set-Cookie"))
				return
			}
			require.True(t, result.Success, response.Body.String())
			if len(test.methods) == 0 {
				assert.False(t, result.Data.RequireVerification)
				assert.NotEmpty(t, result.Data.AccessToken)
				assert.Equal(t, before+1, after)
				return
			}
			assert.True(t, result.Data.RequireVerification)
			assert.NotEmpty(t, result.Data.FlowToken)
			assert.Greater(t, result.Data.ExpiresAt, time.Now().Unix())
			assert.LessOrEqual(t, result.Data.ExpiresAt, time.Now().Add(5*time.Minute).Unix())
			assert.Equal(t, test.methods, result.Data.Methods)
			assert.Empty(t, result.Data.AccessToken)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			assert.Equal(t, before, after, "a pending challenge must not create a session")
		})
	}
}

type authFlowTestOAuthProvider struct {
	exchangeErr   error
	userInfoErr   error
	exchangeCalls int
	userInfoCalls int
}

type registrationInvitationOAuthProvider struct {
	oauth.Provider
	user *oauth.OAuthUser
}

func (*registrationInvitationOAuthProvider) IsEnabled() bool { return true }

func (*registrationInvitationOAuthProvider) ExchangeToken(context.Context, string, *gin.Context) (*oauth.OAuthToken, error) {
	return &oauth.OAuthToken{}, nil
}

func (provider *registrationInvitationOAuthProvider) GetUserInfo(context.Context, *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	return provider.user, nil
}

func setupRegistrationInvitationTest(t *testing.T) *model.User {
	t.Helper()
	user, _ := setupSecurityEnrollmentTest(t)
	previousRegister, previousPasswordRegister, previousEmail := common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled
	previousInvitation := common.RegistrationInvitationEnabled
	previousDefaultToken := constant.GenerateDefaultToken
	previousOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled = true, true, false
	common.RegistrationInvitationEnabled = true
	require.NoError(t, model.DB.AutoMigrate(&model.RegistrationInvitation{}))
	require.NoError(t, model.DB.Create(&model.RegistrationInvitation{CodeHash: hex.EncodeToString(common.RegistrationInvitationHash("registration-code-123456")), CodePrefix: "registra", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error)
	constant.GenerateDefaultToken = false
	require.NoError(t, model.DB.Model(user).Update("aff_code", "referral-only").Error)
	t.Cleanup(func() {
		common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled = previousRegister, previousPasswordRegister, previousEmail
		common.RegistrationInvitationEnabled = previousInvitation
		constant.GenerateDefaultToken = previousDefaultToken
		common.OptionMap = previousOptions
	})
	return user
}

func TestRegistrationInvitationAcrossRegistrationMethods(t *testing.T) {
	for _, method := range []string{"password", "linuxdo", "github", "discord", "oidc", "custom", "wechat"} {
		for _, test := range []struct {
			name       string
			code       string
			enabled    bool
			configured bool
			expect     bool
		}{
			{name: "missing code and valid referral", enabled: true, configured: true},
			{name: "incorrect code", code: "incorrect-code-123456", enabled: true, configured: true},
			{name: "valid code", code: " registration-code-123456 ", enabled: true, configured: true, expect: true},
			{name: "disabled needs no code", configured: true, expect: true},
			{name: "enabled without configured code denies", enabled: true},
		} {
			t.Run(method+"/"+test.name, func(t *testing.T) {
				setupRegistrationInvitationTest(t)
				common.RegistrationInvitationEnabled = test.enabled
				if !test.configured {
					require.NoError(t, model.DB.Where("id > 0").Delete(&model.RegistrationInvitation{}).Error)
				}
				response := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(response)
				ctx.Request = httptest.NewRequest(http.MethodPost, "/register", nil)
				if method == "password" {
					body, err := common.Marshal(map[string]string{"username": "invited-user", "password": "registered-password", "aff_code": "referral-only", "invitation_code": test.code})
					require.NoError(t, err)
					ctx.Request = httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(string(body)))
					Register(ctx)
				} else if method == "wechat" {
					previousEnabled, previousAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
					server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
						_, err := writer.Write([]byte(`{"success":true,"data":"invited-wechat-user"}`))
						assert.NoError(t, err)
					}))
					t.Cleanup(server.Close)
					common.WeChatAuthEnabled, common.WeChatServerAddress = true, server.URL
					t.Cleanup(func() { common.WeChatAuthEnabled, common.WeChatServerAddress = previousEnabled, previousAddress })
					body, err := common.Marshal(map[string]string{"code": "wechat-verification", "invitation_code": test.code})
					require.NoError(t, err)
					ctx.Request = httptest.NewRequest(http.MethodPost, "/oauth/wechat", strings.NewReader(string(body)))
					WeChatAuth(ctx)
				} else {
					provider := oauth.GetProvider(method)
					if method == "custom" {
						provider = oauth.NewGenericOAuthProvider(&model.CustomOAuthProvider{Id: 101, Name: "Custom", Slug: "custom"})
					}
					require.NotNil(t, provider)
					user, _, err := findOrCreateOAuthUser(ctx, provider, &oauth.OAuthUser{ProviderUserID: "invited-provider-user", Username: "invited-user", Extra: map[string]any{}}, &oauth.OAuthToken{}, "referral-only", common.RegistrationInvitationHash(test.code))
					if test.expect {
						require.NoError(t, err)
						require.NotNil(t, user)
						assert.NotZero(t, user.Id)
					} else {
						assert.ErrorIs(t, err, errRegistrationInvitationRequired)
						assert.Nil(t, user)
					}
				}
				if method == "password" || method == "wechat" {
					var result struct {
						Success bool   `json:"success"`
						Code    string `json:"code"`
					}
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					assert.Equal(t, test.expect, result.Success, response.Body.String())
					if !test.expect {
						assert.Equal(t, "REGISTRATION_INVITATION_REQUIRED", result.Code)
					}
				}
				var count int64
				require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
				expectedCount := int64(1)
				if test.expect {
					expectedCount++
				}
				assert.Equal(t, expectedCount, count)
				var audits []model.AuditLog
				require.NoError(t, model.LOG_DB.Where("action = ?", "user.registration_denied").Find(&audits).Error)
				if !test.expect {
					require.Len(t, audits, 1)
					encoded, err := common.Marshal(audits[0])
					require.NoError(t, err)
					assert.NotContains(t, string(encoded), "registration-code-123456")
					assert.NotContains(t, string(encoded), "registered-password")
				} else {
					assert.Empty(t, audits)
				}
			})
		}
	}
}

func TestRegistrationInvitationOAuthLifecycle(t *testing.T) {
	for _, scenario := range []string{"valid", "missing", "expired", "invitation expired", "revoked", "enabled during authorization", "disabled during authorization", "existing account"} {
		t.Run(scenario, func(t *testing.T) {
			user := setupRegistrationInvitationTest(t)
			provider := &registrationInvitationOAuthProvider{Provider: &oauth.LinuxDOProvider{}, user: &oauth.OAuthUser{ProviderUserID: "invited-linuxdo-user", Username: "invited-user", Extra: map[string]any{}}}
			oauth.Register("invitation-linuxdo-test", provider)
			t.Cleanup(func() { oauth.Unregister("invitation-linuxdo-test") })
			if scenario == "existing account" {
				require.NoError(t, model.DB.Model(user).Update("linux_do_id", provider.user.ProviderUserID).Error)
				common.RegisterEnabled = false
			}
			if scenario == "enabled during authorization" {
				common.RegistrationInvitationEnabled = false
			}
			code := "registration-code-123456"
			if scenario == "missing" || scenario == "existing account" || scenario == "enabled during authorization" || scenario == "disabled during authorization" {
				code = ""
			}
			body, err := common.Marshal(map[string]string{"provider": "invitation-linuxdo-test", "intent": "login", "invitation_code": code})
			require.NoError(t, err)
			started := securityEnrollmentRequest(http.MethodPost, "/api/oauth/state", string(body), "", service.AuthIdentity{}, GenerateOAuthCode)
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					FlowToken string `json:"flow_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(started.Body.Bytes(), &result))
			require.True(t, result.Success, started.Body.String())
			if scenario == "revoked" {
				require.NoError(t, model.DB.Model(&model.RegistrationInvitation{}).Where("id > 0").Update("revoked_at", time.Now().Unix()).Error)
			}
			if scenario == "invitation expired" {
				require.NoError(t, model.DB.Model(&model.RegistrationInvitation{}).Where("id > 0").Update("expires_at", time.Now().Add(-time.Minute).Unix()).Error)
			}
			if scenario == "expired" {
				flow, err := model.GetAuthFlow(result.Data.FlowToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth})
				require.NoError(t, err)
				require.NoError(t, model.DB.Model(flow).Update("expires_at", time.Now().Add(-time.Minute)).Error)
			}
			if scenario == "enabled during authorization" {
				common.RegistrationInvitationEnabled = true
			}
			if scenario == "disabled during authorization" {
				common.RegistrationInvitationEnabled = false
			}
			router := gin.New()
			router.GET("/api/oauth/:provider", HandleOAuth)
			expectSuccess := scenario == "valid" || scenario == "disabled during authorization" || scenario == "existing account"
			for attempt := range 2 {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/oauth/invitation-linuxdo-test?state="+result.Data.FlowToken+"&code=provider-code&invitation_code=registration-code-123456", nil))
				var callback struct {
					Success bool `json:"success"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &callback))
				assert.Equal(t, expectSuccess && attempt == 0, callback.Success, response.Body.String())
				if !expectSuccess || attempt > 0 {
					assert.Empty(t, response.Header().Values("Set-Cookie"))
				}
			}
			var count int64
			require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
			expectedCount := int64(1)
			if expectSuccess && scenario != "existing account" {
				expectedCount++
			}
			assert.Equal(t, expectedCount, count)
		})
	}
}

func TestRegistrationInvitationOptions(t *testing.T) {
	setupRegistrationInvitationTest(t)
	for _, enabled := range []bool{true, false, true} {
		require.NoError(t, model.UpdateOption("RegistrationInvitationEnabled", fmt.Sprint(enabled)))
		assert.Equal(t, enabled, common.RegistrationInvitationEnabled)
		assert.NoError(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash("registration-code-123456")))
		if enabled {
			assert.ErrorIs(t, model.ValidateRegistrationInvitation(nil), model.ErrRegistrationInvitationInvalid)
		} else {
			assert.NoError(t, model.ValidateRegistrationInvitation(nil))
		}
	}
	status := securityEnrollmentRequest(http.MethodGet, "/api/status", "", "", service.AuthIdentity{}, GetStatus)
	var result struct {
		Data map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(status.Body.Bytes(), &result))
	assert.Equal(t, true, result.Data["registration_invitation_enabled"])
	assert.NotContains(t, status.Body.String(), "another-registration-code")
	assert.NotContains(t, result.Data, "registration_invitation_code")
}

func TestRegistrationInvitationAtomicUse(t *testing.T) {
	setupRegistrationInvitationTest(t)
	hash := common.RegistrationInvitationHash("registration-code-123456")
	failedBinding := errors.New("provider binding failed")
	user := &model.User{Username: "rolled-back-user", Role: common.RoleCommonUser}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := user.InsertWithRegistrationInvitation(tx, 0, hash); err != nil {
			return err
		}
		return failedBinding
	})
	require.ErrorIs(t, err, failedBinding)
	assert.NoError(t, model.ValidateRegistrationInvitation(hash), "failed registration must not consume the code")
	var count int64
	require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", user.Username).Count(&count).Error)
	assert.Zero(t, count)

	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for i := range 2 {
		workers.Go(func() {
			<-start
			candidate := &model.User{Username: fmt.Sprintf("invitation-racer-%d", i), Role: common.RoleCommonUser}
			results <- model.DB.Transaction(func(tx *gorm.DB) error {
				return candidate.InsertWithRegistrationInvitation(tx, 0, hash)
			})
		})
	}
	close(start)
	workers.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	assert.Equal(t, 1, winners, "only one simultaneous registration may commit")
	require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
	assert.EqualValues(t, 2, count, "losing registration must roll back its user")
	rows, total, err := model.ListRegistrationInvitations(0, 20, "registration-code-123456")
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.NotZero(t, rows[0].UsedAt)
	assert.NotZero(t, rows[0].UsedUserId)
	assert.Contains(t, rows[0].Username, "invitation-racer-")
	assert.ErrorIs(t, model.RevokeRegistrationInvitation(rows[0].Id), model.ErrRegistrationInvitationInvalid)

	response := securityEnrollmentRequest(http.MethodPost, "/register", `{"username":"replayed-user","password":"registered-password","invitation_code":"registration-code-123456"}`, "", service.AuthIdentity{}, Register)
	assert.Contains(t, response.Body.String(), "REGISTRATION_INVITATION_REQUIRED")
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodGet, "/oauth/linuxdo", nil)
	_, _, err = findOrCreateOAuthUser(ctx, &oauth.LinuxDOProvider{}, &oauth.OAuthUser{ProviderUserID: "replay-linuxdo", Username: "replay-linuxdo"}, &oauth.OAuthToken{}, "", hash)
	assert.ErrorIs(t, err, model.ErrRegistrationInvitationInvalid)
	require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestRegistrationInvitationManagement(t *testing.T) {
	user := setupRegistrationInvitationTest(t)
	router := gin.New()
	group := router.Group("/api/option/registration-invitations", middleware.RootAuth(), middleware.DisableCache())
	group.POST("/", GenerateRegistrationInvitations)
	group.POST("/search", SearchRegistrationInvitations)
	group.POST("/delete", DeleteRegistrationInvitations)
	group.DELETE("/:id", RevokeRegistrationInvitation)
	ordinary, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "invitation-test")
	require.NoError(t, err)
	for _, token := range []string{"", ordinary.AccessToken} {
		for _, path := range []string{"/", "/search", "/delete", "/1"} {
			method := http.MethodPost
			if path == "/1" {
				method = http.MethodDelete
			}
			request := httptest.NewRequest(method, "/api/option/registration-invitations"+path, strings.NewReader(`{"count":21,"days":30,"page":1}`))
			request.Header.Set("Authorization", "Bearer "+token)
			request.AddCookie(&http.Cookie{Name: "session", Value: ordinary.RefreshToken})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, response.Code)
		}
	}
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	root, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "invitation-test")
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodPost, "/api/option/registration-invitations/", strings.NewReader(`{"count":21,"days":30}`))
	request.Header.Set("Authorization", "Bearer "+root.AccessToken)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var generated struct {
		Success bool     `json:"success"`
		Data    []string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &generated))
	require.True(t, generated.Success, response.Body.String())
	require.Len(t, generated.Data, 21)
	assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
	seen := map[string]bool{}
	for _, code := range generated.Data {
		assert.Len(t, code, 64)
		assert.False(t, seen[code])
		seen[code] = true
	}
	for _, page := range []int{1, 2} {
		request = httptest.NewRequest(http.MethodPost, "/api/option/registration-invitations/search", strings.NewReader(fmt.Sprintf(`{"page":%d}`, page)))
		request.Header.Set("Authorization", "Bearer "+root.AccessToken)
		response = httptest.NewRecorder()
		router.ServeHTTP(response, request)
		var listed struct {
			Success bool `json:"success"`
			Data    struct {
				Items []model.RegistrationInvitation `json:"items"`
				Total int                            `json:"total"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &listed))
		require.True(t, listed.Success)
		assert.Equal(t, 22, listed.Data.Total)
		assert.Len(t, listed.Data.Items, min(20, 22-(page-1)*20))
		for _, item := range listed.Data.Items {
			if item.CodePrefix == "registra" {
				assert.Empty(t, item.Code)
			} else {
				assert.True(t, seen[item.Code], "saved codes must be retrievable by root")
			}
		}
		assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		assert.NotContains(t, response.Body.String(), "code_encrypted")
		assert.NotContains(t, response.Body.String(), "code_hash")
	}
	rows, total, err := model.ListRegistrationInvitations(0, 20, generated.Data[0])
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Equal(t, user.Id, rows[0].CreatedBy)
	assert.EqualValues(t, 30*24*60*60, rows[0].ExpiresAt-rows[0].CreatedAt)
	request = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/option/registration-invitations/%d", rows[0].Id), nil)
	request.Header.Set("Authorization", "Bearer "+root.AccessToken)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Contains(t, response.Body.String(), `"success":true`)
	assert.ErrorIs(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(generated.Data[0])), model.ErrRegistrationInvitationInvalid)

	// Cookie-only cross-site requests do not carry the required dashboard bearer token.
	request = httptest.NewRequest(http.MethodPost, "/api/option/registration-invitations/delete", strings.NewReader(fmt.Sprintf(`{"ids":[%d]}`, rows[0].Id)))
	request.AddCookie(&http.Cookie{Name: "session", Value: root.RefreshToken})
	request.Header.Set("Origin", "https://untrusted.example")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusUnauthorized, response.Code)
	request = httptest.NewRequest(http.MethodPost, "/api/option/registration-invitations/delete", strings.NewReader(fmt.Sprintf(`{"ids":[%d]}`, rows[0].Id)))
	request.Header.Set("Authorization", "Bearer "+root.AccessToken)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Contains(t, response.Body.String(), `"success":true`)
	assert.Contains(t, response.Body.String(), `"data":1`)
	_, total, err = model.ListRegistrationInvitations(0, 20, generated.Data[0])
	require.NoError(t, err)
	assert.Zero(t, total, "deletion removes the record rather than only revoking it")
	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&audits).Error)
	encoded, err := common.Marshal(audits)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), "registration_invitation.generate")
	assert.Contains(t, string(encoded), "registration_invitation.revoke")
	assert.Contains(t, string(encoded), "registration_invitation.delete")
	for _, code := range generated.Data {
		assert.NotContains(t, string(encoded), code)
	}
	for _, body := range []string{`{"count":0,"days":30}`, `{"count":101,"days":30}`, `{"count":1,"days":0}`, `{"count":1,"days":366}`, `{"count":1.5,"days":30}`} {
		response := securityEnrollmentRequest(http.MethodPost, "/", body, "", service.AuthIdentity{}, GenerateRegistrationInvitations)
		assert.Contains(t, response.Body.String(), `"success":false`)
	}
}

func TestRegistrationInvitationSavedCodesAndDeletion(t *testing.T) {
	user := setupRegistrationInvitationTest(t)
	// Recreate the previous hash-only schema with an existing valid invitation.
	require.NoError(t, model.DB.Migrator().DropColumn(&model.RegistrationInvitation{}, "CodeEncrypted"))
	for range 2 {
		require.NoError(t, model.DB.AutoMigrate(&model.RegistrationInvitation{}))
	}
	legacy, total, err := model.ListRegistrationInvitations(0, 20, "registration-code-123456")
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, legacy, 1)
	assert.Empty(t, legacy[0].Code)
	assert.NoError(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash("registration-code-123456")))
	duplicate := legacy[0]
	duplicate.Id = 0
	assert.Error(t, model.DB.Create(&duplicate).Error, "migration preserves unique invitation hashes")

	codes, err := model.GenerateRegistrationInvitations(4, 30, user.Id)
	require.NoError(t, err)
	require.Len(t, codes, 4)
	ids := make([]int, len(codes))
	for i, code := range codes {
		rows, total, err := model.ListRegistrationInvitations(0, 20, code)
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		require.Len(t, rows, 1)
		ids[i] = rows[0].Id
		assert.Equal(t, code, rows[0].Code)
		var stored model.RegistrationInvitation
		require.NoError(t, model.DB.First(&stored, ids[i]).Error)
		assert.Empty(t, stored.Code)
		assert.NotEmpty(t, stored.CodeEncrypted)
		assert.NotContains(t, stored.CodeEncrypted, code)
	}
	// Ciphertext is authenticated and tied to its record; corruption cannot leak a different code.
	var first model.RegistrationInvitation
	require.NoError(t, model.DB.First(&first, ids[0]).Error)
	require.NoError(t, model.DB.Model(&model.RegistrationInvitation{}).Where("id = ?", ids[1]).Update("code_encrypted", first.CodeEncrypted).Error)
	rows, _, err := model.ListRegistrationInvitations(0, 20, codes[1])
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Empty(t, rows[0].Code)
	secret := common.CryptoSecret
	t.Cleanup(func() { common.CryptoSecret = secret })
	common.CryptoSecret = "different-invitation-test-key"
	rows, _, err = model.ListRegistrationInvitations(0, 20, codes[0])
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Empty(t, rows[0].Code)
	common.CryptoSecret = secret

	require.NoError(t, model.DB.Model(&model.RegistrationInvitation{}).Where("id = ?", ids[1]).Updates(map[string]any{"used_user_id": user.Id, "used_at": time.Now().Unix()}).Error)
	require.NoError(t, model.DB.Model(&model.RegistrationInvitation{}).Where("id = ?", ids[2]).Update("expires_at", time.Now().Add(-time.Hour).Unix()).Error)
	require.NoError(t, model.RevokeRegistrationInvitation(ids[3]))
	for _, code := range codes[1:] {
		assert.ErrorIs(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(code)), model.ErrRegistrationInvitationInvalid)
	}
	for _, invalid := range [][]int{nil, {ids[0], 0}, {-1}, make([]int, 101)} {
		count, err := model.DeleteRegistrationInvitations(invalid)
		assert.Error(t, err)
		assert.Zero(t, count)
	}
	for _, body := range []string{`{}`, `{"ids":[]}`, `{"ids":[0]}`, `{"ids":[-1]}`, `{"ids":[1.5]}`} {
		response := securityEnrollmentRequest(http.MethodPost, "/delete", body, "", service.AuthIdentity{}, DeleteRegistrationInvitations)
		assert.Contains(t, response.Body.String(), `"success":false`)
	}
	deleted, err := model.DeleteRegistrationInvitations(ids)
	require.NoError(t, err)
	assert.EqualValues(t, 4, deleted)
	rows, total, err = model.ListRegistrationInvitations(0, 20, "")
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Equal(t, legacy[0].Id, rows[0].Id)
	assert.NoError(t, model.DB.First(&model.User{}, user.Id).Error, "deleting used invitations preserves their accounts")
	assert.ErrorIs(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(codes[0])), model.ErrRegistrationInvitationInvalid)
	deleted, err = model.DeleteRegistrationInvitations(ids)
	require.NoError(t, err)
	assert.Zero(t, deleted, "repeating deletion must not affect other invitations")
}

func TestRegistrationInvitationStateRejectsInvalidRequests(t *testing.T) {
	setupRegistrationInvitationTest(t)
	provider := &registrationInvitationOAuthProvider{Provider: &oauth.LinuxDOProvider{}}
	oauth.Register("invitation-linuxdo-test", provider)
	t.Cleanup(func() { oauth.Unregister("invitation-linuxdo-test") })
	for _, request := range []map[string]string{
		{"provider": "invitation-linuxdo-test", "intent": "bind", "invitation_code": "registration-code-123456"},
		{"provider": "invitation-linuxdo-test", "intent": "verify", "invitation_code": "registration-code-123456"},
		{"provider": "invitation-linuxdo-test", "intent": "login", "invitation_code": strings.Repeat("x", 129)},
	} {
		body, err := common.Marshal(request)
		require.NoError(t, err)
		response := securityEnrollmentRequest(http.MethodPost, "/api/oauth/state", string(body), "", service.AuthIdentity{}, GenerateOAuthCode)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.False(t, result.Success)
	}
	var count int64
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&count).Error)
	assert.Zero(t, count)
}

func (*authFlowTestOAuthProvider) GetName() string { return "Auth Flow Test" }
func (*authFlowTestOAuthProvider) IsEnabled() bool { return true }
func (provider *authFlowTestOAuthProvider) ExchangeToken(context.Context, string, *gin.Context) (*oauth.OAuthToken, error) {
	provider.exchangeCalls++
	if provider.exchangeErr != nil {
		return nil, provider.exchangeErr
	}
	return &oauth.OAuthToken{}, nil
}
func (provider *authFlowTestOAuthProvider) GetUserInfo(context.Context, *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	provider.userInfoCalls++
	if provider.userInfoErr != nil {
		return nil, provider.userInfoErr
	}
	return &oauth.OAuthUser{ProviderUserID: "external-user"}, nil
}
func (*authFlowTestOAuthProvider) IsUserIDTaken(string) bool                      { return false }
func (*authFlowTestOAuthProvider) FillUserByProviderID(*model.User, string) error { return nil }
func (*authFlowTestOAuthProvider) SetProviderUserID(*model.User, string)          {}
func (*authFlowTestOAuthProvider) GetProviderPrefix() string                      { return "flow_" }
func (*authFlowTestOAuthProvider) ProviderUserIDColumn() string                   { return "" }

func setupAuthFlowControllerTest(t *testing.T) *authFlowTestOAuthProvider {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedis := common.RedisEnabled
	common.RedisEnabled = false
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.AuthFlow{}, &model.User{}, &model.UserSession{}, &model.AuditLog{}))
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	provider := &authFlowTestOAuthProvider{}
	oauth.Register("auth-flow-test", provider)
	t.Cleanup(func() {
		oauth.Unregister("auth-flow-test")
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedis
		common.SetMainDatabaseType(previousType)
	})
	return provider
}

func TestGenerateOAuthCodeCarriesAffiliateInLoginFlow(t *testing.T) {
	setupAuthFlowControllerTest(t)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/oauth/state", strings.NewReader(`{"provider":"auth-flow-test","intent":"login","aff":"invite-code","invitation_code":"registration-code-123456"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	GenerateOAuthCode(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			FlowToken string `json:"flow_token"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	flow, err := model.GetAuthFlow(response.Data.FlowToken, model.AuthFlowMatch{
		Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentLogin,
	})
	require.NoError(t, err)
	var payload oauthFlowPayload
	require.NoError(t, common.UnmarshalJsonStr(flow.Payload, &payload))
	assert.Equal(t, "invite-code", payload.AffiliateCode)
	assert.Equal(t, common.RegistrationInvitationHash("registration-code-123456"), payload.InvitationHash)
	assert.NotContains(t, flow.Payload, "registration-code-123456")
	assert.Zero(t, flow.UserId)
	assert.Empty(t, flow.SessionId)
}

func TestGenerateOAuthCodeBindsFlowToAuthenticatedSession(t *testing.T) {
	_, identity := setupSecurityEnrollmentTest(t)
	oauth.Register("auth-flow-test", &authFlowTestOAuthProvider{})
	t.Cleanup(func() { oauth.Unregister("auth-flow-test") })
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: []byte(`{"provider":"auth-flow-test"}`)}, service.VerificationMethodPassword)
	response := securityEnrollmentRequest(http.MethodPost, "/api/oauth/state", `{"provider":"auth-flow-test","intent":"bind"}`, proof, identity, GenerateOAuthCode)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			FlowToken string `json:"flow_token"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	flow, err := model.GetAuthFlow(result.Data.FlowToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentBind, UserId: identity.UserID, SessionId: identity.SessionID})
	require.NoError(t, err)
	assert.Equal(t, identity.UserID, flow.UserId)
	assert.Equal(t, identity.SessionID, flow.SessionId)
}

func TestOAuthLoginConsumesFlowOnlyAfterProviderIdentity(t *testing.T) {
	provider := setupAuthFlowControllerTest(t)

	tests := []struct {
		name        string
		exchangeErr error
		userInfoErr error
	}{
		{name: "exchange failure", exchangeErr: errors.New("exchange failed")},
		{name: "user info failure", userInfoErr: errors.New("user info failed")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider.exchangeErr = test.exchangeErr
			provider.userInfoErr = test.userInfoErr
			token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
				Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentLogin,
				Payload: `{}`, ExpiresAt: time.Now().Add(time.Minute),
			})
			require.NoError(t, err)

			router := gin.New()
			router.GET("/api/oauth/:provider", HandleOAuth)
			request := httptest.NewRequest(http.MethodGet, "/api/oauth/auth-flow-test?state="+token+"&code=test", nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{
				Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentLogin,
			})
			require.NoError(t, err)
			assert.Nil(t, flow.ConsumedAt)
		})
	}
}

func TestOAuthLoginConsumesFlowAfterProviderIdentityAndOnProviderError(t *testing.T) {
	provider := setupAuthFlowControllerTest(t)

	provider.exchangeErr = nil
	provider.userInfoErr = nil
	successToken, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentLogin,
		Payload: `{invalid`, ExpiresAt: time.Now().Add(time.Minute),
	})
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/oauth/:provider", HandleOAuth)
	request := httptest.NewRequest(http.MethodGet, "/api/oauth/auth-flow-test?state="+successToken+"&code=test", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	_, err = model.GetAuthFlow(successToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth})
	assert.ErrorIs(t, err, model.ErrAuthFlowConsumed)
	assert.Equal(t, 1, provider.exchangeCalls)
	assert.Equal(t, 1, provider.userInfoCalls)

	providerErrorToken, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose: model.AuthFlowPurposeOAuth, Provider: "auth-flow-test", Intent: model.AuthFlowIntentLogin,
		Payload: `{}`, ExpiresAt: time.Now().Add(time.Minute),
	})
	require.NoError(t, err)
	request = httptest.NewRequest(http.MethodGet, "/api/oauth/auth-flow-test?state="+providerErrorToken+"&error=access_denied", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	_, err = model.GetAuthFlow(providerErrorToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth})
	assert.ErrorIs(t, err, model.ErrAuthFlowConsumed)
	assert.Equal(t, 1, provider.exchangeCalls)
	assert.Equal(t, 1, provider.userInfoCalls)
}

func TestOAuthBindProviderErrorConsumesSessionBoundFlow(t *testing.T) {
	_, identity := setupSecurityEnrollmentTest(t)
	provider := &authFlowTestOAuthProvider{}
	oauth.Register("auth-flow-test", provider)
	t.Cleanup(func() { oauth.Unregister("auth-flow-test") })
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: []byte(`{"provider":"auth-flow-test"}`)}, service.VerificationMethodPassword)
	started := securityEnrollmentRequest(http.MethodPost, "/api/oauth/state", `{"provider":"auth-flow-test","intent":"bind"}`, proof, identity, GenerateOAuthCode)
	var result struct {
		Data struct {
			FlowToken string `json:"flow_token"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(started.Body.Bytes(), &result))
	require.NotEmpty(t, result.Data.FlowToken)
	response := securityEnrollmentRequest(http.MethodGet, "/api/oauth/auth-flow-test?state="+result.Data.FlowToken+"&error=access_denied&error_description=cancelled", "", "", identity, func(c *gin.Context) {
		c.Params = gin.Params{{Key: "provider", Value: "auth-flow-test"}}
		HandleOAuth(c)
	})
	assert.Equal(t, http.StatusOK, response.Code)
	_, err := model.GetAuthFlow(result.Data.FlowToken, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth})
	assert.ErrorIs(t, err, model.ErrAuthFlowConsumed)
	assert.Zero(t, provider.exchangeCalls)
	assert.Zero(t, provider.userInfoCalls)
}

// legacyGitHubOAuthProvider follows the GitHub provider contract: the numeric
// account ID identifies the user, Extra["legacy_id"] carries the username and
// the verified email list is served on demand. Lookups go through the real
// github_id model queries.
type legacyGitHubOAuthProvider struct {
	authFlowTestOAuthProvider
	providerUserID     string
	legacyID           string
	verifiedEmails     []string
	verifiedEmailsErr  error
	verifiedEmailCalls int
}

func (*legacyGitHubOAuthProvider) GetName() string { return "GitHub" }
func (provider *legacyGitHubOAuthProvider) GetUserInfo(context.Context, *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	return &oauth.OAuthUser{ProviderUserID: provider.providerUserID, Username: provider.legacyID, Extra: map[string]any{"legacy_id": provider.legacyID}}, nil
}
func (provider *legacyGitHubOAuthProvider) GetVerifiedEmails(context.Context, *oauth.OAuthToken) ([]string, error) {
	provider.verifiedEmailCalls++
	return provider.verifiedEmails, provider.verifiedEmailsErr
}
func (*legacyGitHubOAuthProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsGitHubIdAlreadyTaken(providerUserID)
}
func (*legacyGitHubOAuthProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.GitHubId = providerUserID
	return user.FillUserByGitHubId()
}
func (*legacyGitHubOAuthProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.GitHubId = providerUserID
}
func (*legacyGitHubOAuthProvider) GetProviderPrefix() string    { return "github_" }
func (*legacyGitHubOAuthProvider) ProviderUserIDColumn() string { return "github_id" }

// legacyGitHubOAuthLogin registers provider for one test and completes an OAuth
// login callback with it.
func legacyGitHubOAuthLogin(t *testing.T, provider *legacyGitHubOAuthProvider) *httptest.ResponseRecorder {
	t.Helper()
	const slug = "github-legacy-login-test"
	oauth.Register(slug, provider)
	t.Cleanup(func() { oauth.Unregister(slug) })
	token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: model.AuthFlowPurposeOAuth, Provider: slug, Intent: model.AuthFlowIntentLogin, Payload: `{}`, ExpiresAt: time.Now().Add(time.Minute)})
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/oauth/:provider", HandleOAuth)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/oauth/"+slug+"?state="+token+"&code=provider-code", nil))
	return response
}

// legacyGitHubBindingAudits returns the account binding audit rows in creation
// order together with their encoded parameters.
func legacyGitHubBindingAudits(t *testing.T) ([]model.AuditLog, []string) {
	t.Helper()
	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.binding_bind").Order("id").Find(&audits).Error)
	params := make([]string, 0, len(audits))
	for _, audit := range audits {
		require.NotNil(t, audit.Other.Op)
		encoded, err := common.Marshal(audit.Other.Op.Params)
		require.NoError(t, err)
		params = append(params, string(encoded))
	}
	return audits, params
}

func TestOAuthLoginLegacyGitHubBindingRequiresAccountEvidence(t *testing.T) {
	const declined = "This GitHub account cannot be linked to an existing account automatically, please sign in or register another way and then link GitHub in account settings"
	tests := []struct {
		name              string
		existingGitHubID  string
		existingDeleted   bool
		withoutEmail      bool
		legacyID          string
		verifiedEmails    []string
		verifiedEmailsErr error
		registerEnabled   bool
		expectLogin       bool
		expectMigration   bool
		expectNewAccount  bool
		expectEmailCalls  int
		expectAuditParams string
	}{
		{name: "numeric legacy value registers a new account", existingGitHubID: "424242", legacyID: "424242", verifiedEmails: []string{"legacy-github@example.com"}, registerEnabled: true, expectLogin: true, expectNewAccount: true},
		{name: "numeric legacy value with registration disabled", existingGitHubID: "424242", legacyID: "424242", verifiedEmails: []string{"legacy-github@example.com"}},
		{name: "soft-deleted legacy row registers a new account", existingGitHubID: "octocat-legacy", existingDeleted: true, legacyID: "octocat-legacy", verifiedEmails: []string{"legacy-github@example.com"}, registerEnabled: true, expectLogin: true, expectNewAccount: true},
		{
			name: "verified email match migrates", existingGitHubID: "octocat-legacy", legacyID: "octocat-legacy",
			verifiedEmails: []string{"other@example.com", " Legacy-GitHub@Example.com "}, expectLogin: true, expectMigration: true, expectEmailCalls: 1,
			// No SMTP server is configured in tests, so the notification attempt is recorded as failed.
			expectAuditParams: `{"provider":"github","legacy_migration":true,"legacy_id":"octocat-legacy","provider_user_id":"900001","verified_email_matched":true,"success":true,"notification_failed":true}`,
		},
		{
			name: "no matching verified email declines", existingGitHubID: "octocat-legacy", legacyID: "octocat-legacy",
			verifiedEmails: []string{"other@example.com"}, registerEnabled: true, expectEmailCalls: 1,
			expectAuditParams: `{"provider":"github","legacy_migration":true,"legacy_id":"octocat-legacy","provider_user_id":"900001","success":false,"reason":"no_matching_evidence"}`,
		},
		{
			name: "verified emails failure declines", existingGitHubID: "octocat-legacy", legacyID: "octocat-legacy",
			verifiedEmailsErr: errors.New("emails unavailable"), registerEnabled: true, expectEmailCalls: 1,
			expectAuditParams: `{"provider":"github","legacy_migration":true,"legacy_id":"octocat-legacy","provider_user_id":"900001","success":false,"reason":"verified_emails_unavailable"}`,
		},
		{
			name: "account without email declines before asking the provider", existingGitHubID: "octocat-legacy", withoutEmail: true, legacyID: "octocat-legacy",
			verifiedEmails: []string{"legacy-github@example.com"}, registerEnabled: true,
			expectAuditParams: `{"provider":"github","legacy_migration":true,"legacy_id":"octocat-legacy","provider_user_id":"900001","success":false,"reason":"no_matching_evidence"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupSecurityEnrollmentTest(t)
			previousRegister := common.RegisterEnabled
			common.RegisterEnabled = test.registerEnabled
			t.Cleanup(func() { common.RegisterEnabled = previousRegister })
			existing := &model.User{Username: "legacy-github", Email: "legacy-github@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "legacy-github", AuthVersion: 1, GitHubId: test.existingGitHubID}
			if test.withoutEmail {
				existing.Email = ""
			}
			require.NoError(t, model.DB.Create(existing).Error)
			if test.existingDeleted {
				require.NoError(t, model.DB.Delete(existing).Error)
			}
			provider := &legacyGitHubOAuthProvider{providerUserID: "900001", legacyID: test.legacyID, verifiedEmails: test.verifiedEmails, verifiedEmailsErr: test.verifiedEmailsErr}
			response := legacyGitHubOAuthLogin(t, provider)
			var result struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
				Data    struct {
					User struct {
						Id int `json:"id"`
					} `json:"user"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.Equal(t, test.expectLogin, result.Success, response.Body.String())
			assert.Equal(t, test.expectEmailCalls, provider.verifiedEmailCalls)

			var reloaded model.User
			require.NoError(t, model.DB.Unscoped().First(&reloaded, existing.Id).Error)
			audits, params := legacyGitHubBindingAudits(t)
			if test.expectAuditParams == "" {
				assert.Empty(t, audits)
			} else {
				require.Len(t, audits, 1)
				assert.Equal(t, existing.Id, audits[0].UserId)
				assert.Equal(t, common.RoleCommonUser, audits[0].ActorRole)
				assert.Equal(t, test.expectMigration, audits[0].Success)
				assert.JSONEq(t, test.expectAuditParams, params[0])
			}
			if test.expectMigration {
				assert.Equal(t, existing.Id, result.Data.User.Id)
				assert.Equal(t, "900001", reloaded.GitHubId)
				assert.NotEmpty(t, response.Header().Values("Set-Cookie"))
				return
			}
			assert.Equal(t, test.existingGitHubID, reloaded.GitHubId, "the existing binding must stay untouched")
			if test.expectNewAccount {
				var created model.User
				require.NoError(t, model.DB.Where("github_id = ?", "900001").First(&created).Error)
				assert.NotEqual(t, existing.Id, created.Id)
				assert.Equal(t, created.Id, result.Data.User.Id)
				return
			}
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			if test.expectAuditParams != "" {
				assert.Equal(t, declined, result.Message)
			}
		})
	}
}

func TestOAuthLoginLegacyGitHubBindingMigratesAfterLoginVerification(t *testing.T) {
	for _, interference := range []string{"none", "pending id claimed by another account", "binding relinked meanwhile"} {
		t.Run(interference, func(t *testing.T) {
			setupSecurityEnrollmentTest(t)
			existing := &model.User{Username: "legacy-github", Email: "legacy-github@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "legacy-github", AuthVersion: 1, GitHubId: "octocat-legacy"}
			require.NoError(t, model.DB.Create(existing).Error)
			factor := &model.TwoFA{UserId: existing.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
			require.NoError(t, model.DB.Create(factor).Error)
			provider := &legacyGitHubOAuthProvider{providerUserID: "900001", legacyID: "octocat-legacy", verifiedEmails: []string{"legacy-github@example.com"}}
			response := legacyGitHubOAuthLogin(t, provider)
			var challenge struct {
				Success bool                   `json:"success"`
				Data    service.LoginChallenge `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &challenge))
			require.True(t, challenge.Success, response.Body.String())
			require.True(t, challenge.Data.RequireVerification)
			assert.Equal(t, []service.VerificationMethodOption{{Method: "2fa", Available: true}}, challenge.Data.Methods)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
			assert.Zero(t, provider.verifiedEmailCalls, "a second factor is checked before the provider emails")
			var reloaded model.User
			require.NoError(t, model.DB.First(&reloaded, existing.Id).Error)
			assert.Equal(t, "octocat-legacy", reloaded.GitHubId, "the binding waits for the verification")
			audits, _ := legacyGitHubBindingAudits(t)
			assert.Empty(t, audits)

			expectedGitHubID, expectLogin := "900001", true
			switch interference {
			case "pending id claimed by another account":
				other := &model.User{Username: "other-github", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-github", AuthVersion: 1, GitHubId: "900001"}
				require.NoError(t, model.DB.Create(other).Error)
				expectedGitHubID, expectLogin = "octocat-legacy", false
			case "binding relinked meanwhile":
				require.NoError(t, model.DB.Model(existing).Update("github_id", "relinked-legacy").Error)
				expectedGitHubID = "relinked-legacy"
			}
			code, err := totp.GenerateCode(factor.Secret, time.Now())
			require.NoError(t, err)
			body, err := common.Marshal(map[string]string{"flow_token": challenge.Data.FlowToken, "code": code})
			require.NoError(t, err)
			for attempt := range 2 {
				response = securityEnrollmentRequest(http.MethodPost, "/api/user/login/verify", string(body), "", service.AuthIdentity{}, VerifyLogin)
				var result securityEnrollmentResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.Equal(t, attempt == 0 && expectLogin, result.Success, response.Body.String())
				if attempt == 0 && !expectLogin {
					assert.Equal(t, "ACCOUNT_ALREADY_BOUND", result.Code)
				}
				if result.Success {
					assert.NotEmpty(t, response.Header().Values("Set-Cookie"))
				} else {
					assert.Empty(t, response.Header().Values("Set-Cookie"))
				}
			}
			require.NoError(t, model.DB.First(&reloaded, existing.Id).Error)
			assert.Equal(t, expectedGitHubID, reloaded.GitHubId)
			sessions, err := model.CountActiveUserSessions(existing.Id, time.Now().Unix())
			require.NoError(t, err)
			expectedSessions := 0
			if expectLogin {
				expectedSessions = 1
			}
			assert.EqualValues(t, expectedSessions, sessions, "the consumed challenge cannot be replayed")
			audits, params := legacyGitHubBindingAudits(t)
			if interference != "none" {
				assert.Empty(t, audits)
				return
			}
			require.Len(t, audits, 1)
			assert.Equal(t, existing.Id, audits[0].UserId)
			assert.Equal(t, common.RoleCommonUser, audits[0].ActorRole)
			assert.True(t, audits[0].Success)
			// No SMTP server is configured in tests, so the notification attempt is recorded as failed.
			assert.JSONEq(t, `{"provider":"github","legacy_migration":true,"legacy_id":"octocat-legacy","provider_user_id":"900001","verification_method":"2fa","success":true,"notification_failed":true}`, params[0])
		})
	}
}

func TestOAuthBindIgnoresLegacyGitHubUsernames(t *testing.T) {
	tests := []struct {
		name          string
		ownGitHubID   string
		otherGitHubID string
		legacyID      string
		expectBound   bool
	}{
		{name: "another account's legacy username does not block binding", otherGitHubID: "octocat-legacy", legacyID: "octocat-legacy", expectBound: true},
		{name: "own legacy username is replaced", ownGitHubID: "octocat-legacy", otherGitHubID: "unrelated-legacy", legacyID: "octocat-legacy", expectBound: true},
		{name: "numeric legacy value does not collide", otherGitHubID: "424242", legacyID: "424242", expectBound: true},
		{name: "numeric ID held by another account is rejected", otherGitHubID: "900001", legacyID: "octocat-legacy"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			if test.ownGitHubID != "" {
				require.NoError(t, model.DB.Model(user).Update("github_id", test.ownGitHubID).Error)
			}
			other := &model.User{Username: "other-github", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-github", AuthVersion: 1, GitHubId: test.otherGitHubID}
			require.NoError(t, model.DB.Create(other).Error)
			const slug = "github-legacy-bind-test"
			oauth.Register(slug, &legacyGitHubOAuthProvider{providerUserID: "900001", legacyID: test.legacyID})
			t.Cleanup(func() { oauth.Unregister(slug) })
			proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: []byte(`{"provider":"` + slug + `"}`)}, service.VerificationMethodPassword)
			started := securityEnrollmentRequest(http.MethodPost, "/api/oauth/state", `{"provider":"`+slug+`","intent":"bind"}`, proof, identity, GenerateOAuthCode)
			var flow struct {
				Data struct {
					FlowToken string `json:"flow_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(started.Body.Bytes(), &flow))
			require.NotEmpty(t, flow.Data.FlowToken, started.Body.String())
			response := securityEnrollmentRequest(http.MethodGet, "/api/oauth/"+slug+"?state="+flow.Data.FlowToken+"&code=provider-code", "", "", identity, func(c *gin.Context) {
				c.Params = gin.Params{{Key: "provider", Value: slug}}
				HandleOAuth(c)
			})
			var result struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, test.expectBound, result.Success, response.Body.String())

			var bound, untouched model.User
			require.NoError(t, model.DB.First(&bound, user.Id).Error)
			require.NoError(t, model.DB.First(&untouched, other.Id).Error)
			assert.Equal(t, test.otherGitHubID, untouched.GitHubId)
			if test.expectBound {
				assert.Equal(t, "900001", bound.GitHubId)
				return
			}
			assert.Equal(t, test.ownGitHubID, bound.GitHubId)
			assert.Equal(t, "This GitHub account has already been bound", result.Message)
		})
	}
}

// The latest release (v1.0.0-rc.42) has no invitation table. Verify both
// creation from that state and upgrades of the intervening hash-only schema.
func TestRegistrationInvitationDatabaseCompatibility(t *testing.T) {
	previousEnabled := common.RegistrationInvitationEnabled
	common.RegistrationInvitationEnabled = true
	t.Cleanup(func() { common.RegistrationInvitationEnabled = previousEnabled })
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("set " + dialect.env + " for real database verification")
			}
			db, _ := newAuditTestDatabase(t, dialect.kind, dsn)
			previous := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = previous })
			var version string
			query := "SELECT version()"
			if dialect.kind == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.NoError(t, db.AutoMigrate(&model.User{}))
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.RegistrationInvitation{}))
			}
			codes, err := model.GenerateRegistrationInvitations(2, 30, 1)
			require.NoError(t, err)
			rows, total, err := model.ListRegistrationInvitations(0, 20, codes[0])
			require.NoError(t, err)
			require.EqualValues(t, 1, total)
			require.Equal(t, codes[0], rows[0].Code)
			legacyID := rows[0].Id
			require.NoError(t, db.Migrator().DropColumn(&model.RegistrationInvitation{}, "CodeEncrypted"))
			// Upgrade starts with a fresh connection, as on an application restart.
			connection, err := db.DB()
			require.NoError(t, err)
			require.NoError(t, connection.Close())
			db, err = gorm.Open(db.Dialector, &gorm.Config{})
			require.NoError(t, err)
			model.DB = db
			t.Cleanup(func() {
				connection, err := db.DB()
				require.NoError(t, err)
				require.NoError(t, connection.Close())
			})
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.RegistrationInvitation{}))
			}
			rows, total, err = model.ListRegistrationInvitations(0, 20, codes[0])
			require.NoError(t, err)
			require.EqualValues(t, 1, total)
			assert.Equal(t, legacyID, rows[0].Id)
			assert.Empty(t, rows[0].Code)
			assert.NoError(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(codes[0])))
			duplicate := rows[0]
			duplicate.Id = 0
			assert.Error(t, db.Create(&duplicate).Error)
			fresh, err := model.GenerateRegistrationInvitations(1, 30, 1)
			require.NoError(t, err)
			rows, total, err = model.ListRegistrationInvitations(0, 20, fresh[0])
			require.NoError(t, err)
			require.EqualValues(t, 1, total)
			assert.Equal(t, fresh[0], rows[0].Code)
			count, err := model.DeleteRegistrationInvitations([]int{legacyID, rows[0].Id})
			require.NoError(t, err)
			assert.EqualValues(t, 2, count)
			assert.ErrorIs(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(fresh[0])), model.ErrRegistrationInvitationInvalid)
			_, total, err = model.ListRegistrationInvitations(0, 20, "")
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			assert.NoError(t, model.ValidateRegistrationInvitation(common.RegistrationInvitationHash(codes[1])))
		})
	}
}
