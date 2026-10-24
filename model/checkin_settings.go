package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CheckinPolicyState is the authoritative, atomically updated configuration.
// Decisions read it from the primary database, including on other instances.
type CheckinPolicyState struct {
	ID            int    `gorm:"primaryKey;autoIncrement:false"`
	Settings      string `gorm:"type:text;not null"`
	Version       int64  `gorm:"not null"`
	ObservedSince int64  `gorm:"not null"`
}

type CheckinConfiguration struct {
	Settings      operation_setting.CheckinSetting `json:"settings"`
	Version       int64                            `json:"version"`
	ObservedSince int64                            `json:"observed_since"`
}

// InitializeCheckinAccounting backfills only the durable journal. Optional
// consume logs cannot establish complete history and are never inferred as zero.
func InitializeCheckinAccounting() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		common.OptionMapRWMutex.RLock()
		settings := *operation_setting.GetCheckinSetting()
		common.OptionMapRWMutex.RUnlock()
		var options []Option
		if err := tx.Where(map[string]any{"key": []string{"checkin_setting.enabled", "checkin_setting.min_quota", "checkin_setting.max_quota", "checkin_setting.limits"}}).Find(&options).Error; err != nil {
			return err
		}
		for _, option := range options {
			if err := applyCheckinOption(&settings, option.Key, option.Value); err != nil {
				return err
			}
		}
		if err := settings.Validate(); err != nil {
			return err
		}
		data, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		state := CheckinPolicyState{ID: 1, Settings: string(data), ObservedSince: time.Now().Unix()}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&state, 1).Error; err != nil {
			return err
		}
		if state.Version != 0 {
			return nil
		}
		// UTC buckets accelerate interior days; rolling boundaries are always
		// queried from the journal, preserving the original second precision.
		const dayExpression = "created_at - (created_at % 86400)"
		for offset := 0; ; offset += 500 {
			var days []CheckinUsageDay
			if err := tx.Model(&CheckinUsage{}).Where("pending = ?", false).
				Select("user_id, " + dayExpression + " AS day, SUM(quota) AS quota").
				Group("user_id, " + dayExpression).Order("user_id, day").Offset(offset).Limit(500).Scan(&days).Error; err != nil {
				return err
			}
			if len(days) == 0 {
				break
			}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "day"}}, DoUpdates: clause.AssignmentColumns([]string{"quota"})}).Create(&days).Error; err != nil {
				return err
			}
		}
		return tx.Model(&state).Update("version", 1).Error
	})
}

func readCheckinConfiguration(tx *gorm.DB) (CheckinConfiguration, error) {
	var state CheckinPolicyState
	var config CheckinConfiguration
	if tx == nil {
		return config, errors.New("Check-in database is unavailable")
	}
	if err := tx.First(&state, 1).Error; err != nil {
		return config, err
	}
	config.Version, config.ObservedSince = state.Version, state.ObservedSince
	if err := common.UnmarshalJsonStr(state.Settings, &config.Settings); err != nil {
		return config, err
	}
	return config, config.Settings.Validate()
}

func CurrentCheckinConfiguration() (CheckinConfiguration, error) {
	return readCheckinConfiguration(DB)
}

func CurrentCheckinSettings() (operation_setting.CheckinSetting, error) {
	config, err := CurrentCheckinConfiguration()
	return config.Settings, err
}

// UpdateCheckinConfiguration rejects stale admin edits rather than overwriting
// changes from another administrator or instance.
func UpdateCheckinConfiguration(settings operation_setting.CheckinSetting, version int64) (CheckinConfiguration, error) {
	if err := settings.Validate(); err != nil {
		return CheckinConfiguration{}, err
	}
	return updateCheckinConfiguration(&settings, version, nil)
}

func updateCheckinConfiguration(settings *operation_setting.CheckinSetting, version int64, values map[string]string) (CheckinConfiguration, error) {
	var result CheckinConfiguration
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = writeCheckinConfiguration(tx, settings, version, values)
		return err
	})
	return result, err
}

func writeCheckinConfiguration(tx *gorm.DB, settings *operation_setting.CheckinSetting, version int64, values map[string]string) (CheckinConfiguration, error) {
	// A no-op write obtains SQLite's writer lock before reading as well.
	if err := tx.Model(&CheckinPolicyState{}).Where("id = ?", 1).Update("version", gorm.Expr("version")).Error; err != nil {
		return CheckinConfiguration{}, err
	}
	current, err := readCheckinConfiguration(lockForUpdate(tx))
	if err != nil {
		return CheckinConfiguration{}, err
	}
	if settings != nil {
		if current.Version != version {
			return CheckinConfiguration{}, errors.New("Check-in settings changed. Refresh before saving again.")
		}
		current.Settings = *settings
	}
	for key, value := range values {
		if err := applyCheckinOption(&current.Settings, key, value); err != nil {
			return CheckinConfiguration{}, err
		}
	}
	if err := current.Settings.Validate(); err != nil {
		return CheckinConfiguration{}, err
	}
	data, err := common.Marshal(current.Settings)
	if err != nil {
		return CheckinConfiguration{}, err
	}
	current.Version++
	if err := tx.Model(&CheckinPolicyState{}).Where("id = ?", 1).Updates(map[string]any{"settings": string(data), "version": current.Version}).Error; err != nil {
		return CheckinConfiguration{}, err
	}
	// Keep legacy option exports in sync in the same transaction.
	fields := map[string]any{"enabled": current.Settings.Enabled, "min_quota": current.Settings.MinQuota, "max_quota": current.Settings.MaxQuota, "limits": current.Settings.Limits}
	for field, value := range fields {
		encoded, err := common.Marshal(value)
		if err != nil {
			return CheckinConfiguration{}, err
		}
		option := Option{Key: "checkin_setting." + field, Value: string(encoded)}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&option).Error; err != nil {
			return CheckinConfiguration{}, err
		}
	}
	return current, nil
}

func applyCheckinOption(settings *operation_setting.CheckinSetting, key, value string) error {
	switch key {
	case "checkin_setting.enabled":
		return common.UnmarshalJsonStr(value, &settings.Enabled)
	case "checkin_setting.min_quota":
		return common.UnmarshalJsonStr(value, &settings.MinQuota)
	case "checkin_setting.max_quota":
		return common.UnmarshalJsonStr(value, &settings.MaxQuota)
	case "checkin_setting.limits":
		return common.UnmarshalJsonStr(value, &settings.Limits)
	default:
		return errors.New("invalid check-in setting: " + strings.TrimPrefix(key, "checkin_setting."))
	}
}
