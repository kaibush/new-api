package model

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrCommunityEventInput = errors.New("Enter a title, an event type, and a future time range")
var ErrCommunityEventUnavailable = errors.New("Event is unavailable")

type CommunityEventInput struct {
	Title       string `json:"title" gorm:"type:varchar(80)"`
	Description string `json:"description" gorm:"type:text"`
	Kind        string `json:"kind" gorm:"type:varchar(16)"`
	StartsAt    int64  `json:"starts_at" gorm:"index"`
	EndsAt      int64  `json:"ends_at" gorm:"index"`
}

// Events and their announcement messages share an ID and are created atomically.
type CommunityEvent struct {
	CommunityEventInput
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement:false"`
	UserID    int    `json:"user_id"`
	Name      string `json:"name" gorm:"type:varchar(80)"`
	CreatedAt int64  `json:"created_at"`
	Cancelled bool   `json:"cancelled"`
}

func CreateCommunityEvent(userID int, input CommunityEventInput) (CommunityEvent, error) {
	event := CommunityEvent{}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	now := time.Now().Unix()
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 80 || utf8.RuneCountInString(input.Description) > 2000 ||
		(input.Kind != "event" && input.Kind != "red_packet") || input.StartsAt <= now || input.StartsAt > now+366*86400 || input.EndsAt <= input.StartsAt || input.EndsAt > now+397*86400 {
		return event, ErrCommunityEventInput
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.First(&user, userID).Error; err != nil {
			return err
		}
		if user.Role < common.RoleAdminUser || user.Status != common.UserStatusEnabled {
			return ErrCommunityEventUnavailable
		}
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		var profile CommunityProfile
		if err := tx.Model(&CommunityProfile{}).Select("avatar").Where("user_id = ?", userID).Scan(&profile).Error; err != nil {
			return err
		}
		message := CommunityMessage{UserID: userID, Name: name, Avatar: profile.Avatar, Kind: "event", Text: input.Title, CreatedAt: now}
		if err := tx.Create(&message).Error; err != nil {
			return err
		}
		event = CommunityEvent{CommunityEventInput: input, ID: message.ID, UserID: userID, Name: name, CreatedAt: now}
		return tx.Create(&event).Error
	})
	return event, err
}

func ListCommunityEvents() ([]CommunityEvent, error) {
	events := []CommunityEvent{}
	visible := DB.Model(&CommunityMessage{}).Select("id").Where("deleted = ?", false).
		Where("id > COALESCE((?), 0)", DB.Model(&CommunityConfig{}).Select("cleared_through_id").Where("id = ?", 1))
	err := DB.Where("id IN (?) AND cancelled = ? AND ends_at > ?", visible, false, time.Now().Unix()).
		Order("starts_at, id").Limit(50).Find(&events).Error
	return events, err
}

func GetCommunityEvent(id int64) (CommunityEvent, error) {
	event := CommunityEvent{}
	visible := DB.Model(&CommunityMessage{}).Select("id").Where("deleted = ?", false).
		Where("id > COALESCE((?), 0)", DB.Model(&CommunityConfig{}).Select("cleared_through_id").Where("id = ?", 1))
	err := DB.Where("id IN (?)", visible).First(&event, id).Error
	return event, err
}

func CancelCommunityEvent(id int64) error {
	result := DB.Model(&CommunityEvent{}).Where("id = ?", id).Update("cancelled", true)
	if result.Error != nil {
		return result.Error
	}
	// MySQL reports zero changed rows on an idempotent retry.
	if result.RowsAffected == 0 {
		var event CommunityEvent
		return DB.First(&event, id).Error
	}
	return nil
}
