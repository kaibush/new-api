package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

var ErrInputAuditConflict = errors.New("Audit configuration changed; refresh and try again")

func LoadInputAuditAllowlist(db *gorm.DB) (request_plugin_setting.Allowlist, error) {
	policy := request_plugin_setting.Allowlist{Entries: []request_plugin_setting.AllowlistEntry{}}
	var option Option
	err := db.Where(&Option{Key: request_plugin_setting.AllowlistOption}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return policy, nil
	}
	if err != nil {
		return policy, err
	}
	err = common.UnmarshalJsonStr(option.Value, &policy)
	return policy, err
}

func SaveInputAuditAllowlist(db *gorm.DB, policy request_plugin_setting.Allowlist) error {
	encoded, err := common.Marshal(policy)
	if err != nil {
		return err
	}
	if len(encoded) > 256<<10 {
		return errors.New("Allowlist settings must not exceed 256 KiB")
	}
	err = db.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		option := Option{Key: request_plugin_setting.AllowlistOption, Value: `{"version":0,"entries":[]}`}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: option.Key}).First(&option).Error; err != nil {
			return err
		}
		var previous request_plugin_setting.Allowlist
		if err := common.UnmarshalJsonStr(option.Value, &previous); err != nil {
			return err
		}
		if policy.Version < 1 || policy.Version > 9007199254740991 || previous.Version+1 != policy.Version {
			return ErrInputAuditConflict
		}
		result := tx.Model(&Option{}).Where(&Option{Key: option.Key}).Where("value = ?", option.Value).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInputAuditConflict
		}
		if err := tx.Create(&InputAuditPolicyRevision{Version: policy.Version, CreatedAt: time.Now().Unix(), Policy: string(encoded)}).Error; err != nil {
			return err
		}
		var boundary InputAuditPolicyRevision
		if err := tx.Order("version DESC").Offset(99).Limit(1).Find(&boundary).Error; err != nil {
			return err
		}
		if boundary.Id != 0 {
			return tx.Where("version < ?", boundary.Version).Delete(&InputAuditPolicyRevision{}).Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	return updateOptionMap(request_plugin_setting.AllowlistOption, string(encoded))
}
