package model

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrRegistrationInvitationInvalid = errors.New("registration invitation is invalid or unavailable")

// RegistrationInvitation verifies codes by digest and keeps an encrypted copy for root management.
type RegistrationInvitation struct {
	Id            int    `json:"id" gorm:"primaryKey"`
	CodeHash      string `json:"-" gorm:"type:varchar(64);not null;uniqueIndex"`
	CodePrefix    string `json:"code_prefix" gorm:"type:varchar(8);not null"`
	CodeEncrypted string `json:"-" gorm:"type:text"`
	Code          string `json:"code,omitempty" gorm:"-"`
	CreatedBy     int    `json:"created_by"`
	CreatedAt     int64  `json:"created_at"`
	ExpiresAt     int64  `json:"expires_at"`
	RevokedAt     int64  `json:"revoked_at"`
	UsedAt        int64  `json:"used_at"`
	UsedUserId    int    `json:"used_user_id" gorm:"index"`
	Username      string `json:"username" gorm:"-"`
}

func GenerateRegistrationInvitations(count, days, creatorID int) ([]string, error) {
	if count < 1 || count > 100 || days < 1 || days > 365 {
		return nil, errors.New("invalid invitation count or validity period")
	}
	aead, err := registrationInvitationAEAD()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	codes := make([]string, count)
	rows := make([]RegistrationInvitation, count)
	for i := range count {
		var random [32]byte
		if _, err := rand.Read(random[:]); err != nil {
			return nil, err
		}
		codes[i] = hex.EncodeToString(random[:])
		rows[i] = RegistrationInvitation{
			CodeHash: hex.EncodeToString(common.RegistrationInvitationHash(codes[i])), CodePrefix: codes[i][:8],
			CreatedBy: creatorID, CreatedAt: now.Unix(), ExpiresAt: now.Add(time.Duration(days) * 24 * time.Hour).Unix(),
		}
		rows[i].CodeEncrypted = base64.StdEncoding.EncodeToString(aead.Seal(nil, nil, []byte(codes[i]), []byte(rows[i].CodeHash)))
	}
	if err := DB.Create(&rows).Error; err != nil {
		return nil, err
	}
	return codes, nil
}

func ValidateRegistrationInvitation(hash []byte) error {
	if !common.IsRegistrationInvitationEnabled() {
		return nil
	}
	var count int64
	err := DB.Model(&RegistrationInvitation{}).
		Where("code_hash = ? AND used_user_id = 0 AND revoked_at = 0 AND expires_at > ?", hex.EncodeToString(hash), time.Now().Unix()).Count(&count).Error
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrRegistrationInvitationInvalid
	}
	return nil
}

// InsertWithRegistrationInvitation makes creation and one-time redemption atomic,
// including any provider binding written by the caller in the same transaction.
func (user *User) InsertWithRegistrationInvitation(tx *gorm.DB, inviterID int, hash []byte) error {
	if err := user.InsertWithTx(tx, inviterID); err != nil {
		return err
	}
	if !common.IsRegistrationInvitationEnabled() {
		return nil
	}
	now := time.Now().Unix()
	result := tx.Model(&RegistrationInvitation{}).
		Where("code_hash = ? AND used_user_id = 0 AND revoked_at = 0 AND expires_at > ?", hex.EncodeToString(hash), now).
		Updates(map[string]any{"used_user_id": user.Id, "used_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrRegistrationInvitationInvalid
	}
	return nil
}

func (user *User) RegisterWithInvitation(inviterID int, hash []byte) error {
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return user.InsertWithRegistrationInvitation(tx, inviterID, hash)
	}); err != nil {
		return err
	}
	user.FinishInsert(inviterID)
	return nil
}

func ListRegistrationInvitations(offset, limit int, code string) ([]RegistrationInvitation, int64, error) {
	query := DB.Model(&RegistrationInvitation{})
	if code != "" {
		query = query.Where("code_hash = ?", hex.EncodeToString(common.RegistrationInvitationHash(code)))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]RegistrationInvitation, 0)
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	aead, err := registrationInvitationAEAD()
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		// Legacy hashes cannot be reversed. A lost/rotated key must not prevent
		// listing, revoking, or deleting records either.
		if rows[i].CodeEncrypted == "" {
			continue
		}
		ciphertext, err := base64.StdEncoding.DecodeString(rows[i].CodeEncrypted)
		if err != nil {
			continue
		}
		plaintext, err := aead.Open(nil, nil, ciphertext, []byte(rows[i].CodeHash))
		if err == nil {
			rows[i].Code = string(plaintext)
		}
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		if row.UsedUserId != 0 {
			ids = append(ids, row.UsedUserId)
		}
	}
	if len(ids) > 0 {
		var users []User
		if err := DB.Unscoped().Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, 0, err
		}
		names := make(map[int]string, len(users))
		for _, user := range users {
			names[user.Id] = user.Username
		}
		for i := range rows {
			rows[i].Username = names[rows[i].UsedUserId]
		}
	}
	return rows, total, nil
}

func RevokeRegistrationInvitation(id int) error {
	result := DB.Model(&RegistrationInvitation{}).Where("id = ? AND used_user_id = 0 AND revoked_at = 0", id).
		Update("revoked_at", time.Now().Unix())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrRegistrationInvitationInvalid
	}
	return nil
}

// DeleteRegistrationInvitations removes only invitation records, including used,
// expired and revoked ones. Existing accounts are independent of these records.
func DeleteRegistrationInvitations(ids []int) (int64, error) {
	if len(ids) < 1 || len(ids) > 100 {
		return 0, errors.New("invalid invitation IDs")
	}
	for _, id := range ids {
		if id < 1 {
			return 0, errors.New("invalid invitation ID")
		}
	}
	result := DB.Where("id IN ?", ids).Delete(&RegistrationInvitation{})
	return result.RowsAffected, result.Error
}

func registrationInvitationAEAD() (cipher.AEAD, error) {
	// Use the host's persistent CRYPTO_SECRET (or SESSION_SECRET fallback).
	key := sha256.Sum256([]byte("new-api/registration-invitations/v1/" + common.CryptoSecret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}
