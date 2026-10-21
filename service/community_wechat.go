package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var communityWeChat = struct {
	sync.Mutex
	token, appID, secret string
	expires              time.Time
}{}
var communityWeChatClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// SendCommunityWeChat uses fixed official endpoints: administrators cannot supply a webhook URL.
// Template fields: sender, content, time. Receivers must follow the configured test account.
func SendCommunityWeChat(ctx context.Context, config model.CommunityConfig, message model.CommunityMessage) error {
	if !config.BotEnabled || config.AppID == "" || config.AppSecret == "" || config.TemplateID == "" || config.Receiver == "" {
		return errors.New("WeChat bot is not configured")
	}
	communityWeChat.Lock()
	defer communityWeChat.Unlock()
	if communityWeChat.appID != config.AppID || communityWeChat.secret != config.AppSecret || time.Now().After(communityWeChat.expires) {
		q := url.Values{"grant_type": {"client_credential"}, "appid": {config.AppID}, "secret": {config.AppSecret}}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com/cgi-bin/token?"+q.Encode(), nil)
		if err != nil {
			return errors.New("WeChat token request failed")
		}
		resp, err := communityWeChatClient.Do(req)
		if err != nil {
			return errors.New("WeChat is unavailable")
		}
		var result struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
			ErrCode     int    `json:"errcode"`
		}
		err = common.DecodeJson(io.LimitReader(resp.Body, 64<<10), &result)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || result.AccessToken == "" {
			return fmt.Errorf("WeChat token rejected (code %d)", result.ErrCode)
		}
		communityWeChat.token = result.AccessToken
		communityWeChat.appID = config.AppID
		communityWeChat.secret = config.AppSecret
		communityWeChat.expires = time.Now().Add(time.Duration(max(0, result.ExpiresIn-120)) * time.Second)
	}
	content := message.Text
	if message.Filename != "" {
		content += " [" + message.Filename + "]"
	}
	runes := []rune(content)
	if len(runes) > 500 {
		content = string(runes[:500]) + "…"
	}
	payload := map[string]any{"touser": config.Receiver, "template_id": config.TemplateID, "data": map[string]any{
		"sender": map[string]string{"value": message.Name}, "content": map[string]string{"value": content}, "time": map[string]string{"value": time.Unix(message.CreatedAt, 0).UTC().Format(time.RFC3339)}}}
	data, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.weixin.qq.com/cgi-bin/message/template/send?access_token="+url.QueryEscape(communityWeChat.token), bytes.NewReader(data))
	if err != nil {
		return errors.New("WeChat message request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := communityWeChatClient.Do(req)
	if err != nil {
		return errors.New("WeChat is unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		ErrCode int   `json:"errcode"`
		MsgID   int64 `json:"msgid"`
	}
	if err = common.DecodeJson(io.LimitReader(resp.Body, 64<<10), &result); err != nil || resp.StatusCode != 200 {
		return errors.New("Invalid WeChat response")
	}
	if result.ErrCode != 0 {
		if result.ErrCode == 40001 || result.ErrCode == 42001 {
			communityWeChat.expires = time.Time{}
		}
		return fmt.Errorf("WeChat message rejected (code %d)", result.ErrCode)
	}
	if result.MsgID == 0 {
		return errors.New("WeChat did not confirm delivery")
	}
	return nil
}
