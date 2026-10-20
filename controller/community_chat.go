package controller

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var communityConnections = struct {
	sync.Mutex
	users map[int]int
	total int
}{users: make(map[int]int)}
var communityBotSlots = make(chan struct{}, 4)

func communityError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"success": false, "message": message})
}

func CommunityAccess(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		communityError(c, 401, "A dashboard login session is required")
		c.Abort()
		return
	}
	config, err := model.GetCommunityConfig()
	if err != nil {
		communityError(c, 500, "Could not load community settings")
		c.Abort()
		return
	}
	if !config.Enabled {
		communityError(c, 403, "Community chat is disabled")
		c.Abort()
		return
	}
	c.Next()
}

func GetCommunityStatus(c *gin.Context) {
	config, err := model.GetCommunityConfig()
	if err != nil {
		communityError(c, 500, "Could not load community settings")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": config.Enabled, "bot_enabled": config.BotEnabled, "bot_name": config.BotName}})
}

func GetCommunitySettings(c *gin.Context) {
	config, err := model.GetCommunityConfig()
	if err != nil {
		communityError(c, 500, "Could not load community settings")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": config, "has_secret": config.AppSecret != "", "has_callback_token": config.CallbackToken != ""})
}

func UpdateCommunitySettings(c *gin.Context) {
	markAuditLogged(c)
	var req struct {
		model.CommunityConfig
		Secret string `json:"app_secret"`
		Token  string `json:"callback_token"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if common.DecodeJson(c.Request.Body, &req) != nil {
		communityError(c, 400, "Invalid community settings")
		return
	}
	config := req.CommunityConfig
	validID := regexp.MustCompile(`^[A-Za-z0-9_-]{0,128}$`)
	if utf8.RuneCountInString(config.BotName) < 1 || utf8.RuneCountInString(config.BotName) > 24 || strings.ContainsAny(config.BotName, "@ \t\n\r") || !validID.MatchString(config.AppID) || !validID.MatchString(config.TemplateID) || !validID.MatchString(config.Receiver) || !validID.MatchString(req.Token) || !validID.MatchString(req.Secret) {
		communityError(c, 400, "Invalid community settings")
		return
	}
	old, err := model.GetCommunityConfig()
	if err != nil {
		communityError(c, 500, "Could not load community settings")
		return
	}
	config.AppSecret = old.AppSecret
	config.CallbackToken = old.CallbackToken
	if req.Secret != "" {
		config.AppSecret = req.Secret
	}
	if req.Token != "" {
		config.CallbackToken = req.Token
	}
	if config.BotEnabled && (config.AppID == "" || config.AppSecret == "" || config.TemplateID == "" || config.Receiver == "") {
		communityError(c, 400, "Complete the WeChat bot settings first")
		return
	}
	if err = model.SaveCommunityConfig(config); err != nil {
		communityError(c, 500, "Could not save community settings")
		return
	}
	recordManageAudit(c, "community.settings", map[string]any{"enabled": config.Enabled, "bot_enabled": config.BotEnabled})
	c.JSON(200, gin.H{"success": true})
}

func CommunityWeChatVerify(c *gin.Context) {
	config, err := model.GetCommunityConfig()
	if err != nil || config.CallbackToken == "" {
		c.Status(403)
		return
	}
	stamp, err := strconv.ParseInt(c.Query("timestamp"), 10, 64)
	now := time.Now().Unix()
	if err != nil || stamp < now-300 || stamp > now+300 || len(c.Query("nonce")) > 128 || len(c.Query("echostr")) > 256 {
		c.Status(403)
		return
	}
	parts := []string{config.CallbackToken, c.Query("timestamp"), c.Query("nonce")}
	slices.Sort(parts)
	hash := sha1.Sum([]byte(strings.Join(parts, "")))
	if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(hash[:])), []byte(c.Query("signature"))) != 1 {
		c.Status(403)
		return
	}
	if c.Request.Method == http.MethodPost {
		if _, err := io.Copy(io.Discard, io.LimitReader(c.Request.Body, (64<<10)+1)); err != nil {
			c.Status(400)
			return
		}
		c.String(200, "success")
		return
	}
	c.String(200, "%s", c.Query("echostr"))
}

func TestCommunityWeChat(c *gin.Context) {
	markAuditLogged(c)
	config, err := model.GetCommunityConfig()
	if err != nil {
		communityError(c, 500, "Could not load community settings")
		return
	}
	err = service.SendCommunityWeChat(c.Request.Context(), config, model.CommunityMessage{Name: "new-api", Text: "WeChat bot test", CreatedAt: time.Now().Unix()})
	recordManageAudit(c, "community.wechat_test", map[string]any{"success": err == nil})
	if err != nil {
		communityError(c, 502, err.Error())
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func SendCommunityMessage(c *gin.Context) {
	var req struct {
		Text string `json:"text"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<10)
	if common.DecodeJson(c.Request.Body, &req) != nil || strings.TrimSpace(req.Text) == "" || utf8.RuneCountInString(req.Text) > 2000 {
		communityError(c, 400, "Message must contain 1 to 2000 characters")
		return
	}
	message := model.CommunityMessage{Text: strings.TrimSpace(req.Text), Kind: "text"}
	if err := model.CreateCommunityMessage(c.GetInt("id"), &message); err != nil {
		communityError(c, 500, "Could not send message")
		return
	}
	notifyCommunityBot(message)
	c.JSON(200, gin.H{"success": true, "data": message})
}

func notifyCommunityBot(message model.CommunityMessage) {
	config, err := model.GetCommunityConfig()
	if err != nil || !config.Enabled || !config.BotEnabled || !service.CommunityMentionsBot(message.Text, config.BotName) {
		return
	}
	select {
	case communityBotSlots <- struct{}{}:
	default:
		common.SysLog("community WeChat notification skipped: queue busy")
		return
	}
	go func() {
		defer func() {
			<-communityBotSlots
			if recover() != nil {
				common.SysError("community WeChat notification panic")
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := service.SendCommunityWeChat(ctx, config, message); err != nil {
			common.SysError(fmt.Sprintf("community notification failed: message=%d %s", message.ID, err))
		}
	}()
}

func DeleteCommunityMessage(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		communityError(c, 400, "Invalid message")
		return
	}
	result := model.DB.Model(&model.CommunityMessage{}).Where("id = ?", id).Updates(map[string]any{"deleted": true, "text": "", "url": "", "filename": "", "size": 0})
	if result.Error != nil {
		communityError(c, 500, "Could not delete message")
		return
	}
	recordManageAudit(c, "community.delete", map[string]any{"message_id": id})
	c.JSON(200, gin.H{"success": true})
}

// Credentials are sent only in the first encrypted frame, never in URLs or subprotocol headers.
func CommunityWebSocket(c *gin.Context) {
	origin, err := url.Parse(c.GetHeader("Origin"))
	if err != nil || origin.Host != c.Request.Host || (common.SessionCookieSecure && origin.Scheme != "https") || (origin.Scheme != "https" && origin.Scheme != "http") || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || origin.User != nil {
		communityError(c, 403, "Invalid WebSocket origin")
		return
	}
	communityConnections.Lock()
	if communityConnections.total >= 256 {
		communityConnections.Unlock()
		communityError(c, 429, "Too many chat connections")
		return
	}
	communityConnections.total++
	communityConnections.Unlock()
	defer func() { communityConnections.Lock(); communityConnections.total--; communityConnections.Unlock() }()
	upgrader := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(8192)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return
	}
	var auth struct {
		Token string `json:"token"`
	}
	if common.Unmarshal(data, &auth) != nil {
		return
	}
	identity, internal, err := service.ParseDashboardAccessToken(auth.Token)
	if err != nil || !internal {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Login required"), time.Now().Add(time.Second))
		return
	}
	if _, _, err = service.ValidateLoginSession(identity); err != nil {
		return
	}
	communityConnections.Lock()
	if communityConnections.users[identity.UserID] >= 3 {
		communityConnections.Unlock()
		return
	}
	communityConnections.users[identity.UserID]++
	communityConnections.Unlock()
	defer func() {
		communityConnections.Lock()
		communityConnections.users[identity.UserID]--
		if communityConnections.users[identity.UserID] == 0 {
			delete(communityConnections.users, identity.UserID)
		}
		communityConnections.Unlock()
	}()
	common.SysLog(fmt.Sprintf("community WebSocket connected: user=%d", identity.UserID))
	defer common.SysLog(fmt.Sprintf("community WebSocket closed: user=%d", identity.UserID))
	done := make(chan struct{})
	conn.SetReadLimit(256)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	go func() {
		defer close(done)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
			return
		}
	}()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	var previous []byte
	for {
		// Revalidate on every history refresh; disabling chat, logout and bans close live sockets.
		config, e := model.GetCommunityConfig()
		if e != nil || !config.Enabled {
			return
		}
		if _, _, e = service.ValidateLoginSession(identity); e != nil {
			return
		}
		rows, e := model.RecentCommunityMessages()
		if e != nil {
			return
		}
		data, e = common.Marshal(gin.H{"type": "history", "messages": rows})
		if e != nil {
			return
		}
		if !bytes.Equal(previous, data) {
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if conn.WriteMessage(websocket.TextMessage, data) != nil {
				return
			}
			previous = data
		}
		if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
			return
		}
		select {
		case <-done:
			return
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
