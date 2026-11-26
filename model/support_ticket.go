package model

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SupportTicketSettings struct {
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
}

const ticketSettingsKey = "SupportTicketSettings"

func GetSupportTicketSettings() (SupportTicketSettings, error) {
	var settings SupportTicketSettings
	var option Option
	result := DB.Where(&Option{Key: ticketSettingsKey}).Limit(1).Find(&option)
	if result.Error != nil || result.RowsAffected == 0 {
		return settings, result.Error
	}
	err := common.UnmarshalJsonStr(option.Value, &settings)
	return settings, err
}

func SaveSupportTicketSettings(settings SupportTicketSettings) error {
	value, err := common.Marshal(settings)
	if err != nil {
		return err
	}
	return DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: ticketSettingsKey, Value: string(value)}).Error
}

type TicketStatus string

const (
	TicketAwaitingStaff TicketStatus = "awaiting_staff"
	TicketAwaitingUser  TicketStatus = "awaiting_user"
	TicketResolved      TicketStatus = "resolved"
	TicketClosed        TicketStatus = "closed"
)

func (status TicketStatus) Valid() bool {
	return status == TicketAwaitingStaff || status == TicketAwaitingUser || status == TicketResolved || status == TicketClosed
}

var ErrTicketClosed = errors.New("This ticket is closed.")

type SupportTicket struct {
	ID        int64        `json:"id" gorm:"primaryKey"`
	UserID    int          `json:"user_id" gorm:"not null;index"`
	Title     string       `json:"title" gorm:"type:varchar(120);not null"`
	Status    TicketStatus `json:"status" gorm:"type:varchar(20);not null;index"`
	CreatedAt int64        `json:"created_at"`
	UpdatedAt int64        `json:"updated_at" gorm:"index"`
}

type SupportTicketMessage struct {
	ID             int64  `json:"id" gorm:"primaryKey"`
	TicketID       int64  `json:"ticket_id" gorm:"not null;index"`
	AuthorID       int    `json:"author_id" gorm:"not null"`
	Staff          bool   `json:"staff"`
	Body           string `json:"body" gorm:"type:text;not null"`
	CreatedAt      int64  `json:"created_at"`
	NotifyAt       int64  `json:"-" gorm:"not null;index"`
	NotifyAttempts int    `json:"-" gorm:"not null"`
}

func visibleTickets(db *gorm.DB, userID int, staff bool) *gorm.DB {
	query := db.Model(&SupportTicket{})
	if !staff || userID <= 0 {
		return query.Where("user_id = ?", userID)
	}
	return query
}

func ListSupportTickets(userID int, staff bool, search string, status TicketStatus, offset, limit int) ([]SupportTicket, int64, error) {
	query := visibleTickets(DB, userID, staff)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if search != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(search)) + "%"
		if id, err := strconv.ParseInt(strings.TrimPrefix(search, "#"), 10, 64); err == nil && id > 0 {
			query = query.Where("(id = ? OR LOWER(title) LIKE ? ESCAPE '!')", id, pattern)
		} else {
			query = query.Where("LOWER(title) LIKE ? ESCAPE '!'", pattern)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []SupportTicket
	err := query.Order("updated_at DESC, id DESC").Limit(limit).Offset(offset).Find(&tickets).Error
	return tickets, total, err
}

func ReadSupportTicket(id int64, userID int, staff bool, before int64) (SupportTicket, []SupportTicketMessage, bool, error) {
	var ticket SupportTicket
	if err := visibleTickets(DB, userID, staff).First(&ticket, id).Error; err != nil {
		return ticket, nil, false, err
	}
	query := DB.Where("ticket_id = ?", id)
	if before > 0 {
		query = query.Where("id < ?", before)
	}
	const pageSize = 50
	var messages []SupportTicketMessage
	err := query.Order("id DESC").Limit(pageSize + 1).Find(&messages).Error
	return ticket, messages[:min(pageSize, len(messages))], len(messages) > pageSize, err
}

func OpenSupportTicket(userID int, title, body string) (SupportTicket, error) {
	ticket := SupportTicket{UserID: userID, Title: title, Status: TicketAwaitingStaff}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&ticket).Error; err != nil {
			return err
		}
		return tx.Create(&SupportTicketMessage{TicketID: ticket.ID, AuthorID: userID, Body: body, NotifyAt: ticket.CreatedAt}).Error
	})
	return ticket, err
}

func ReplyToSupportTicket(id int64, userID int, staff bool, body string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket SupportTicket
		if err := lockForUpdate(visibleTickets(tx, userID, staff)).First(&ticket, id).Error; err != nil {
			return err
		}
		if ticket.Status == TicketClosed {
			return ErrTicketClosed
		}
		message := SupportTicketMessage{TicketID: id, AuthorID: userID, Body: body, Staff: staff && ticket.UserID != userID}
		status := TicketAwaitingUser
		if !message.Staff {
			status = TicketAwaitingStaff
			message.NotifyAt = time.Now().Unix()
		}
		if err := tx.Create(&message).Error; err != nil {
			return err
		}
		return tx.Model(&ticket).Update("status", status).Error
	})
}

func SetSupportTicketStatus(id int64, status TicketStatus) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket SupportTicket
		if err := lockForUpdate(tx).First(&ticket, id).Error; err != nil {
			return err
		}
		return tx.Model(&ticket).Update("status", status).Error
	})
}
