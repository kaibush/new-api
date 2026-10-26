package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// CheckinGrant is an isolated, expiring balance. It is never added to users.quota.
// Expiry is enforced by queries, so it does not depend on a worker or cache TTL.
type CheckinGrant struct {
	CheckinID int   `gorm:"primaryKey;autoIncrement:false" json:"checkin_id"`
	UserID    int   `gorm:"not null;index:idx_checkin_grant_expiry,priority:1" json:"-"`
	Quota     int   `gorm:"not null" json:"quota"`
	Remaining int   `gorm:"not null" json:"-"`
	Reserved  int   `gorm:"not null" json:"reserved"`
	Used      int   `gorm:"not null" json:"used"`
	CreatedAt int64 `gorm:"not null" json:"created_at"`
	ExpiresAt int64 `gorm:"not null;index:idx_checkin_grant_expiry,priority:2" json:"expires_at"`
}

// CheckinFunding records absolute charges and their original funding sources.
// The same receipt survives retries, task polling, expiry and configuration changes.
type CheckinFunding struct {
	ID          int64  `gorm:"primaryKey"`
	UserID      int    `gorm:"not null;uniqueIndex:idx_checkin_funding_source"`
	SourceKey   string `gorm:"type:varchar(64);not null;uniqueIndex:idx_checkin_funding_source"`
	Quota       int    `gorm:"not null"`
	WalletQuota int    `gorm:"not null"`
	Settled     bool   `gorm:"not null"`
	Allocations string `gorm:"type:text;not null"`
}

type checkinAllocation struct {
	GrantID int `json:"grant_id"`
	Quota   int `json:"quota"`
}

type CheckinGrantStatus struct {
	CheckinGrant
	Available int `json:"available"`
	Expired   int `json:"expired"`
}

type CheckinGrantSummary struct {
	Available int64                `json:"available"`
	Reserved  int64                `json:"reserved"`
	Used      int64                `json:"used"`
	Expired   int64                `json:"expired"`
	AsOf      int64                `json:"as_of"`
	Records   []CheckinGrantStatus `json:"records" gorm:"-"`
}

type CheckinBalances struct {
	WalletQuota  int   `json:"wallet_quota"`
	CheckinQuota int64 `json:"checkin_quota"`
}

// Existing activity gifts remain in the wallet ledger, but are separated for
// display. Unclassified historical funds are never guessed to be check-in gifts.
func GetCheckinBalances(userID int) (*CheckinBalances, error) {
	wallet, err := GetUserQuota(userID, false)
	if err != nil {
		return nil, err
	}
	var account CheckinAccount
	if err := DB.Where("user_id = ?", userID).Find(&account).Error; err != nil {
		return nil, err
	}
	legacyGift := min(max(account.GiftRemaining, 0), int64(max(wallet, 0)))
	var expiring int64
	if err := DB.Model(&CheckinGrant{}).Where("user_id = ? AND expires_at > ?", userID, time.Now().Unix()).Select("COALESCE(SUM(remaining), 0)").Scan(&expiring).Error; err != nil {
		return nil, err
	}
	return &CheckinBalances{WalletQuota: wallet - int(legacyGift), CheckinQuota: legacyGift + expiring}, nil
}

func GetCheckinGrants(userID int) (*CheckinGrantSummary, error) {
	result := &CheckinGrantSummary{AsOf: time.Now().Unix(), Records: []CheckinGrantStatus{}}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&CheckinGrant{}).Where("user_id = ?", userID).
			Select("COALESCE(SUM(CASE WHEN expires_at > ? THEN remaining ELSE 0 END), 0) AS available, COALESCE(SUM(CASE WHEN expires_at <= ? THEN remaining ELSE 0 END), 0) AS expired, COALESCE(SUM(reserved), 0) AS reserved, COALESCE(SUM(used), 0) AS used", result.AsOf, result.AsOf).
			Scan(result).Error; err != nil {
			return err
		}
		var grants []CheckinGrant
		if err := tx.Where("user_id = ?", userID).Order("created_at DESC, checkin_id DESC").Limit(100).Find(&grants).Error; err != nil {
			return err
		}
		for _, grant := range grants {
			status := CheckinGrantStatus{CheckinGrant: grant}
			if grant.ExpiresAt > result.AsOf {
				status.Available = grant.Remaining
			} else {
				status.Expired = grant.Remaining
			}
			result.Records = append(result.Records, status)
		}
		return nil
	})
	return result, err
}

// CheckinFundingBalance returns spendable quota and whether the isolated ledger
// must be used. Once a user has grants, even expired ones, refunds keep that path.
func CheckinFundingBalance(userID int) (quota int, isolated bool, err error) {
	quota, err = GetUserQuota(userID, false)
	if err != nil {
		return
	}
	var balance struct {
		Count     int64
		Available int64
	}
	err = DB.Model(&CheckinGrant{}).Where("user_id = ?", userID).
		Select("COUNT(*) AS count, COALESCE(SUM(CASE WHEN expires_at > ? THEN remaining ELSE 0 END), 0) AS available", time.Now().Unix()).Scan(&balance).Error
	if err != nil {
		return
	}
	isolated = balance.Count > 0
	// Display/preflight arithmetic stays within the wallet's JS-safe bound.
	quota = int(min(int64(common.MaxWalletQuota), int64(quota)+balance.Available))
	return
}

var ErrCheckinFundingInsufficient = errors.New("wallet quota insufficient")

func GetCheckinFunding(userID int, source string) (*CheckinFunding, error) {
	hash := sha256.Sum256([]byte(source))
	var receipt CheckinFunding
	result := DB.Where("user_id = ? AND source_key = ?", userID, hex.EncodeToString(hash[:])).Find(&receipt)
	if result.Error != nil || result.RowsAffected == 0 {
		return nil, result.Error
	}
	return &receipt, nil
}

// SetCheckinFunding atomically changes an absolute charge. Reservations require
// sufficient funds; final charges may use wallet debt, like ordinary settlement.
// Refunds return wallet funds first, then the exact gift batches, retaining expiry.
func SetCheckinFunding(userID int, source string, quota int, reserve, settled bool) error {
	if userID <= 0 || source == "" || quota < 0 || quota > common.MaxQuota {
		return errors.New("invalid check-in funding charge")
	}
	hash := sha256.Sum256([]byte(source))
	var walletDelta int
	var cachedReservation int
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := checkinAccount(tx, userID, time.Now()); err != nil {
			return err
		}
		var receipt CheckinFunding
		if err := tx.Where("user_id = ? AND source_key = ?", userID, hex.EncodeToString(hash[:])).Find(&receipt).Error; err != nil {
			return err
		}
		old := []checkinAllocation{}
		if receipt.Allocations != "" {
			if err := common.UnmarshalJsonStr(receipt.Allocations, &old); err != nil {
				return err
			}
		}
		next := append([]checkinAllocation{}, old...)
		wallet := receipt.WalletQuota
		delta := quota - receipt.Quota
		if delta > 0 {
			var grants []CheckinGrant
			if err := tx.Where("user_id = ? AND expires_at > ? AND remaining > 0", userID, time.Now().Unix()).Order("expires_at, checkin_id").Find(&grants).Error; err != nil {
				return err
			}
			for _, grant := range grants {
				amount := min(delta, grant.Remaining)
				if amount == 0 {
					break
				}
				index := -1
				for i := range next {
					if next[i].GrantID == grant.CheckinID {
						index = i
						break
					}
				}
				if index < 0 {
					next = append(next, checkinAllocation{GrantID: grant.CheckinID, Quota: amount})
				} else {
					next[index].Quota += amount
				}
				delta -= amount
			}
			wallet += delta
		} else if delta < 0 {
			refund := -delta
			paidRefund := min(refund, wallet)
			wallet -= paidRefund
			refund -= paidRefund
			for i := len(next) - 1; i >= 0 && refund > 0; i-- {
				amount := min(refund, next[i].Quota)
				next[i].Quota -= amount
				refund -= amount
			}
			if refund != 0 {
				return errors.New("invalid check-in funding refund")
			}
		}
		walletDelta = wallet - receipt.WalletQuota
		if walletDelta != 0 {
			query := tx.Model(&User{}).Where("id = ?", userID)
			if reserve && walletDelta > 0 {
				// Reserve the cache atomically too: legacy in-flight requests can
				// still use batched wallet funding during a mode transition.
				if common.RedisEnabled {
					result, cacheErr := cacheTryReserveUserQuota(userID, int64(walletDelta))
					if cacheErr == nil && result == cacheQuotaInsufficient {
						return ErrCheckinFundingInsufficient
					}
					if cacheErr == nil && result == cacheQuotaOK {
						cachedReservation = walletDelta
					} else if common.BatchUpdateEnabled {
						// Do not hydrate through another DB connection while this
						// transaction is open or discard outstanding batch debits.
						if cacheErr != nil {
							return cacheErr
						}
						return errors.New("check-in funding wallet cache unavailable")
					}
				}
				query = query.Where("quota >= ?", walletDelta)
			}
			if walletDelta < 0 {
				query = query.Where("quota <= ?", common.MaxWalletQuota+walletDelta)
			}
			update := query.Update("quota", gorm.Expr("quota - ?", walletDelta))
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				if walletDelta < 0 {
					return ErrWalletQuotaLimitExceeded
				}
				return ErrCheckinFundingInsufficient
			}
		}
		oldAmounts := make(map[int]int, len(old))
		for _, allocation := range old {
			oldAmounts[allocation.GrantID] = allocation.Quota
		}
		for _, allocation := range next {
			previous := oldAmounts[allocation.GrantID]
			usedDelta, reservedDelta := 0, 0
			if receipt.Settled {
				usedDelta -= previous
			} else {
				reservedDelta -= previous
			}
			if settled {
				usedDelta += allocation.Quota
			} else {
				reservedDelta += allocation.Quota
			}
			if err := tx.Model(&CheckinGrant{}).Where("checkin_id = ? AND user_id = ?", allocation.GrantID, userID).
				Updates(map[string]any{"remaining": gorm.Expr("remaining + ?", previous-allocation.Quota), "used": gorm.Expr("used + ?", usedDelta), "reserved": gorm.Expr("reserved + ?", reservedDelta)}).Error; err != nil {
				return err
			}
		}
		data, err := common.Marshal(next)
		if err != nil {
			return err
		}
		receipt.UserID, receipt.SourceKey = userID, hex.EncodeToString(hash[:])
		receipt.Quota, receipt.WalletQuota, receipt.Settled, receipt.Allocations = quota, wallet, settled, string(data)
		return tx.Save(&receipt).Error
	})
	cacheDelta := cachedReservation
	if err == nil {
		cacheDelta -= walletDelta
	}
	if cacheDelta != 0 {
		if cacheErr := cacheIncrUserQuota(userID, int64(cacheDelta)); cacheErr != nil {
			common.SysError("sync check-in funding wallet: " + cacheErr.Error())
		}
	}
	return err
}

func checkinFundingGiftUsed(tx *gorm.DB, userID int, source string) (int64, error) {
	hash := sha256.Sum256([]byte(source))
	var receipt CheckinFunding
	err := tx.Where("user_id = ? AND source_key = ?", userID, hex.EncodeToString(hash[:])).First(&receipt).Error
	return int64(receipt.Quota - receipt.WalletQuota), err
}
