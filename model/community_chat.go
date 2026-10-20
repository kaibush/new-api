package model

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CommunityConfig is separate from generic options so credentials never appear in option exports.
type CommunityConfig struct {
	ID            int    `json:"-" gorm:"primaryKey"`
	Name          string `json:"name" gorm:"type:varchar(80)"`
	Enabled       bool   `json:"enabled"`
	BotEnabled    bool   `json:"bot_enabled"`
	BotName       string `json:"bot_name" gorm:"type:varchar(32)"`
	AppID         string `json:"app_id" gorm:"type:varchar(128)"`
	AppSecret     string `json:"-" gorm:"type:text"`
	TemplateID    string `json:"template_id" gorm:"type:varchar(128)"`
	Receiver      string `json:"receiver" gorm:"type:varchar(128)"`
	CallbackToken string `json:"-" gorm:"type:text"`
}

type CommunityReply struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Text     string `json:"text"`
	Filename string `json:"filename"`
	Deleted  bool   `json:"deleted"`
}

type CommunityMessage struct {
	ReplyToID *int64          `json:"reply_to_id,omitempty"`
	Reply     *CommunityReply `json:"reply,omitempty" gorm:"-"`
	ID        int64           `json:"id" gorm:"primaryKey"`
	UserID    int             `json:"user_id" gorm:"index"`
	Name      string          `json:"name" gorm:"type:varchar(80)"`
	Avatar    string          `json:"avatar" gorm:"type:text"`
	Text      string          `json:"text" gorm:"type:text"`
	Kind      string          `json:"kind" gorm:"type:varchar(16)"`
	URL       string          `json:"url" gorm:"type:text"`
	Filename  string          `json:"filename" gorm:"type:varchar(255)"`
	Size      int64           `json:"size"`
	CreatedAt int64           `json:"created_at"`
	Deleted   bool            `json:"deleted"`
}

type CommunityProfile struct {
	UserID int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Avatar string `json:"avatar" gorm:"type:text"`
}

func GetCommunityConfig() (CommunityConfig, error) {
	config := CommunityConfig{ID: 1, BotName: "助手"}
	err := DB.First(&config, 1).Error
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
	aead, err := communitySecretAEAD()
	if err != nil {
		return err
	}
	for field, value := range map[string]*string{"app_secret": &config.AppSecret, "callback_token": &config.CallbackToken} {
		if *value != "" {
			*value = base64.RawStdEncoding.EncodeToString(aead.Seal(nil, nil, []byte(*value), []byte(field)))
		}
	}
	return DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&config).Error
}

func RecentCommunityMessages() ([]CommunityMessage, error) {
	rows := make([]CommunityMessage, 0, 50)
	err := DB.Order("id DESC").Limit(50).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0)
	for _, row := range rows {
		if row.ReplyToID != nil {
			ids = append(ids, *row.ReplyToID)
		}
	}
	if len(ids) > 0 {
		var replies []CommunityMessage
		if err = DB.Where("id IN ?", ids).Find(&replies).Error; err != nil {
			return nil, err
		}
		byID := make(map[int64]*CommunityReply, len(replies))
		for _, reply := range replies {
			preview := &CommunityReply{ID: reply.ID, Name: reply.Name, Deleted: reply.Deleted}
			if !reply.Deleted {
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
	slices.Reverse(rows)
	return rows, nil
}

var ErrCommunityReplyUnavailable = errors.New("Reply target is unavailable")

func ValidateCommunityReply(id *int64) error {
	if id == nil {
		return nil
	}
	if *id <= 0 {
		return ErrCommunityReplyUnavailable
	}
	var target CommunityMessage
	err := DB.First(&target, *id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || target.Deleted {
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
	return DB.Create(message).Error
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
