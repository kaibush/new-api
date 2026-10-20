package controller

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCommunityChatHistoryAndAuthorization(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	migrations := []any{&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}}
	require.NoError(t, model.DB.AutoMigrate(migrations...))
	config, err := model.GetCommunityConfig()
	require.NoError(t, err)
	assert.False(t, config.Enabled)
	config.Name = "开发者大厅"
	config.Enabled = true
	config.AppSecret = "private-secret"
	config.CallbackToken = "private-token"
	require.NoError(t, model.SaveCommunityConfig(config))
	var storedConfig model.CommunityConfig
	require.NoError(t, model.DB.First(&storedConfig, 1).Error)
	assert.NotEqual(t, config.AppSecret, storedConfig.AppSecret)
	assert.NotEqual(t, config.CallbackToken, storedConfig.CallbackToken)
	require.NoError(t, model.DB.Create(&model.CommunityProfile{UserID: user.Id, Avatar: "https://cdn.example/avatar.png"}).Error)
	for i := range 55 {
		msg := model.CommunityMessage{Kind: "text", Text: strings.Repeat("x", i+1)}
		require.NoError(t, model.CreateCommunityMessage(user.Id, &msg))
	}
	// Repeat migration after populated data: no table/index recreation or lost defaults.
	require.NoError(t, model.DB.AutoMigrate(migrations...))
	rows, err := model.RecentCommunityMessages()
	require.NoError(t, err)
	require.Len(t, rows, 50)
	assert.Equal(t, 6, len(rows[0].Text))
	assert.Equal(t, 55, len(rows[49].Text))
	assert.Equal(t, user.Username, rows[0].Name)
	assert.Equal(t, "https://cdn.example/avatar.png", rows[0].Avatar)
	saved, err := model.GetCommunityConfig()
	require.NoError(t, err)
	assert.Equal(t, "private-secret", saved.AppSecret)
	assert.Equal(t, "开发者大厅", saved.Name)
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "chat-test")
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/community/ws", CommunityWebSocket)
	router.POST("/api/community/messages", middleware.UserAuth(), CommunityAccess, SendCommunityMessage)
	router.GET("/api/option/community", middleware.RootAuth(), GetCommunitySettings)
	server := httptest.NewServer(router)
	defer server.Close()
	for _, tc := range []struct {
		token, path string
		want        int
	}{{"", "/api/community/messages", 401}, {bundle.AccessToken, "/api/option/community", 403}} {
		method := "POST"
		if tc.path == "/api/option/community" {
			method = "GET"
		}
		req := httptest.NewRequest(method, tc.path, strings.NewReader(`{"text":"hello"}`))
		req.Header.Set("Authorization", "Bearer "+tc.token)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		assert.Equal(t, tc.want, rr.Code)
	}
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/community/ws"
	_, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Origin": {"https://evil.example"}})
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, 403, resp.StatusCode)
	resp.Body.Close()
	conn, _, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Origin": {server.URL}})
	require.NoError(t, err)
	defer conn.Close()
	payload, err := common.Marshal(map[string]string{"token": bundle.AccessToken})
	require.NoError(t, err)
	require.NoError(t, conn.WriteMessage(websocket.TextMessage, payload))
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
	_, data, err := conn.ReadMessage()
	require.NoError(t, err)
	var history struct {
		Messages []model.CommunityMessage `json:"messages"`
	}
	require.NoError(t, common.Unmarshal(data, &history))
	require.Len(t, history.Messages, 50)
	_, data, err = conn.ReadMessage()
	require.NoError(t, err)
	var presence struct {
		Users []model.CommunityMember `json:"users"`
	}
	require.NoError(t, common.Unmarshal(data, &presence))
	require.Len(t, presence.Users, 1)
	assert.Equal(t, user.Id, presence.Users[0].UserID)
	assert.Equal(t, user.Username, presence.Users[0].Name)
	assert.Equal(t, "https://cdn.example/avatar.png", presence.Users[0].Avatar)
	// Sender identity is server-owned and newly posted messages reach connected clients.
	post := httptest.NewRequest("POST", "/api/community/messages", strings.NewReader(`{"text":"new message","user_id":99999,"name":"spoofed"}`))
	post.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	posted := httptest.NewRecorder()
	router.ServeHTTP(posted, post)
	require.Equal(t, 200, posted.Code, posted.Body.String())
	assert.NotContains(t, posted.Body.String(), "spoofed")
	_, data, err = conn.ReadMessage()
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(data, &history))
	assert.Equal(t, "new message", history.Messages[len(history.Messages)-1].Text)
	assert.Equal(t, user.Id, history.Messages[len(history.Messages)-1].UserID)
	// Revoking the real login session must terminate a connected client.
	_, err = model.RevokeUserSession(user.Id, bundle.Session.SID, "test")
	require.NoError(t, err)
	_, _, err = conn.ReadMessage()
	require.Error(t, err)
	var closeError *websocket.CloseError
	require.ErrorAs(t, err, &closeError)
	config.Enabled = false
	require.NoError(t, model.SaveCommunityConfig(config))
	other, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "chat-test")
	require.NoError(t, err)
	req := httptest.NewRequest("POST", "/api/community/messages", strings.NewReader(`{"text":"hello"}`))
	req.Header.Set("Authorization", "Bearer "+other.AccessToken)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, 403, rr.Code)

	// Test-account setup remains possible while notifications are off.
	callback := gin.New()
	callback.GET("/callback", CommunityWeChatVerify)
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	parts := []string{config.CallbackToken, stamp, "nonce"}
	slices.Sort(parts)
	hash := sha1.Sum([]byte(strings.Join(parts, "")))
	query := url.Values{"timestamp": {stamp}, "nonce": {"nonce"}, "echostr": {"verified"}, "signature": {hex.EncodeToString(hash[:])}}
	callbackResponse := httptest.NewRecorder()
	callback.ServeHTTP(callbackResponse, httptest.NewRequest("GET", "/callback?"+query.Encode(), nil))
	assert.Equal(t, 200, callbackResponse.Code)
	assert.Equal(t, "verified", callbackResponse.Body.String())
	query.Set("signature", "invalid")
	callbackResponse = httptest.NewRecorder()
	callback.ServeHTTP(callbackResponse, httptest.NewRequest("GET", "/callback?"+query.Encode(), nil))
	assert.Equal(t, 403, callbackResponse.Code)

	// Public configuration never serializes credentials.
	data, err = common.Marshal(config)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "private-secret")
	assert.NotContains(t, string(data), "private-token")
}

func TestCommunityUploadSanitization(t *testing.T) {
	var original bytes.Buffer
	require.NoError(t, png.Encode(&original, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	data, mime, ext, err := sanitizeCommunityUpload(append(original.Bytes(), []byte("<script>bad</script>")...), ".png", true)
	require.NoError(t, err)
	assert.Equal(t, "image/png", mime)
	assert.Equal(t, ".png", ext)
	assert.NotContains(t, string(data), "script")
	for _, tc := range []struct {
		name, ext string
		data      []byte
		visual    bool
	}{
		{"mismatched extension", ".jpg", original.Bytes(), true},
		{"active SVG", ".svg", []byte(`<svg onload="bad()"/>`), true},
		{"HTML download", ".html", []byte("<html>bad</html>"), false},
		{"executable renamed PDF", ".pdf", []byte("MZbad"), false},
		{"oversized", ".txt", bytes.Repeat([]byte("x"), (10<<20)+1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, err := sanitizeCommunityUpload(tc.data, tc.ext, tc.visual)
			assert.Error(t, err)
		})
	}
	_, mime, _, err = sanitizeCommunityUpload([]byte("hello"), ".txt", false)
	require.NoError(t, err)
	assert.Equal(t, "application/octet-stream", mime)
	frames := &gif.GIF{Image: []*image.Paletted{image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White}), image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White})}, Delay: []int{5, 5}}
	var animated bytes.Buffer
	require.NoError(t, gif.EncodeAll(&animated, frames))
	data, _, _, err = sanitizeCommunityUpload(animated.Bytes(), ".gif", true)
	require.NoError(t, err)
	decoded, err := gif.DecodeAll(bytes.NewReader(data))
	require.NoError(t, err)
	assert.Len(t, decoded.Image, 2)
	assert.False(t, CommunityGIFBudget([]byte("GIF89a")))
}

type communityRoundTripper func(*http.Request) (*http.Response, error)

func (f communityRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCommunityWeChatPayloadAndFailure(t *testing.T) {
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	sends := 0
	http.DefaultTransport = communityRoundTripper(func(r *http.Request) (*http.Response, error) {
		assert.Equal(t, "api.weixin.qq.com", r.URL.Host)
		body := `{"access_token":"test-only-access-token","expires_in":7200}`
		if strings.HasSuffix(r.URL.Path, "/send") {
			sends++
			var request struct {
				ToUser string                       `json:"touser"`
				Data   map[string]map[string]string `json:"data"`
			}
			require.NoError(t, common.DecodeJson(r.Body, &request))
			assert.Equal(t, "receiver", request.ToUser)
			assert.Equal(t, "Alice", request.Data["sender"]["value"])
			assert.Equal(t, "@helper hello", request.Data["content"]["value"])
			body = `{"errcode":0,"msgid":123}`
			if sends == 2 {
				body = `{"errcode":40003,"errmsg":"secret-error-detail"}`
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	config := model.CommunityConfig{BotEnabled: true, AppID: "test-chat-app", AppSecret: "secret", TemplateID: "template", Receiver: "receiver"}
	message := model.CommunityMessage{Name: "Alice", Text: "@helper hello", CreatedAt: 1700000000}
	require.NoError(t, service.SendCommunityWeChat(context.Background(), config, message))
	err := service.SendCommunityWeChat(context.Background(), config, message)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "40003")
	assert.NotContains(t, err.Error(), "secret-error-detail")
	assert.True(t, service.CommunityMentionsBot("hi @helper hello", "helper"))
	assert.False(t, service.CommunityMentionsBot("email@helper hello", "helper"))
	assert.False(t, service.CommunityMentionsBot("@helper123", "helper"))
	config.BotEnabled = false
	assert.Error(t, service.SendCommunityWeChat(context.Background(), config, message))
	assert.Equal(t, 2, sends)
}

func TestCommunityAttachmentStorageAndOwnership(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}))
	require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: true, BotName: "helper"}))
	uploaded := false
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "PUT", r.Method)
		assert.True(t, strings.HasPrefix(r.URL.Path, "/chat-bucket/community/"))
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		assert.Equal(t, "image/png", r.Header.Get("Content-Type"))
		data, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		_, err = png.Decode(bytes.NewReader(data))
		assert.NoError(t, err)
		uploaded = true
		w.WriteHeader(200)
	}))
	defer storage.Close()
	for name, value := range map[string]string{"HELP_CENTER_IMAGE_S3_ENDPOINT": storage.URL, "HELP_CENTER_IMAGE_S3_BUCKET": "chat-bucket", "HELP_CENTER_IMAGE_S3_ACCESS_KEY": "fake-access", "HELP_CENTER_IMAGE_S3_SECRET_KEY": "fake-secret", "HELP_CENTER_IMAGE_PUBLIC_URL": "https://cdn.example"} {
		t.Setenv(name, value)
	}
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "upload-test")
	require.NoError(t, err)
	original := model.CommunityMessage{Kind: "text", Text: "Screenshot request"}
	require.NoError(t, model.CreateCommunityMessage(user.Id, &original))
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("kind", "sticker"))
	require.NoError(t, writer.WriteField("reply_to_id", strconv.FormatInt(original.ID, 10)))
	file, err := writer.CreateFormFile("file", "hello.png")
	require.NoError(t, err)
	require.NoError(t, png.Encode(file, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	require.NoError(t, writer.Close())
	router := gin.New()
	router.POST("/api/community/attachments", middleware.UserAuth(), CommunityAccess, UploadCommunityAttachment)
	request := httptest.NewRequest("POST", "/api/community/attachments", &body)
	request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, 200, response.Code, response.Body.String())
	assert.True(t, uploaded)
	var result struct {
		Data model.CommunityMessage `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, user.Id, result.Data.UserID)
	require.NotNil(t, result.Data.ReplyToID)
	assert.Equal(t, original.ID, *result.Data.ReplyToID)
	assert.Equal(t, "sticker", result.Data.Kind)
	assert.True(t, strings.HasPrefix(result.Data.URL, "https://cdn.example/community/"))
	assert.NotContains(t, response.Body.String(), "fake-secret")
}

func TestCommunityPresenceDeduplicatesAndRemovesDisconnectedUsers(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}))
	require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: true, BotName: "helper"}))
	other := model.User{Username: "chat-other", AffCode: "chatother", DisplayName: "Other user", Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&other).Error)
	router := gin.New()
	router.GET("/ws", CommunityWebSocket)
	server := httptest.NewServer(router)
	defer server.Close()
	connect := func(id int) *websocket.Conn {
		bundle, err := service.CreateLoginSession(id, "password", "127.0.0.1", "presence-test")
		require.NoError(t, err)
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws", http.Header{"Origin": {server.URL}})
		require.NoError(t, err)
		t.Cleanup(func() { conn.Close() })
		data, err := common.Marshal(map[string]string{"token": bundle.AccessToken})
		require.NoError(t, err)
		require.NoError(t, conn.WriteMessage(websocket.TextMessage, data))
		return conn
	}
	readPresence := func(conn *websocket.Conn, count int) []model.CommunityMember {
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		for {
			_, data, err := conn.ReadMessage()
			require.NoError(t, err)
			var frame struct {
				Type  string                  `json:"type"`
				Users []model.CommunityMember `json:"users"`
			}
			require.NoError(t, common.Unmarshal(data, &frame))
			if frame.Type == "presence" && len(frame.Users) == count {
				return frame.Users
			}
		}
	}
	first := connect(user.Id)
	readPresence(first, 1)
	duplicate := connect(user.Id)
	readPresence(duplicate, 1)
	second := connect(other.Id)
	users := readPresence(second, 2)
	assert.Equal(t, "Other user", users[1].Name)
	assert.NotContains(t, users[1].Name, "chat-other")
	readPresence(first, 2)
	require.NoError(t, duplicate.Close())
	require.NoError(t, second.Close())
	users = readPresence(first, 1)
	assert.Equal(t, user.Id, users[0].UserID)
}

func TestCommunitySettingsNameValidation(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}))
	router := gin.New()
	router.PUT("/settings", UpdateCommunitySettings)
	router.GET("/status", GetCommunityStatus)
	for _, tc := range []struct {
		name   string
		status int
	}{
		{" 开发者大厅 ", 200}, {strings.Repeat("名", 80), 200}, {strings.Repeat("名", 81), 400}, {"invalid\nname", 400}, {"", 200},
	} {
		body, err := common.Marshal(map[string]any{"name": tc.name, "bot_name": "helper"})
		require.NoError(t, err)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, httptest.NewRequest("PUT", "/settings", bytes.NewReader(body)))
		require.Equal(t, tc.status, rr.Code, rr.Body.String())
		if tc.status == 200 {
			config, err := model.GetCommunityConfig()
			require.NoError(t, err)
			assert.Equal(t, strings.TrimSpace(tc.name), config.Name)
			rr = httptest.NewRecorder()
			router.ServeHTTP(rr, httptest.NewRequest("GET", "/status", nil))
			var response struct {
				Data struct {
					Name string `json:"name"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(rr.Body.Bytes(), &response))
			assert.Equal(t, config.Name, response.Data.Name)
		}
	}
}

func TestCommunityCredentialsRequireSingleUseRootVerification(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	previousPasswordLogin := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() { common.PasswordLoginEnabled = previousPasswordLogin })
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}))
	require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{
		BotName: "helper", AppSecret: "saved-app-secret", CallbackToken: "saved-callback-token",
	}))
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "credential-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	router := gin.New()
	router.POST("/credentials", middleware.RootAuth(), GetCommunityCredentials)
	router.GET("/settings", middleware.RootAuth(), GetCommunitySettings)
	request := func(method, path, token, proof string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Security-Proof", proof)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, r)
		return rr
	}
	assert.Equal(t, http.StatusUnauthorized, request("POST", "/credentials", "", "").Code)
	assert.Equal(t, http.StatusForbidden, request("POST", "/credentials", bundle.AccessToken, "").Code)
	_, err = service.GetVerificationRequirements(identity, service.VerificationScopeCommunityKeyRead)
	assert.ErrorIs(t, err, service.ErrVerificationForbidden)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	settings := request("GET", "/settings", bundle.AccessToken, "")
	require.Equal(t, http.StatusOK, settings.Code)
	assert.NotContains(t, settings.Body.String(), "saved-app-secret")
	assert.NotContains(t, settings.Body.String(), "saved-callback-token")
	input := service.VerificationInput{Scope: service.VerificationScopeCommunityKeyRead, Method: "password", Password: "wrong-password"}
	_, err = service.VerifySecurityInput(identity, input)
	assert.ErrorIs(t, err, service.ErrVerificationFailed)
	input.Password = "enrollment-password"
	for _, tc := range []struct{ name, code string }{
		{"missing", "SECURITY_PROOF_REQUIRED"},
		{"wrong scope", "SECURITY_PROOF_SCOPE_MISMATCH"},
		{"expired", "SECURITY_PROOF_EXPIRED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var proof string
			switch tc.name {
			case "wrong scope":
				proof = issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeTwoFASetup}, service.VerificationMethodPassword)
			case "expired":
				issued, err := service.VerifySecurityInput(identity, input)
				require.NoError(t, err)
				proof = issued.ProofToken
				var flow model.AuthFlow
				require.NoError(t, model.DB.Order("id DESC").First(&flow).Error)
				require.NoError(t, model.DB.Model(&flow).Update("expires_at", time.Now().Add(-time.Minute)).Error)
			}
			response := request("POST", "/credentials", bundle.AccessToken, proof)
			require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			assert.Contains(t, response.Body.String(), tc.code)
			assert.NotContains(t, response.Body.String(), "saved-app-secret")
			assert.NotContains(t, response.Body.String(), "saved-callback-token")
		})
	}
	proof, err := service.VerifySecurityInput(identity, input)
	require.NoError(t, err)
	response := request("POST", "/credentials", bundle.AccessToken, proof.ProofToken)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	assert.JSONEq(t, `{"success":true,"data":{"app_secret":"saved-app-secret","callback_token":"saved-callback-token"}}`, response.Body.String())
	response = request("POST", "/credentials", bundle.AccessToken, proof.ProofToken)
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Contains(t, response.Body.String(), "SECURITY_PROOF_CONSUMED")
	var logs []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&logs).Error)
	audit, err := common.Marshal(logs)
	require.NoError(t, err)
	assert.Contains(t, string(audit), "community.credentials_view")
	for _, secret := range []string{"saved-app-secret", "saved-callback-token", proof.ProofToken} {
		assert.NotContains(t, string(audit), secret)
	}
	// Enrolled factors cannot be bypassed with a password, even when unavailable.
	twoFA := model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
	require.NoError(t, model.DB.Create(&twoFA).Error)
	_, err = service.VerifySecurityInput(identity, input)
	assert.ErrorIs(t, err, service.ErrProofMethod)
	require.NoError(t, model.DB.Model(&twoFA).Update("is_enabled", false).Error)
	common.PasswordLoginEnabled = false
	_, err = service.VerifySecurityInput(identity, input)
	assert.ErrorIs(t, err, service.ErrVerificationUnavailable)
	common.PasswordLoginEnabled = true
	proof, err = service.VerifySecurityInput(identity, input)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", bundle.Session.SID).Update("expires_at", time.Now().Add(-time.Minute).Unix()).Error)
	response = request("POST", "/credentials", bundle.AccessToken, proof.ProofToken)
	assert.Equal(t, http.StatusUnauthorized, response.Code)
	assert.NotContains(t, response.Body.String(), "saved-app-secret")
}

type communityMessageBeforeReplies struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	UserID    int    `json:"user_id" gorm:"index"`
	Name      string `json:"name" gorm:"type:varchar(80)"`
	Avatar    string `json:"avatar" gorm:"type:text"`
	Text      string `json:"text" gorm:"type:text"`
	Kind      string `json:"kind" gorm:"type:varchar(16)"`
	URL       string `json:"url" gorm:"type:text"`
	Filename  string `json:"filename" gorm:"type:varchar(255)"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"created_at"`
	Deleted   bool   `json:"deleted"`
}

func TestCommunityRepliesMigrationAndHistory(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				t.Skip("database DSN not configured")
			}
			t.Setenv("TEST_SECURITY_DIALECT", dialect)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					user, _ := setupSecurityEnrollmentTest(t)
					if upgrade {
						require.NoError(t, model.DB.Table("community_messages").AutoMigrate(&communityMessageBeforeReplies{}))
						require.NoError(t, model.DB.Table("community_messages").Create(&communityMessageBeforeReplies{UserID: user.Id, Name: "Original author", Text: "Original question", Kind: "text"}).Error)
					}
					for range 2 {
						require.NoError(t, model.DB.AutoMigrate(&model.CommunityMessage{}, &model.CommunityProfile{}))
					}
					require.True(t, model.DB.Migrator().HasIndex(&model.CommunityMessage{}, "UserID"))
					var original model.CommunityMessage
					if upgrade {
						require.NoError(t, model.DB.First(&original).Error)
					} else {
						original = model.CommunityMessage{Text: "Original question", Kind: "text"}
						require.NoError(t, model.CreateCommunityMessage(user.Id, &original))
					}
					assert.Equal(t, "Original question", original.Text)
					// The quoted message may be older than the live history window.
					for range 50 {
						require.NoError(t, model.DB.Create(&model.CommunityMessage{UserID: user.Id, Kind: "text", Text: "Later message"}).Error)
					}
					reply := model.CommunityMessage{Text: "Answer", Kind: "text", ReplyToID: &original.ID}
					require.NoError(t, model.CreateCommunityMessage(user.Id, &reply))
					rows, err := model.RecentCommunityMessages()
					require.NoError(t, err)
					require.Len(t, rows, 50)
					require.NotNil(t, rows[49].Reply)
					assert.Equal(t, original.ID, rows[49].Reply.ID)
					assert.Equal(t, "Original question", rows[49].Reply.Text)
					require.NoError(t, model.DB.Model(&original).Updates(map[string]any{"deleted": true, "text": ""}).Error)
					rows, err = model.RecentCommunityMessages()
					require.NoError(t, err)
					require.NotNil(t, rows[49].Reply)
					assert.True(t, rows[49].Reply.Deleted)
					assert.Empty(t, rows[49].Reply.Text)
					require.Error(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "Invalid", ReplyToID: &original.ID}))
					for _, id := range []int64{0, -1, 999999} {
						require.Error(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "Invalid", ReplyToID: &id}))
					}
				})
			}
		})
	}
}

func TestCommunityBotFeedback(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}))
	config := model.CommunityConfig{Enabled: true, BotEnabled: true, BotName: "helper", AppID: "feedback-test", AppSecret: "test-secret", TemplateID: "test-template", Receiver: "test-receiver"}
	require.NoError(t, model.SaveCommunityConfig(config))
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	response := `{"errcode":0,"msgid":123}`
	http.DefaultTransport = communityRoundTripper(func(r *http.Request) (*http.Response, error) {
		body := response
		if strings.HasSuffix(r.URL.Path, "/token") {
			body = `{"access_token":"test-token","expires_in":7200}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	assert.Empty(t, notifyCommunityBot(model.CommunityMessage{Text: "Ordinary message"}))
	message := model.CommunityMessage{Text: "@helper help"}
	assert.Equal(t, "accepted", notifyCommunityBot(message))
	original := model.CommunityMessage{Kind: "text", Text: "Question"}
	require.NoError(t, model.CreateCommunityMessage(user.Id, &original))
	payload, err := common.Marshal(map[string]any{"text": "@helper answer", "reply_to_id": original.ID})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/messages", bytes.NewReader(payload))
	c.Set("id", user.Id)
	SendCommunityMessage(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var result struct {
		BotStatus string                 `json:"bot_status"`
		Data      model.CommunityMessage `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
	assert.Equal(t, "accepted", result.BotStatus)
	require.NotNil(t, result.Data.ReplyToID)
	assert.Equal(t, original.ID, *result.Data.ReplyToID)
	assert.Equal(t, user.Id, result.Data.UserID)

	response = `{"errcode":40003}`
	assert.Equal(t, "failed", notifyCommunityBot(message))
	for range cap(communityBotSlots) {
		communityBotSlots <- struct{}{}
	}
	assert.Equal(t, "busy", notifyCommunityBot(message))
	for range cap(communityBotSlots) {
		<-communityBotSlots
	}
}
