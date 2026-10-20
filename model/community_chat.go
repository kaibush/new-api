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
	Enabled       bool   `json:"enabled"`
	BotEnabled    bool   `json:"bot_enabled"`
	BotName       string `json:"bot_name" gorm:"type:varchar(32)"`
	AppID         string `json:"app_id" gorm:"type:varchar(128)"`
	AppSecret     string `json:"-" gorm:"type:text"`
	TemplateID    string `json:"template_id" gorm:"type:varchar(128)"`
	Receiver      string `json:"receiver" gorm:"type:varchar(128)"`
	CallbackToken string `json:"-" gorm:"type:text"`
}

type CommunityMessage struct {
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
	slices.Reverse(rows)
	return rows, err
}

func CreateCommunityMessage(userID int, message *CommunityMessage) error {
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
