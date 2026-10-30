package model

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

var ErrRedPacketUnavailable = errors.New("Red packet is unavailable")
var ErrRedPacketCodes = errors.New("Use 1 to 100 distinct, unused redemption codes valid for at least 24 hours")

// A packet shares its ID with the chat message created in the same transaction.
type CommunityRedPacket struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement:false"`
	UserID      int    `json:"user_id" gorm:"index"`
	Name        string `json:"name" gorm:"type:varchar(80)"`
	Greeting    string `json:"greeting" gorm:"type:varchar(120)"`
	Total       int    `json:"total"`
	Claimed     int    `json:"claimed"`
	CreatedAt   int64  `json:"created_at"`
	ExpiresAt   int64  `json:"expires_at"`
	CompletedAt int64  `json:"completed_at" gorm:"-"`
}

type CommunityRedPacketItem struct {
	ID           int64  `json:"-" gorm:"primaryKey"`
	PacketID     int64  `json:"-" gorm:"uniqueIndex:idx_packet_recipient,priority:1"`
	RedemptionID int    `json:"-" gorm:"uniqueIndex"`
	UserID       *int   `json:"user_id" gorm:"uniqueIndex:idx_packet_recipient,priority:2"`
	Name         string `json:"name" gorm:"type:varchar(80)"`
	ClaimedAt    int64  `json:"claimed_at"`
}

type CommunityRedPacketDetail struct {
	CommunityRedPacket
	Deleted  bool                     `json:"deleted"`
	Records  []CommunityRedPacketItem `json:"records"`
	MyCode   string                   `json:"my_code,omitempty"`
	MyQuota  int                      `json:"my_quota,omitempty"`
	Redeemed bool                     `json:"redeemed"`
}

// This inventory is only returned by the administrator endpoint. Public packet
// details must continue to expose only the current recipient's code.
type CommunityRedPacketCode struct {
	Code       string `json:"code"`
	Quota      int    `json:"quota"`
	Status     string `json:"status"`
	UserID     *int   `json:"user_id"`
	Name       string `json:"name"`
	ClaimedAt  int64  `json:"claimed_at"`
	RedeemedAt int64  `json:"redeemed_at"`
	RedeemedBy int    `json:"redeemed_by"`
}

func GetCommunityRedPacketCodes(id int64, viewerID int) ([]CommunityRedPacketCode, error) {
	if id <= 0 || viewerID <= 0 {
		return nil, ErrRedPacketUnavailable
	}
	codes := []CommunityRedPacketCode{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Check the current account state, including role revocation, before
		// reading any codes. Do not rely on a role supplied by the client.
		var viewer User
		if err := tx.Select("id", "role", "status").First(&viewer, viewerID).Error; err != nil {
			return err
		}
		if viewer.Role < common.RoleAdminUser || viewer.Status != common.UserStatusEnabled {
			return ErrRedPacketUnavailable
		}
		var packet CommunityRedPacket
		if err := tx.First(&packet, id).Error; err != nil {
			return err
		}
		var items []CommunityRedPacketItem
		if err := tx.Where("packet_id = ?", id).Order("id").Find(&items).Error; err != nil {
			return err
		}
		ids := make([]int, 0, len(items))
		for _, item := range items {
			ids = append(ids, item.RedemptionID)
		}
		var redemptions []Redemption
		// Preserve the history of codes soft-deleted from redemption management.
		if err := tx.Unscoped().Where("id IN ?", ids).Find(&redemptions).Error; err != nil {
			return err
		}
		byID := make(map[int]Redemption, len(redemptions))
		for _, redemption := range redemptions {
			byID[redemption.Id] = redemption
		}
		now := time.Now().Unix()
		for _, item := range items {
			redemption, ok := byID[item.RedemptionID]
			if !ok {
				return ErrRedPacketUnavailable
			}
			status := "unclaimed"
			switch {
			case redemption.Status == common.RedemptionCodeStatusUsed:
				status = "redeemed"
			case redemption.DeletedAt.Valid:
				status = "deleted"
			case redemption.Status != common.RedemptionCodeStatusEnabled:
				status = "disabled"
			case redemption.ExpiredTime != 0 && redemption.ExpiredTime < now:
				status = "expired"
			case item.UserID != nil:
				status = "claimed"
			}
			codes = append(codes, CommunityRedPacketCode{
				Code: redemption.Key, Quota: redemption.Quota, Status: status,
				UserID: item.UserID, Name: item.Name, ClaimedAt: item.ClaimedAt,
				RedeemedAt: redemption.RedeemedTime, RedeemedBy: redemption.UsedUserId,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

func CreateCommunityRedPacket(userID int, greeting string, codes []string) (CommunityRedPacket, error) {
	packet := CommunityRedPacket{}
	greeting = strings.TrimSpace(greeting)
	if utf8.RuneCountInString(greeting) > 120 || len(codes) < 1 || len(codes) > 100 {
		return packet, ErrRedPacketCodes
	}
	seen := make(map[string]bool, len(codes))
	for _, code := range codes {
		if len(code) != 32 || seen[code] {
			return packet, ErrRedPacketCodes
		}
		seen[code] = true
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Acquire a write lock before reading on SQLite; also share the wallet
		// lock order with ordinary redemption (user, then redemption rows).
		if err := tx.Model(&User{}).Where("id = ?", userID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
			return err
		}
		var user User
		if err := tx.First(&user, userID).Error; err != nil {
			return err
		}
		if user.Role < common.RoleAdminUser || user.Status != common.UserStatusEnabled {
			return ErrRedPacketUnavailable
		}
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		now := time.Now().Unix()
		packet = CommunityRedPacket{UserID: userID, Name: name, Greeting: greeting, Total: len(codes), CreatedAt: now, ExpiresAt: now + 86400}
		var redemptions []Redemption
		// Lock in a stable order shared by concurrent publishers. Redeem locks the
		// same row, so publication cannot race a wallet credit.
		if err := lockForUpdate(tx).Where(map[string]any{"key": codes}).Order("id").Find(&redemptions).Error; err != nil {
			return err
		}
		if len(redemptions) != len(codes) {
			return ErrRedPacketCodes
		}
		for _, code := range redemptions {
			if code.Status != common.RedemptionCodeStatusEnabled || code.RedPacketID != nil || code.Quota <= 0 || common.ValidateWalletQuota(code.Quota) != nil || (code.ExpiredTime != 0 && code.ExpiredTime < packet.ExpiresAt) {
				return ErrRedPacketCodes
			}
		}
		message := CommunityMessage{UserID: userID, Name: name, Kind: "red_packet", Text: greeting, CreatedAt: now}
		var profile CommunityProfile
		if err := tx.Model(&CommunityProfile{}).Select("avatar").Where("user_id = ?", userID).Scan(&profile).Error; err != nil {
			return err
		}
		message.Avatar = profile.Avatar
		if err := tx.Create(&message).Error; err != nil {
			return err
		}
		packet.ID = message.ID
		if err := tx.Create(&packet).Error; err != nil {
			return err
		}
		for _, code := range redemptions {
			result := tx.Model(&Redemption{}).Where("id = ? AND status = ? AND red_packet_id IS NULL", code.Id, common.RedemptionCodeStatusEnabled).Update("red_packet_id", packet.ID)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrRedPacketCodes
			}
			if err := tx.Create(&CommunityRedPacketItem{PacketID: packet.ID, RedemptionID: code.Id}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return packet, err
}

func ListCommunityRedPackets(beforeID int64) ([]CommunityRedPacket, error) {
	packets := []CommunityRedPacket{}
	visibleMessages := DB.Model(&CommunityMessage{}).Select("id").Where("deleted = ?", false)
	query := DB.Where("id IN (?)", visibleMessages).Order("id DESC").Limit(30)
	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	if err := query.Find(&packets).Error; err != nil {
		return nil, err
	}
	completedIDs := make([]int64, 0, len(packets))
	for _, packet := range packets {
		if packet.Claimed >= packet.Total {
			completedIDs = append(completedIDs, packet.ID)
		}
	}
	if len(completedIDs) == 0 {
		return packets, nil
	}
	// Derive completion from existing claims, including packets sent before
	// retention was introduced. No codes or recipient details enter the list.
	var completed []struct {
		PacketID    int64
		CompletedAt int64
	}
	if err := DB.Model(&CommunityRedPacketItem{}).
		Select("packet_id, MAX(claimed_at) AS completed_at").
		Where("packet_id IN ? AND user_id IS NOT NULL", completedIDs).
		Group("packet_id").Scan(&completed).Error; err != nil {
		return nil, err
	}
	times := make(map[int64]int64, len(completed))
	for _, item := range completed {
		times[item.PacketID] = item.CompletedAt
	}
	for i := range packets {
		packets[i].CompletedAt = times[packets[i].ID]
	}
	return packets, nil
}

func GetCommunityRedPacket(id int64, userID int) (CommunityRedPacketDetail, error) {
	detail := CommunityRedPacketDetail{Records: []CommunityRedPacketItem{}}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&detail.CommunityRedPacket, id).Error; err != nil {
			return err
		}
		var message CommunityMessage
		if err := tx.First(&message, id).Error; err != nil {
			return err
		}
		detail.Deleted = message.Deleted
		if detail.Deleted {
			detail.Greeting = ""
		}
		if err := tx.Where("packet_id = ? AND user_id IS NOT NULL", id).Order("claimed_at, id").Find(&detail.Records).Error; err != nil {
			return err
		}
		// The public DTO never contains other recipients' codes or quota values.
		for _, item := range detail.Records {
			if detail.Claimed >= detail.Total {
				detail.CompletedAt = max(detail.CompletedAt, item.ClaimedAt)
			}
			if item.UserID == nil || *item.UserID != userID {
				continue
			}
			var code Redemption
			if err := tx.Unscoped().First(&code, item.RedemptionID).Error; err != nil {
				return err
			}
			detail.MyCode, detail.MyQuota = code.Key, code.Quota
			detail.Redeemed = code.Status == common.RedemptionCodeStatusUsed
		}
		return nil
	})
	return detail, err
}

func ClaimCommunityRedPacket(id int64, userID int) error {
	if userID <= 0 {
		return ErrRedPacketUnavailable
	}
	var credited Redemption
	err := userWalletTransaction(userID, func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return ErrRedPacketUnavailable
		}
		if err := tx.Model(&CommunityRedPacket{}).Where("id = ?", id).UpdateColumn("claimed", gorm.Expr("claimed")).Error; err != nil {
			return err
		}
		var packet CommunityRedPacket
		if err := lockForUpdate(tx).First(&packet, id).Error; err != nil {
			return err
		}
		var previous CommunityRedPacketItem
		err := tx.Where("packet_id = ? AND user_id = ?", id, userID).First(&previous).Error
		if err == nil {
			// Repeated claims never credit twice. Older claims that have not yet
			// been redeemed use the same credit path, even after packet expiry.
			var code Redemption
			if err := lockForUpdate(tx.Unscoped()).First(&code, previous.RedemptionID).Error; err != nil {
				return err
			}
			if code.Status == common.RedemptionCodeStatusUsed && code.UsedUserId == userID {
				return nil
			}
			if code.DeletedAt.Valid {
				return ErrRedPacketUnavailable
			}
			if err := redeemCodeToWallet(tx, &code, userID); err != nil {
				return err
			}
			credited = code
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now().Unix()
		if packet.ExpiresAt <= now || packet.Claimed >= packet.Total {
			return ErrRedPacketUnavailable
		}
		var message CommunityMessage
		if err := lockForUpdate(tx).First(&message, id).Error; err != nil {
			return err
		}
		if message.Deleted {
			return ErrRedPacketUnavailable
		}
		var item CommunityRedPacketItem
		if err := tx.Where("packet_id = ? AND user_id IS NULL", id).Order("id").First(&item).Error; err != nil {
			return err
		}
		var code Redemption
		if err := lockForUpdate(tx).First(&code, item.RedemptionID).Error; err != nil {
			return ErrRedPacketUnavailable
		}
		now = time.Now().Unix()
		if packet.ExpiresAt <= now {
			return ErrRedPacketUnavailable
		}
		if code.Status != common.RedemptionCodeStatusEnabled || (code.ExpiredTime != 0 && code.ExpiredTime < now) {
			return ErrRedPacketUnavailable
		}
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		result := tx.Model(&CommunityRedPacketItem{}).Where("id = ? AND user_id IS NULL", item.ID).Updates(map[string]any{"user_id": userID, "name": name, "claimed_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrRedPacketUnavailable
		}
		result = tx.Model(&CommunityRedPacket{}).Where("id = ? AND claimed = ?", id, packet.Claimed).Update("claimed", packet.Claimed+1)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrRedPacketUnavailable
		}
		if err := redeemCodeToWallet(tx, &code, userID); err != nil {
			return err
		}
		credited = code
		return nil
	})
	if err != nil {
		return err
	}
	if credited.Id != 0 {
		syncCreditUserQuotaCache(userID, credited.Quota, "red packet")
		RecordLog(userID, LogTypeTopup, fmt.Sprintf("通过红包充值 %s，红包ID %d，兑换码ID %d", logger.LogQuota(credited.Quota), id, credited.Id))
	}
	return nil
}
