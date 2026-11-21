package model

import (
	"errors"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const CommunityBoardOptionKey = "community.board.v1"

var ErrCommunityBoardConflict = errors.New("Board changed. Reload before saving")
var ErrCommunityBoardInvalid = errors.New("Invalid community board configuration")

type CommunityBoardAction struct {
	Type         string `json:"type"`
	Label        string `json:"label"`
	Value        string `json:"value"`
	ConfirmLeave bool   `json:"confirm_leave,omitempty"`
}
type CommunityBoardBlock struct {
	LeaderboardTab   string                 `json:"leaderboard_tab,omitempty"`
	LeaderboardLimit int                    `json:"leaderboard_limit,omitempty"`
	LeaderboardRoute bool                   `json:"leaderboard_route,omitempty"`
	ID               string                 `json:"id"`
	Type             string                 `json:"type"`
	Enabled          bool                   `json:"enabled"`
	Title            string                 `json:"title"`
	Body             string                 `json:"body"`
	ImageURL         string                 `json:"image_url"`
	Actions          []CommunityBoardAction `json:"actions"`
}
type CommunityBoardDocument struct {
	SchemaVersion int                   `json:"schema_version"`
	Version       int64                 `json:"version"`
	Title         string                `json:"title"`
	Subtitle      string                `json:"subtitle"`
	Blocks        []CommunityBoardBlock `json:"blocks"`
}

func DefaultCommunityBoard() CommunityBoardDocument {
	d := CommunityBoardDocument{SchemaVersion: 1, Blocks: []CommunityBoardBlock{}}
	for _, kind := range []string{"builtin.checkin", "builtin.checkin_leaderboard", "builtin.events", "builtin.red_packets", "builtin.red_packet_rules"} {
		d.Blocks = append(d.Blocks, CommunityBoardBlock{ID: kind, Type: kind, Enabled: true, Actions: []CommunityBoardAction{}})
	}
	return d
}
func ValidCommunityBoardURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(raw, "\\\r\n\t")
}
func ValidateCommunityBoard(d CommunityBoardDocument) error {
	if d.SchemaVersion != 1 || d.Version < 0 || d.Version >= 9007199254740991 || d.Blocks == nil || len(d.Blocks) > 30 || utf8.RuneCountInString(d.Title) > 240 || utf8.RuneCountInString(d.Subtitle) > 600 {
		return ErrCommunityBoardInvalid
	}
	ids := map[string]bool{}
	builtins := map[string]bool{}
	for _, b := range d.Blocks {
		if b.ID == "" || len(b.ID) > 80 || ids[b.ID] || utf8.RuneCountInString(b.Title) > 240 || utf8.RuneCountInString(b.Body) > 12000 || len(b.ImageURL) > 2048 || b.Actions == nil || len(b.Actions) > 12 {
			return ErrCommunityBoardInvalid
		}
		ids[b.ID] = true
		if !slices.Contains([]string{"builtin.checkin", "builtin.checkin_leaderboard", "builtin.events", "builtin.red_packets", "builtin.red_packet_rules", "custom.action_card", "custom.notice", "custom.link_grid", "custom.banner", "custom.copy_card"}, b.Type) {
			return ErrCommunityBoardInvalid
		}
		if strings.HasPrefix(b.Type, "builtin.") {
			if (builtins[b.Type] && b.Type != "builtin.checkin_leaderboard") || len(b.Actions) > 0 || b.Body != "" || b.ImageURL != "" {
				return ErrCommunityBoardInvalid
			}
			builtins[b.Type] = true
		}
		if !slices.Contains([]string{"", "today", "highlights", "total"}, b.LeaderboardTab) || (b.LeaderboardLimit != 0 && (b.LeaderboardLimit < 3 || b.LeaderboardLimit > 10)) {
			return ErrCommunityBoardInvalid
		}
		if b.ImageURL != "" && !ValidCommunityBoardURL(b.ImageURL) {
			return ErrCommunityBoardInvalid
		}
		if b.Type == "custom.banner" && b.ImageURL == "" {
			return ErrCommunityBoardInvalid
		}
		actions := map[CommunityBoardAction]bool{}
		for _, a := range b.Actions {
			if actions[a] {
				return ErrCommunityBoardInvalid
			}
			actions[a] = true
			if utf8.RuneCountInString(a.Label) > 120 || strings.TrimSpace(a.Label) == "" || utf8.RuneCountInString(a.Value) > 12000 || strings.TrimSpace(a.Value) == "" {
				return ErrCommunityBoardInvalid
			}
			switch a.Type {
			case "external_url":
				if len(a.Value) > 2048 || !ValidCommunityBoardURL(a.Value) {
					return ErrCommunityBoardInvalid
				}
			case "internal_route":
				if !slices.Contains([]string{"/checkin", "/checkin-leaderboard", "/models", "/playground", "/wallet", "/subscriptions", "/keys", "/channel-status", "/profile", "/usage-logs"}, a.Value) {
					return ErrCommunityBoardInvalid
				}
			case "modal_widget":
				if !slices.Contains([]string{"checkin", "checkin_leaderboard"}, a.Value) {
					return ErrCommunityBoardInvalid
				}
			case "chat_prefill":
				if utf8.RuneCountInString(a.Value) > 2000 {
					return ErrCommunityBoardInvalid
				}
			case "modal_content", "copy_text":
			default:
				return ErrCommunityBoardInvalid
			}
		}
	}
	encoded, err := common.Marshal(d)
	if err != nil || len(encoded) > 60000 {
		return ErrCommunityBoardInvalid
	}
	return nil
}
func GetCommunityBoard() (CommunityBoardDocument, error) {
	var option Option
	err := DB.Where(&Option{Key: CommunityBoardOptionKey}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DefaultCommunityBoard(), nil
	}
	if err != nil {
		return CommunityBoardDocument{}, err
	}
	var d CommunityBoardDocument
	if err = common.UnmarshalJsonStr(option.Value, &d); err != nil {
		return d, err
	}
	return d, ValidateCommunityBoard(d)
}

// Compare-and-swap on the serialized document works across processes without a new schema.
func SaveCommunityBoard(d CommunityBoardDocument) (CommunityBoardDocument, error) {
	if err := ValidateCommunityBoard(d); err != nil {
		return d, err
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(DefaultCommunityBoard())
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: CommunityBoardOptionKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		var old Option
		if err = lockForUpdate(tx).Where(&Option{Key: CommunityBoardOptionKey}).First(&old).Error; err != nil {
			return err
		}
		var previous CommunityBoardDocument
		if err = common.UnmarshalJsonStr(old.Value, &previous); err != nil {
			return err
		}
		if previous.Version != d.Version {
			return ErrCommunityBoardConflict
		}
		d.Version++
		data, err := common.Marshal(d)
		if err != nil {
			return err
		}
		result := tx.Model(&Option{}).Where(&Option{Key: CommunityBoardOptionKey, Value: old.Value}).Update("value", string(data))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCommunityBoardConflict
		}
		return nil
	})
	return d, err
}
