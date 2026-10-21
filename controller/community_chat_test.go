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
	migrations := []any{&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}}
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
	assert.True(t, model.CommunityMentionsBot("hi @helper hello", "helper"))
	assert.False(t, model.CommunityMentionsBot("email@helper hello", "helper"))
	assert.False(t, model.CommunityMentionsBot("@helper123", "helper"))
	config.BotEnabled = false
	assert.Error(t, service.SendCommunityWeChat(context.Background(), config, message))
	assert.Equal(t, 2, sends)
}

func TestCommunityAttachmentStorageAndOwnership(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
	require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: true, BotEnabled: true, BotName: "helper", BotReply: "Screenshot received"}))
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
	require.NoError(t, writer.WriteField("text", "@helper screenshot"))
	require.NoError(t, writer.WriteField("client_id", "dd599fcc-b7ed-4a46-9cb2-a8cd8122fb76"))
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
	require.NotNil(t, result.Data.ClientID)
	assert.Equal(t, "dd599fcc-b7ed-4a46-9cb2-a8cd8122fb76", *result.Data.ClientID)
	records, total, err := model.ListCommunityBotFeedback(0, 20)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.EqualValues(t, 1, total)
	assert.Equal(t, result.Data.ID, records[0].MessageID)
	assert.Equal(t, "hello.png", records[0].Filename)
	assert.Contains(t, records[0].ReplyText, "Screenshot received")
}

func TestCommunityPresenceDeduplicatesAndRemovesDisconnectedUsers(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
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
						require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
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

// The last release (v1.0.0-rc.42) has no community tables. The fresh path
// covers that release; this snapshot also covers existing branch installations.
type communityConfigBeforeBotReplies struct {
	ID            int    `gorm:"primaryKey"`
	Name          string `gorm:"type:varchar(80)"`
	Enabled       bool
	BotEnabled    bool
	BotName       string `gorm:"type:varchar(32)"`
	AppID         string `gorm:"type:varchar(128)"`
	AppSecret     string `gorm:"type:text"`
	TemplateID    string `gorm:"type:varchar(128)"`
	Receiver      string `gorm:"type:varchar(128)"`
	CallbackToken string `gorm:"type:text"`
}

func TestCommunityBotFeedback(t *testing.T) {
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
						require.NoError(t, model.DB.Table("community_configs").AutoMigrate(&communityConfigBeforeBotReplies{}))
						require.NoError(t, model.DB.Table("community_configs").Create(&communityConfigBeforeBotReplies{ID: 1, Enabled: true, BotEnabled: true, BotName: "helper"}).Error)
						require.NoError(t, model.DB.Table("community_messages").AutoMigrate(&communityMessageBeforeReplies{}))
						require.NoError(t, model.DB.Table("community_messages").Create(&communityMessageBeforeReplies{UserID: user.Id, Name: "Original author", Text: "Earlier message", Kind: "text"}).Error)
					}
					migrations := []any{&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}}
					for range 2 {
						require.NoError(t, model.DB.AutoMigrate(migrations...))
					}
					require.True(t, model.DB.Migrator().HasIndex(&model.CommunityMessage{}, "UserID"))
					config, err := model.GetCommunityConfig()
					require.NoError(t, err)
					assert.Equal(t, model.DefaultCommunityBotReply, config.BotReply)
					if upgrade {
						var old model.CommunityMessage
						require.NoError(t, model.DB.First(&old).Error)
						assert.Equal(t, "Earlier message", old.Text)
						assert.True(t, config.BotEnabled)
					}
					config.Enabled, config.BotEnabled, config.BotName, config.BotReply = true, true, "helper", "We received your message."
					require.NoError(t, model.SaveCommunityConfig(config))
					requestID := "690681f4-f0f2-4218-a8f3-078535807608"
					mention := model.CommunityMessage{Text: "@helper please help", Kind: "text", ClientID: &requestID}
					require.NoError(t, model.CreateCommunityMessage(user.Id, &mention))
					duplicate := model.CommunityMessage{Text: mention.Text, Kind: "text", ClientID: &requestID}
					require.NoError(t, model.CreateCommunityMessage(user.Id, &duplicate))
					assert.Equal(t, mention.ID, duplicate.ID)
					rows, err := model.RecentCommunityMessages()
					require.NoError(t, err)
					reply := rows[len(rows)-1]
					assert.True(t, reply.IsBot)
					assert.Zero(t, reply.UserID)
					require.NotNil(t, reply.Reply)
					assert.Equal(t, mention.ID, reply.Reply.ID)
					assert.Equal(t, mention.Text, reply.Reply.Text)
					assert.Equal(t, fmt.Sprintf("@[%s](user:%d) We received your message.", user.Username, user.Id), reply.Text)
					records, total, err := model.ListCommunityBotFeedback(0, 20)
					require.NoError(t, err)
					require.Len(t, records, 1)
					assert.EqualValues(t, 1, total)
					assert.Equal(t, reply.ID, records[0].ReplyID)
					assert.Equal(t, reply.Text, records[0].ReplyText)
					// Ordinary messages and disabled bots do not create feedback.
					require.NoError(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "email@helper", Kind: "text"}))
					config.BotEnabled = false
					require.NoError(t, model.SaveCommunityConfig(config))
					require.NoError(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "@helper disabled", Kind: "text"}))
					_, total, err = model.ListCommunityBotFeedback(1, 1)
					require.NoError(t, err)
					assert.EqualValues(t, 1, total)
					// A second mention after re-enabling uses the latest configured reply.
					config.BotEnabled, config.BotReply = true, "Updated reply"
					require.NoError(t, model.SaveCommunityConfig(config))
					require.NoError(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "@helper attachment", Kind: "image", Filename: "screen.png", URL: "https://cdn.example/screen.png"}))
					records, total, err = model.ListCommunityBotFeedback(0, 1)
					require.NoError(t, err)
					require.Len(t, records, 1)
					assert.EqualValues(t, 2, total)
					assert.Equal(t, "screen.png", records[0].Filename)
					assert.Contains(t, records[0].ReplyText, "Updated reply")
					// Restart migrations preserve messages, snapshots and uniqueness.
					for range 2 {
						require.NoError(t, model.DB.AutoMigrate(migrations...))
					}
					require.NoError(t, model.CreateCommunityMessage(user.Id, &duplicate))
					_, total, err = model.ListCommunityBotFeedback(0, 20)
					require.NoError(t, err)
					assert.EqualValues(t, 2, total)
					// Feedback failure rolls back both user and bot messages.
					var before int64
					require.NoError(t, model.DB.Model(&model.CommunityMessage{}).Count(&before).Error)
					require.NoError(t, model.DB.Migrator().DropTable(&model.CommunityBotFeedback{}))
					require.Error(t, model.CreateCommunityMessage(user.Id, &model.CommunityMessage{Text: "@helper rollback", Kind: "text"}))
					var after int64
					require.NoError(t, model.DB.Model(&model.CommunityMessage{}).Count(&after).Error)
					assert.Equal(t, before, after)
				})
			}
		})
	}
}

func TestCommunityFeedbackAdministrationAndSettings(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "feedback-test")
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/community/bot-feedback", middleware.AdminAuth(), GetCommunityBotFeedback)
	router.PUT("/settings", middleware.RootAuth(), UpdateCommunitySettings)
	request := func(method, path, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		return rr
	}
	assert.Equal(t, 401, request("GET", "/api/community/bot-feedback", "", "").Code)
	assert.Equal(t, 403, request("GET", "/api/community/bot-feedback", "", bundle.AccessToken).Code)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleAdminUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	rr := request("GET", "/api/community/bot-feedback?page=1&page_size=20", "", bundle.AccessToken)
	require.Equal(t, 200, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"items":[]`)
	scoped, _ := createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, "log:read")
	assert.Equal(t, 403, request("GET", "/api/community/bot-feedback", "", scoped).Code)
	assert.Equal(t, 400, request("GET", "/api/community/bot-feedback?page=-1", "", bundle.AccessToken).Code)
	assert.Equal(t, 400, request("GET", "/api/community/bot-feedback?page_size=101", "", bundle.AccessToken).Code)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	rr = request("PUT", "/settings", `{"enabled":true,"bot_enabled":true,"bot_name":"helper","bot_reply":"Custom reply"}`, bundle.AccessToken)
	require.Equal(t, 200, rr.Code, rr.Body.String())
	config, err := model.GetCommunityConfig()
	require.NoError(t, err)
	assert.Equal(t, "Custom reply", config.BotReply)
	body, err := common.Marshal(map[string]any{"bot_name": "helper", "bot_reply": strings.Repeat("x", 2001)})
	require.NoError(t, err)
	assert.Equal(t, 400, request("PUT", "/settings", string(body), bundle.AccessToken).Code)
	_, err = model.RevokeUserSession(user.Id, bundle.Session.SID, "test")
	require.NoError(t, err)
	assert.Equal(t, 401, request("GET", "/api/community/bot-feedback", "", bundle.AccessToken).Code)
}

func TestCommunityWeChatDoesNotDelayChatReply(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
	require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: true, BotEnabled: true, BotName: "helper", BotReply: "Received", AppID: "nonblocking-test", AppSecret: "test-secret", TemplateID: "template", Receiver: "receiver"}))
	previous := http.DefaultTransport
	release := make(chan struct{})
	http.DefaultTransport = communityRoundTripper(func(r *http.Request) (*http.Response, error) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
		return &http.Response{StatusCode: 502, Body: io.NopCloser(strings.NewReader(`{}`)), Header: make(http.Header)}, nil
	})
	t.Cleanup(func() {
		close(release)
		// Wait for the bounded background notifier to finish before restoring transport.
		for range cap(communityBotSlots) {
			communityBotSlots <- struct{}{}
		}
		for range cap(communityBotSlots) {
			<-communityBotSlots
		}
		http.DefaultTransport = previous
	})
	rr := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rr)
	c.Set("id", user.Id)
	c.Request = httptest.NewRequest("POST", "/messages", strings.NewReader(`{"text":"@helper help","client_id":"6f5c8db5-1fc6-4ca6-be59-d1a52cc35654"}`))
	finished := make(chan struct{})
	go func() { SendCommunityMessage(c); close(finished) }()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("chat send waited for the blocked WeChat response")
	}
	require.Equal(t, 200, rr.Code, rr.Body.String())
	assert.NotContains(t, rr.Body.String(), "bot_status")
	var response struct {
		Data model.CommunityMessage `json:"data"`
	}
	require.NoError(t, common.Unmarshal(rr.Body.Bytes(), &response))
	require.NotNil(t, response.Data.ClientID)
	assert.Equal(t, "6f5c8db5-1fc6-4ca6-be59-d1a52cc35654", *response.Data.ClientID)
	records, total, err := model.ListCommunityBotFeedback(0, 20)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.EqualValues(t, 1, total)
	assert.Equal(t, response.Data.ID, records[0].MessageID)
}

func TestCommunityHistoryVisibilityAndSoftDeletion(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				t.Skip("database DSN not configured")
			}
			t.Setenv("TEST_SECURITY_DIALECT", dialect)
			user, _ := setupSecurityEnrollmentTest(t)
			require.NoError(t, model.DB.AutoMigrate(&model.CommunityConfig{}, &model.CommunityMessage{}, &model.CommunityProfile{}, &model.CommunityBotFeedback{}))
			require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: true}))
			location := time.Local
			time.Local = time.FixedZone("site", 8*60*60)
			t.Cleanup(func() { time.Local = location })
			now := time.Now()
			start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			requestID := "ab0c3fb6-f567-4d4e-9aaf-ed80bc61e6fa"
			old := model.CommunityMessage{UserID: user.Id, Name: "Alice", Text: "Yesterday private archive", CreatedAt: start.Unix() - 1, Kind: "text"}
			require.NoError(t, model.DB.Create(&old).Error)
			first := model.CommunityMessage{UserID: user.Id, Name: "Alice", Text: "At midnight", CreatedAt: start.Unix(), Kind: "text"}
			require.NoError(t, model.DB.Create(&first).Error)
			removed := model.CommunityMessage{UserID: user.Id, Name: "Alice", Text: "Retained original", Filename: "retained.txt", URL: "https://cdn.example/retained.txt", Size: 32, Kind: "file", CreatedAt: start.Unix() + 1, ClientID: &requestID, ReplyToID: &first.ID}
			require.NoError(t, model.DB.Create(&removed).Error)
			quoted := model.CommunityMessage{UserID: user.Id, Text: "Today quote", Kind: "text", CreatedAt: start.Unix() + 2, ReplyToID: &removed.ID}
			require.NoError(t, model.DB.Create(&quoted).Error)
			oldQuote := model.CommunityMessage{UserID: user.Id, Text: "Legacy cross-day quote", Kind: "text", CreatedAt: start.Unix() + 3, ReplyToID: &old.ID}
			require.NoError(t, model.DB.Create(&oldQuote).Error)
			future := model.CommunityMessage{UserID: user.Id, Text: "Tomorrow boundary", Kind: "text", CreatedAt: start.AddDate(0, 0, 1).Unix()}
			require.NoError(t, model.DB.Create(&future).Error)
			bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "history-test")
			require.NoError(t, err)
			router := gin.New()
			router.GET("/api/community/messages", middleware.UserAuth(), GetCommunityMessages)
			router.GET("/api/community/history", middleware.AdminAuth(), GetCommunityHistory)
			router.DELETE("/api/community/messages/:id", middleware.RootAuth(), DeleteCommunityMessage)
			router.POST("/api/community/messages", middleware.UserAuth(), SendCommunityMessage)
			request := func(method, path, body, token string) *httptest.ResponseRecorder {
				req := httptest.NewRequest(method, path, strings.NewReader(body))
				req.Header.Set("Authorization", "Bearer "+token)
				rr := httptest.NewRecorder()
				router.ServeHTTP(rr, req)
				return rr
			}
			assert.Equal(t, 401, request("GET", "/api/community/history", "", "").Code)
			assert.Equal(t, 401, request("GET", "/api/community/messages", "", "").Code)
			assert.Equal(t, 403, request("GET", "/api/community/history", "", bundle.AccessToken).Code)
			assert.Equal(t, 403, request("DELETE", fmt.Sprintf("/api/community/messages/%d", removed.ID), "", bundle.AccessToken).Code)
			require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
			require.NoError(t, model.PublishUserAuthCache(user.Id))
			require.Equal(t, 200, request("DELETE", fmt.Sprintf("/api/community/messages/%d", removed.ID), "", bundle.AccessToken).Code)
			var persisted model.CommunityMessage
			require.NoError(t, model.DB.First(&persisted, removed.ID).Error)
			assert.True(t, persisted.Deleted)
			assert.Equal(t, removed.Text, persisted.Text)
			assert.Equal(t, removed.URL, persisted.URL)
			assert.Equal(t, removed.ReplyToID, persisted.ReplyToID)
			require.NoError(t, model.DB.Model(user).Update("role", common.RoleAdminUser).Error)
			require.NoError(t, model.PublishUserAuthCache(user.Id))
			archive := request("GET", "/api/community/history?limit=100", "", bundle.AccessToken)
			require.Equal(t, 200, archive.Code, archive.Body.String())
			assert.Contains(t, archive.Body.String(), removed.Text)
			assert.Contains(t, archive.Body.String(), old.Text)
			assert.Contains(t, archive.Body.String(), removed.URL)
			scoped, _ := createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, "log:read")
			assert.Equal(t, 403, request("GET", "/api/community/history", "", scoped).Code)
			assert.Equal(t, 403, request("GET", "/api/community/messages", "", scoped).Code)
			require.NoError(t, model.DB.Model(user).Update("role", common.RoleCommonUser).Error)
			require.NoError(t, model.PublishUserAuthCache(user.Id))
			for _, path := range []string{"/api/community/messages?limit=100", fmt.Sprintf("/api/community/messages?before_id=%d&archive=true&day_start=0", removed.ID), fmt.Sprintf("/api/community/messages?before_id=%d", old.ID)} {
				rr := request("GET", path, "", bundle.AccessToken)
				require.Equal(t, 200, rr.Code, rr.Body.String())
				for _, hidden := range []string{old.Text, future.Text, removed.Text, removed.Filename, removed.URL} {
					assert.NotContains(t, rr.Body.String(), hidden)
				}
			}
			var page struct {
				Data model.CommunityHistory `json:"data"`
			}
			rr := request("GET", "/api/community/messages?limit=2", "", bundle.AccessToken)
			require.NoError(t, common.Unmarshal(rr.Body.Bytes(), &page))
			require.Len(t, page.Data.Items, 2)
			assert.Equal(t, start.Unix(), page.Data.DayStart)
			assert.Equal(t, start.AddDate(0, 0, 1).Unix(), page.Data.DayEnd)
			assert.True(t, page.Data.HasMore)
			assert.Equal(t, []int64{removed.ID}, page.Data.DeletedIDs)
			assert.Nil(t, page.Data.Items[1].Reply)
			require.NotNil(t, page.Data.Items[0].Reply)
			assert.True(t, page.Data.Items[0].Reply.Deleted)
			assert.Empty(t, page.Data.Items[0].Reply.Text)
			rr = request("GET", fmt.Sprintf("/api/community/messages?before_id=%d&limit=2", page.Data.Items[0].ID), "", bundle.AccessToken)
			page.Data = model.CommunityHistory{}
			require.NoError(t, common.Unmarshal(rr.Body.Bytes(), &page))
			require.Len(t, page.Data.Items, 2)
			assert.False(t, page.Data.HasMore)
			assert.Equal(t, first.ID, page.Data.Items[0].ID)
			assert.True(t, page.Data.Items[1].Deleted)
			assert.Empty(t, page.Data.Items[1].URL)
			assert.Nil(t, page.Data.Items[1].ReplyToID)
			live, err := model.RecentCommunityMessages()
			require.NoError(t, err)
			require.Len(t, live, 4)
			assert.Empty(t, live[1].Text)
			require.ErrorIs(t, model.ValidateCommunityReply(&old.ID), model.ErrCommunityReplyUnavailable)
			rr = request("POST", "/api/community/messages", fmt.Sprintf(`{"text":"retry","client_id":%q}`, requestID), bundle.AccessToken)
			require.Equal(t, 200, rr.Code, rr.Body.String())
			assert.NotContains(t, rr.Body.String(), removed.Text)
			assert.NotContains(t, rr.Body.String(), removed.URL)
			for _, suffix := range []string{"?limit=101", "?limit=0", "?before_id=-1", "?before_id=abc"} {
				assert.Equal(t, 400, request("GET", "/api/community/messages"+suffix, "", bundle.AccessToken).Code)
			}
			require.NoError(t, model.SaveCommunityConfig(model.CommunityConfig{Enabled: false}))
			assert.Equal(t, 403, request("GET", "/api/community/messages", "", bundle.AccessToken).Code)
			require.NoError(t, model.DB.Model(user).Update("role", common.RoleAdminUser).Error)
			require.NoError(t, model.PublishUserAuthCache(user.Id))
			assert.Equal(t, 200, request("GET", "/api/community/history", "", bundle.AccessToken).Code)
			_, err = model.RevokeUserSession(user.Id, bundle.Session.SID, "test")
			require.NoError(t, err)
			assert.Equal(t, 401, request("GET", "/api/community/history", "", bundle.AccessToken).Code)
		})
	}
}
