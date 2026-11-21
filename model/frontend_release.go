package model

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const FrontendReleaseOptionKey = "FrontendRelease"

type FrontendRelease struct {
	Revision    int64  `json:"revision"`
	Version     string `json:"version"`
	Notes       string `json:"notes"`
	PublishedAt int64  `json:"published_at"`
}

// Read the shared database rather than the process-local option cache so all
// websocket servers see a publication even without Redis.
func GetFrontendRelease() (FrontendRelease, error) {
	var option Option
	err := DB.Where(&Option{Key: FrontendReleaseOptionKey}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return FrontendRelease{}, nil
	}
	if err != nil {
		return FrontendRelease{}, err
	}
	var release FrontendRelease
	err = common.UnmarshalJsonStr(option.Value, &release)
	return release, err
}

func PublishFrontendRelease(version, notes string) (FrontendRelease, error) {
	release := FrontendRelease{Version: strings.TrimSpace(version), Notes: strings.TrimSpace(notes)}
	if release.Version == "" || utf8.RuneCountInString(release.Version) > 80 || utf8.RuneCountInString(release.Notes) > 2000 {
		return release, errors.New("version must contain 1–80 characters and notes at most 2000 characters")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		option := Option{Key: FrontendReleaseOptionKey, Value: `{}`}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: FrontendReleaseOptionKey}).First(&option).Error; err != nil {
			return err
		}
		var previous FrontendRelease
		if err := common.UnmarshalJsonStr(option.Value, &previous); err != nil {
			return err
		}
		release.Revision = previous.Revision + 1
		release.PublishedAt = time.Now().Unix()
		data, err := common.Marshal(release)
		if err != nil {
			return err
		}
		return tx.Model(&Option{}).Where(&Option{Key: FrontendReleaseOptionKey}).Update("value", string(data)).Error
	})
	return release, err
}
