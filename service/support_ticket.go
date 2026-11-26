package service

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func RunTicketNotifications(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if err := DeliverTicketNotifications(ctx); err != nil && ctx.Err() == nil {
			common.SysError("ticket notification worker: " + err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func DeliverTicketNotifications(ctx context.Context) error {
	db := model.DB.WithContext(ctx)
	var pending []model.SupportTicketMessage
	if err := db.Select("id", "ticket_id", "created_at", "notify_at", "notify_attempts").Where("notify_at > 0 AND notify_at <= ?", time.Now().Unix()).Order("notify_at, id").Limit(20).Find(&pending).Error; err != nil || len(pending) == 0 {
		return err
	}
	settings, err := model.GetSupportTicketSettings()
	if err != nil {
		return err
	}
	config, err := model.GetCommunityConfig()
	if err != nil {
		return err
	}
	common.OptionMapRWMutex.RLock()
	serverAddress := system_setting.ServerAddress
	common.OptionMapRWMutex.RUnlock()
	for _, item := range pending {
		lease := time.Now().Add(time.Minute).Unix()
		claim := db.Model(&model.SupportTicketMessage{}).Where("id = ? AND notify_at = ?", item.ID, item.NotifyAt).Update("notify_at", lease)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected == 0 {
			continue
		}
		next := int64(0)
		if settings.Enabled && config.BotEnabled && config.AppID != "" && config.AppSecret != "" && config.TemplateID != "" && config.Receiver != "" {
			target := ""
			if base, err := url.Parse(serverAddress); err == nil && base.Scheme == "https" && base.Hostname() != "" && base.User == nil {
				base.Path = strings.TrimRight(base.Path, "/") + "/tickets"
				base.RawQuery = url.Values{"ticket": {strconv.FormatInt(item.TicketID, 10)}}.Encode()
				base.Fragment = ""
				target = base.String()
			}
			name := settings.Name
			if name == "" {
				name = "工单"
			}
			message := model.CommunityMessage{Name: config.BotName, Text: fmt.Sprintf("%s #%d 有新的用户消息，请登录查看并回复。", name, item.TicketID), CreatedAt: item.CreatedAt}
			sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			err := sendWeChatTemplate(sendCtx, config, message, target)
			cancel()
			if err != nil {
				common.SysError(fmt.Sprintf("ticket WeChat notification failed: ticket=%d message=%d attempt=%d: %s", item.TicketID, item.ID, item.NotifyAttempts+1, err))
				next = time.Now().Add(time.Minute << min(item.NotifyAttempts, 6)).Unix()
			}
		}
		if err := db.Model(&model.SupportTicketMessage{}).Where("id = ? AND notify_at = ?", item.ID, lease).Updates(map[string]any{"notify_at": next, "notify_attempts": item.NotifyAttempts + 1}).Error; err != nil {
			return err
		}
	}
	return nil
}
