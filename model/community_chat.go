package model

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CommunityConfig is separate from generic options so credentials never appear in option exports.
type CommunityConfig struct {
	ClearedThroughID          int64  `json:"-"`
	ID                        int    `json:"-" gorm:"primaryKey"`
	Name                      string `json:"name" gorm:"type:varchar(80)"`
	Enabled                   bool   `json:"enabled"`
	HistoryDays               int    `json:"history_days"`
	RedPacketRetentionMinutes *int   `json:"red_packet_retention_minutes"`
	BotEnabled                bool   `json:"bot_enabled"`
	BotName                   string `json:"bot_name" gorm:"type:varchar(32)"`
	BotReply                  string `json:"bot_reply" gorm:"type:text"`
	AppID                     string `json:"app_id" gorm:"type:varchar(128)"`
	AppSecret                 string `json:"-" gorm:"type:text"`
	TemplateID                string `json:"template_id" gorm:"type:varchar(128)"`
	Receiver                  string `json:"receiver" gorm:"type:varchar(128)"`
	CallbackToken             string `json:"-" gorm:"type:text"`
}

type CommunityReply struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Text      string `json:"text"`
	Filename  string `json:"filename"`
	Deleted   bool   `json:"deleted"`
	ExpiresAt int64  `json:"expires_at,omitempty"`
}

type CommunityMessage struct {
	Event     *CommunityEvent `json:"event,omitempty" gorm:"-"`
	Cleared   bool            `json:"cleared,omitempty" gorm:"-"`
	Replayed  bool            `json:"-" gorm:"-"`
	ClientID  *string         `json:"client_id,omitempty" gorm:"type:varchar(36);uniqueIndex:idx_community_sender_request,priority:2"`
	IsBot     bool            `json:"is_bot"`
	ReplyToID *int64          `json:"reply_to_id,omitempty"`
	Reply     *CommunityReply `json:"reply,omitempty" gorm:"-"`
	ID        int64           `json:"id" gorm:"primaryKey"`
	UserID    int             `json:"user_id" gorm:"index;uniqueIndex:idx_community_sender_request,priority:1"`
	Name      string          `json:"name" gorm:"type:varchar(80)"`
	Avatar    string          `json:"avatar" gorm:"type:text"`
	Text      string          `json:"text" gorm:"type:text"`
	Kind      string          `json:"kind" gorm:"type:varchar(16)"`
	URL       string          `json:"url" gorm:"type:text"`
	Filename  string          `json:"filename" gorm:"type:varchar(255)"`
	Size      int64           `json:"size"`
	CreatedAt int64           `json:"created_at" gorm:"index"`
	Deleted   bool            `json:"deleted"`
	ExpiresAt int64           `json:"expires_at,omitempty" gorm:"-"`
}

// Snapshots preserve the feedback history when chat messages are moderated.
type CommunityBotFeedback struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	MessageID int64  `json:"message_id" gorm:"uniqueIndex"`
	ReplyID   int64  `json:"reply_id"`
	UserID    int    `json:"user_id" gorm:"index"`
	Name      string `json:"name" gorm:"type:varchar(80)"`
	Text      string `json:"text" gorm:"type:text"`
	Filename  string `json:"filename" gorm:"type:varchar(255)"`
	BotName   string `json:"bot_name" gorm:"type:varchar(32)"`
	ReplyText string `json:"reply_text" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

const DefaultCommunityBotReply = "已收到你的消息，管理员会尽快回复。"

type CommunityProfile struct {
	UserID int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Avatar string `json:"avatar" gorm:"type:text"`
}

func GetCommunityConfig() (CommunityConfig, error) {
	config := CommunityConfig{ID: 1, BotName: "助手", BotReply: DefaultCommunityBotReply}
	err := DB.First(&config, 1).Error
	if strings.TrimSpace(config.BotReply) == "" {
		config.BotReply = DefaultCommunityBotReply
	}
	if config.HistoryDays == 0 {
		config.HistoryDays = 1
	}
	if config.RedPacketRetentionMinutes == nil {
		config.RedPacketRetentionMinutes = new(10)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return config, nil
	}
	if err != nil {
		return config, err
	}
	aead, err := communitySecretAEAD()
	if err != nil {
		return config, err
	}
	for field, value := range map[string]*string{"app_secret": &config.AppSecret, "callback_token": &config.CallbackToken} {
		if *value == "" {
			continue
		}
		ciphertext, e := base64.RawStdEncoding.DecodeString(*value)
		if e != nil {
			return config, errors.New("Invalid community credential encryption")
		}
		plaintext, e := aead.Open(nil, nil, ciphertext, []byte(field))
		if e != nil {
			return config, errors.New("Could not decrypt community credentials")
		}
		*value = string(plaintext)
	}
	return config, nil
}

func SaveCommunityConfig(config CommunityConfig) error {
	config.ID = 1
	if config.RedPacketRetentionMinutes == nil {
		config.RedPacketRetentionMinutes = new(10)
	}
	if *config.RedPacketRetentionMinutes < 0 || *config.RedPacketRetentionMinutes > 1440 {
		return errors.New("Red packet retention must be between 0 and 1440 minutes")
	}
	if config.HistoryDays == 0 {
		config.HistoryDays = 1
	}
	if config.HistoryDays < 1 || config.HistoryDays > 365 {
		return errors.New("Chat history must be between 1 and 365 days")
	}
	aead, err := communitySecretAEAD()
	if err != nil {
		return err
	}
	for field, value := range map[string]*string{"app_secret": &config.AppSecret, "callback_token": &config.CallbackToken} {
		if *value != "" {
			*value = base64.RawStdEncoding.EncodeToString(aead.Seal(nil, nil, []byte(*value), []byte(field)))
		}
	}
	// Settings saves must never reset a concurrently updated moderation boundary.
	return DB.Omit("cleared_through_id").Clauses(clause.OnConflict{UpdateAll: true}).Create(&config).Error
}

type CommunityHistory struct {
	ClearedThroughID int64              `json:"cleared_through_id"`
	Items            []CommunityMessage `json:"items"`
	HasMore          bool               `json:"has_more"`
	DayStart         int64              `json:"day_start"`
	DayEnd           int64              `json:"day_end"`
	HistoryDays      int                `json:"history_days"`
	DeletedIDs       []int64            `json:"deleted_ids"`
}

func RecentCommunityMessages() ([]CommunityMessage, error) {
	page, err := CommunityMessageHistory(0, 50, false)
	return page.Items, err
}

// RedactDeletedContent must run before returning messages to public chat clients.
func (message *CommunityMessage) RedactDeletedContent() {
	if message.Reply != nil && message.Reply.Deleted {
		message.Reply.Text, message.Reply.Filename = "", ""
	}
	if !message.Deleted && !message.Cleared {
		return
	}
	message.Text, message.URL, message.Filename, message.Size = "", "", "", 0
	message.ReplyToID, message.Reply = nil, nil
	message.Event = nil
}

// CommunityMessageHistory uses a stable ID cursor. Only the administrator route
// may request the archive, which includes previous days and moderated content.
func CommunityMessageHistory(beforeID int64, limit int, archive bool) (CommunityHistory, error) {
	config, err := GetCommunityConfig()
	if err != nil {
		return CommunityHistory{}, err
	}
	now := time.Now()
	start, end := config.HistoryBounds(now)
	page := CommunityHistory{Items: make([]CommunityMessage, 0, limit+1), DayStart: start.Unix(), DayEnd: end.Unix(), HistoryDays: config.HistoryDays, DeletedIDs: []int64{}, ClearedThroughID: config.ClearedThroughID}
	query := DB.Order("id DESC").Limit(limit + 1)
	if !archive {
		query = query.Where("id > ? AND created_at >= ? AND created_at < ?", config.ClearedThroughID, page.DayStart, page.DayEnd)
	}
	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	if err := query.Find(&page.Items).Error; err != nil {
		return page, err
	}
	eventIDs := []int64{}
	for _, message := range page.Items {
		if message.Kind == "event" && (!message.Deleted || archive) {
			eventIDs = append(eventIDs, message.ID)
		}
	}
	if len(eventIDs) > 0 {
		var events []CommunityEvent
		if err := DB.Where("id IN ?", eventIDs).Find(&events).Error; err != nil {
			return page, err
		}
		byID := make(map[int64]*CommunityEvent, len(events))
		for i := range events {
			byID[events[i].ID] = &events[i]
		}
		for i := range page.Items {
			page.Items[i].Event = byID[page.Items[i].ID]
		}
	}
	page.HasMore = len(page.Items) > limit
	if page.HasMore {
		page.Items = page.Items[:limit]
	}
	if !archive {
		// Synchronize moderation even for older pages already loaded by a client.
		if err := DB.Model(&CommunityMessage{}).Where("id > ? AND created_at >= ? AND created_at < ? AND deleted = ?", config.ClearedThroughID, page.DayStart, page.DayEnd, true).Order("id").Pluck("id", &page.DeletedIDs).Error; err != nil {
			return page, err
		}
		for i := range page.Items {
			page.Items[i].RedactDeletedContent()
			page.Items[i].ExpiresAt = communityMessageExpiry(page.Items[i].CreatedAt, config.HistoryDays)
		}
	}
	for i := range page.Items {
		page.Items[i].Cleared = page.Items[i].ID <= config.ClearedThroughID
	}
	replyStart := int64(0)
	if !archive {
		replyStart = page.DayStart
	}
	if err := loadCommunityReplies(page.Items, archive, replyStart, page.DayEnd, config.HistoryDays, config.ClearedThroughID); err != nil {
		return page, err
	}
	slices.Reverse(page.Items)
	return page, nil
}

func loadCommunityReplies(rows []CommunityMessage, includeDeleted bool, dayStart, dayEnd int64, historyDays int, clearedThroughID int64) error {
	ids := make([]int64, 0)
	for _, row := range rows {
		if row.ReplyToID != nil {
			ids = append(ids, *row.ReplyToID)
		}
	}
	if len(ids) > 0 {
		var replies []CommunityMessage
		query := DB.Where("id IN ?", ids)
		if !includeDeleted {
			query = query.Where("id > ? AND created_at >= ? AND created_at < ?", clearedThroughID, dayStart, dayEnd)
		}
		if err := query.Find(&replies).Error; err != nil {
			return err
		}
		byID := make(map[int64]*CommunityReply, len(replies))
		for _, reply := range replies {
			preview := &CommunityReply{ID: reply.ID, Name: reply.Name, Deleted: reply.Deleted}
			if !includeDeleted {
				preview.ExpiresAt = communityMessageExpiry(reply.CreatedAt, historyDays)
			}
			if includeDeleted || !reply.Deleted {
				preview.Text = reply.Text
				preview.Filename = reply.Filename
			}
			byID[reply.ID] = preview
		}
		for i := range rows {
			if rows[i].ReplyToID != nil {
				rows[i].Reply = byID[*rows[i].ReplyToID]
			}
		}
	}
	return nil
}

var ErrCommunityReplyUnavailable = errors.New("Reply target is unavailable")

// HistoryBounds includes today and the configured preceding calendar days in the site time zone.
func (config CommunityConfig) HistoryBounds(now time.Time) (time.Time, time.Time) {
	days := max(1, config.HistoryDays)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return today.AddDate(0, 0, 1-days), today.AddDate(0, 0, 1)
}

func communityMessageExpiry(createdAt int64, historyDays int) int64 {
	created := time.Unix(createdAt, 0).In(time.Local)
	return time.Date(created.Year(), created.Month(), created.Day()+max(1, historyDays), 0, 0, 0, 0, created.Location()).Unix()
}

func ValidateCommunityReply(id *int64) error {
	if id == nil {
		return nil
	}
	if *id <= 0 {
		return ErrCommunityReplyUnavailable
	}
	config, err := GetCommunityConfig()
	if err != nil {
		return err
	}
	var target CommunityMessage
	err = DB.First(&target, *id).Error
	start, end := config.HistoryBounds(time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) || target.Deleted || target.ID <= config.ClearedThroughID || target.CreatedAt < start.Unix() || target.CreatedAt >= end.Unix() {
		return ErrCommunityReplyUnavailable
	}
	return err
}

func CreateCommunityMessage(userID int, message *CommunityMessage) error {
	if err := ValidateCommunityReply(message.ReplyToID); err != nil {
		return err
	}
	user, err := GetUserById(userID, false)
	if err != nil {
		return err
	}
	message.UserID = userID
	message.Name = user.DisplayName
	if message.Name == "" {
		message.Name = user.Username
	}
	var profile CommunityProfile
	err = DB.First(&profile, "user_id = ?", userID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	message.Avatar = profile.Avatar
	message.CreatedAt = time.Now().Unix()
	config, err := GetCommunityConfig()
	if err != nil {
		return err
	}
	message.ExpiresAt = communityMessageExpiry(message.CreatedAt, config.HistoryDays)
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "client_id"}}, DoNothing: true}).Create(message)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			if err := tx.Where("user_id = ? AND client_id = ?", userID, message.ClientID).First(message).Error; err != nil {
				return err
			}
			message.Replayed = true
			message.Cleared = message.ID <= config.ClearedThroughID
			message.ExpiresAt = communityMessageExpiry(message.CreatedAt, config.HistoryDays)
			return nil
		}
		if message.ReplyToID != nil {
			var target CommunityMessage
			if err := tx.First(&target, *message.ReplyToID).Error; err != nil {
				return err
			}
			message.Reply = &CommunityReply{ID: target.ID, Name: target.Name, Text: target.Text, Filename: target.Filename, Deleted: target.Deleted, ExpiresAt: communityMessageExpiry(target.CreatedAt, config.HistoryDays)}
		}
		if !config.Enabled || !config.BotEnabled || !CommunityMentionsBot(message.Text, config.BotName) {
			return nil
		}
		name := strings.NewReplacer("]", "", "\r", "", "\n", "").Replace(message.Name)
		reply := CommunityMessage{
			IsBot: true, Name: config.BotName, Kind: "text", ReplyToID: &message.ID,
			Text: fmt.Sprintf("@[%s](user:%d) %s", name, userID, config.BotReply), CreatedAt: message.CreatedAt,
		}
		if err := tx.Create(&reply).Error; err != nil {
			return err
		}
		feedback := CommunityBotFeedback{
			MessageID: message.ID, ReplyID: reply.ID, UserID: userID, Name: message.Name,
			Text: message.Text, Filename: message.Filename, BotName: config.BotName,
			ReplyText: reply.Text, CreatedAt: message.CreatedAt,
		}
		return tx.Create(&feedback).Error
	})
}

func CommunityMentionsBot(text, name string) bool {
	if name == "" {
		return false
	}
	for _, part := range strings.Fields(text) {
		if strings.TrimRight(part, "，。！？,!?;；:") == "@"+name {
			return true
		}
	}
	return false
}

func ListCommunityBotFeedback(offset, limit int) ([]CommunityBotFeedback, int64, error) {
	rows := make([]CommunityBotFeedback, 0, limit)
	var total int64
	if err := DB.Model(&CommunityBotFeedback{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := DB.Order("id DESC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}

func communitySecretAEAD() (cipher.AEAD, error) {
	key := sha256.Sum256([]byte("new-api/community-credentials/" + common.CryptoSecret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}

// CommunityMember exposes only the public identity of a connected chat user.
type CommunityMember struct {
	UserID int    `json:"user_id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

func GetCommunityMembers(ids []int) ([]CommunityMember, error) {
	members := make([]CommunityMember, 0, len(ids))
	if len(ids) == 0 {
		return members, nil
	}
	var users []User
	if err := DB.Select("id", "username", "display_name").Where("id IN ? AND status = ?", ids, common.UserStatusEnabled).Order("id").Find(&users).Error; err != nil {
		return nil, err
	}
	var profiles []CommunityProfile
	if err := DB.Where("user_id IN ?", ids).Find(&profiles).Error; err != nil {
		return nil, err
	}
	avatars := make(map[int]string, len(profiles))
	for _, profile := range profiles {
		avatars[profile.UserID] = profile.Avatar
	}
	for _, user := range users {
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		members = append(members, CommunityMember{UserID: user.Id, Name: name, Avatar: avatars[user.Id]})
	}
	return members, nil
}

// ClearCommunityMessages advances a persisted boundary while retaining the archive.
// The row lock serializes concurrent clears; messages with newer IDs remain
// visible. No message IDs or attachment objects are deleted or reused.
func ClearCommunityMessages() (int64, int64, error) {
	var throughID, count int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		config := CommunityConfig{ID: 1, HistoryDays: 1, BotName: "助手", BotReply: DefaultCommunityBotReply}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&config).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&config, 1).Error; err != nil {
			return err
		}
		throughID = config.ClearedThroughID
		var latest CommunityMessage
		err := tx.Order("id DESC").First(&latest).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if latest.ID <= throughID {
			return nil
		}
		if err := tx.Model(&CommunityMessage{}).Where("id > ? AND id <= ?", throughID, latest.ID).Count(&count).Error; err != nil {
			return err
		}
		throughID = latest.ID
		return tx.Model(&CommunityConfig{}).Where("id = ?", 1).Update("cleared_through_id", throughID).Error
	})
	return throughID, count, err
}
