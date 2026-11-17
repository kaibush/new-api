package model

import (
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const InputAuditReviewOption = "InputAuditReviewSettings"

// Credentials are read from a dedicated server environment variable, never
// returned to the browser or copied into jobs, prompts, or ordinary logs.
type InputAuditReviewSettings struct {
	Enabled                bool   `json:"enabled"`
	Automatic              bool   `json:"automatic"`
	IntervalMinutes        int    `json:"interval_minutes"`
	Endpoint               string `json:"endpoint"`
	KeyEnv                 string `json:"key_env"`
	Model                  string `json:"model"`
	Instructions           string `json:"instructions"`
	BatchSize              int    `json:"batch_size"`
	ChunkChars             int    `json:"chunk_chars"`
	TimeoutSeconds         int    `json:"timeout_seconds"`
	RequestIntervalSeconds int    `json:"request_interval_seconds"`
	Retries                int    `json:"retries"`
	ConfidenceThreshold    int    `json:"confidence_threshold"`
	RetentionDays          int    `json:"retention_days"`
}

func DefaultInputAuditReviewSettings() InputAuditReviewSettings {
	return InputAuditReviewSettings{IntervalMinutes: 60, KeyEnv: "INPUT_AUDIT_LLM_API_KEY", BatchSize: 100, ChunkChars: 6000, TimeoutSeconds: 60, RequestIntervalSeconds: 2, Retries: 1, ConfidenceThreshold: 80, RetentionDays: 30}
}

func (s InputAuditReviewSettings) Validate() error {
	for _, value := range []string{s.Endpoint, s.Model, s.Instructions, s.KeyEnv} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
			return errors.New("Invalid model review settings")
		}
	}

	if s.IntervalMinutes < 1 || s.IntervalMinutes > 10080 || s.BatchSize < 1 || s.BatchSize > 1000 || s.ChunkChars < 1000 || s.ChunkChars > 16000 || s.TimeoutSeconds < 5 || s.TimeoutSeconds > 120 || s.RequestIntervalSeconds < 1 || s.RequestIntervalSeconds > 60 || s.Retries < 0 || s.Retries > 3 || s.ConfidenceThreshold < 0 || s.ConfidenceThreshold > 100 || s.RetentionDays < 1 || s.RetentionDays > 90 || len(s.Instructions) > 12000 || len(s.Model) > 200 {
		return errors.New("Invalid model review settings")
	}
	if s.KeyEnv != "" && !regexp.MustCompile(`^INPUT_AUDIT_LLM_[A-Z0-9_]+$`).MatchString(s.KeyEnv) {
		return errors.New("Use an INPUT_AUDIT_LLM_ prefixed credential environment variable")
	}
	if s.Endpoint != "" {
		u, err := url.Parse(s.Endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) || len(s.Endpoint) > 2000 {
			return errors.New("Use an HTTPS chat completions endpoint (HTTP is allowed only on loopback)")
		}
	}
	if s.Enabled && (s.Endpoint == "" || strings.TrimSpace(s.Model) == "") {
		return errors.New("Model and endpoint are required")
	}
	return nil
}

func LoadInputAuditReviewSettings(db *gorm.DB) (InputAuditReviewSettings, error) {
	s := DefaultInputAuditReviewSettings()
	var o Option
	err := db.Where(&Option{Key: InputAuditReviewOption}).First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		b, _ := common.Marshal(s)
		err = db.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: InputAuditReviewOption, Value: string(b)}).Error
		if err == nil {
			err = db.Where(&Option{Key: InputAuditReviewOption}).First(&o).Error
		}
	}
	if err != nil {
		return s, err
	}
	if err = common.UnmarshalJsonStr(o.Value, &s); err != nil {
		return s, err
	}
	return s, s.Validate()
}

func SaveInputAuditReviewSettings(db *gorm.DB, s InputAuditReviewSettings) error {
	if err := s.Validate(); err != nil {
		return err
	}
	b, err := common.Marshal(s)
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&Option{Key: InputAuditReviewOption, Value: string(b)}).Error
}

type InputAuditReviewJob struct {
	Id         int64  `json:"id"`
	CreatedAt  int64  `json:"created_at" gorm:"index"`
	UpdatedAt  int64  `json:"updated_at"`
	CreatedBy  int    `json:"created_by"`
	Status     string `json:"status" gorm:"type:varchar(24);index"`
	Mode       string `json:"mode" gorm:"type:varchar(24)"`
	UserId     int    `json:"user_id"`
	Cursor     int64  `json:"cursor"`
	UpperId    int64  `json:"upper_id"`
	Processed  int    `json:"processed"`
	Flagged    int    `json:"flagged"`
	Failed     int    `json:"failed"`
	LeaseUntil int64  `json:"-"`
	LeaseToken string `json:"-" gorm:"type:varchar(64)"`
	Settings   string `json:"-" gorm:"type:text"`
}

type InputAuditReviewResult struct {
	Id         int64  `json:"id"`
	JobId      int64  `json:"job_id" gorm:"uniqueIndex:idx_review_job_audit,priority:1;index"`
	AuditId    int64  `json:"audit_id" gorm:"uniqueIndex:idx_review_job_audit,priority:2;index"`
	UserId     int    `json:"user_id" gorm:"index"`
	CreatedAt  int64  `json:"created_at" gorm:"index"`
	Status     string `json:"status" gorm:"type:varchar(32);index"`
	Category   string `json:"category" gorm:"type:varchar(32)"`
	Confidence int    `json:"confidence"`
	Reason     string `json:"reason" gorm:"type:text"`
	Quote      string `json:"quote" gorm:"type:text"`
	Model      string `json:"model" gorm:"type:varchar(200)"`
	Complete   bool   `json:"complete"`
	Chunks     int    `json:"chunks"`
}

// Serialize job creation using the existing singleton settings row. Only one
// active job is allowed across gateway instances; network calls hold no DB lock.
func CreateInputAuditReviewJob(db *gorm.DB, mode string, userID, operator int, scheduled bool) (InputAuditReviewJob, error) {
	var job InputAuditReviewJob
	if !slices.Contains([]string{"incremental", "all", "failed"}, mode) || userID < 0 {
		return job, errors.New("Invalid model review scope")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		var guard Option
		if err := lockForUpdate(tx).Where(&Option{Key: InputAuditReviewOption}).First(&guard).Error; err != nil {
			return err
		}
		settings, err := LoadInputAuditReviewSettings(tx)
		if err != nil {
			return err
		}
		if !settings.Enabled {
			return errors.New("Model review is disabled")
		}
		var active int64
		if err = tx.Model(&InputAuditReviewJob{}).Where("status IN ?", []string{"pending", "running"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("A model review job is already active")
		}
		now := time.Now().Unix()
		if scheduled {
			if !settings.Automatic {
				return nil
			}
			var last InputAuditReviewJob
			if err = tx.Order("id DESC").Limit(1).Find(&last).Error; err != nil {
				return err
			}
			if last.CreatedAt+int64(settings.IntervalMinutes)*60 > now {
				return nil
			}
		}
		var upper InputAudit
		if err = tx.Select("id").Order("id DESC").Limit(1).Find(&upper).Error; err != nil {
			return err
		}
		b, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		job = InputAuditReviewJob{CreatedAt: now, UpdatedAt: now, CreatedBy: operator, Status: "pending", Mode: mode, UserId: userID, UpperId: upper.Id, Settings: string(b)}
		return tx.Create(&job).Error
	})
	return job, err
}

func NextInputAuditForReview(db *gorm.DB, job InputAuditReviewJob) (InputAudit, error) {
	var row InputAudit
	q := db.Where("id > ? AND id <= ?", job.Cursor, job.UpperId)
	if job.UserId > 0 {
		q = q.Where("user_id = ?", job.UserId)
	}
	if job.Mode == "incremental" {
		q = q.Where("review_attempted_at IS NULL OR review_attempted_at = ?", 0)
	}
	if job.Mode == "failed" {
		latest := db.Model(&InputAuditReviewResult{}).Select("MAX(id)").Group("audit_id")
		q = q.Where("id IN (?)", db.Model(&InputAuditReviewResult{}).Select("audit_id").Where("status = ? AND id IN (?)", "failed", latest))
	}
	err := q.Order("id").First(&row).Error
	return row, err
}

// PruneInputAuditReviews bounds storage independently of the message collector.
// Active jobs survive retention so workers can finish or administrators cancel.
func PruneInputAuditReviews(db *gorm.DB, retentionDays int, now int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("created_at < ?", now-int64(retentionDays)*86400).Delete(&InputAuditReviewResult{}).Error; err != nil {
			return err
		}
		var boundary InputAuditReviewResult
		if err := tx.Select("id").Order("id DESC").Offset(99999).Limit(1).Find(&boundary).Error; err != nil {
			return err
		}
		if boundary.Id > 0 {
			if err := tx.Where("id < ?", boundary.Id).Delete(&InputAuditReviewResult{}).Error; err != nil {
				return err
			}
		}
		var jobBoundary InputAuditReviewJob
		if err := tx.Select("id").Order("id DESC").Offset(999).Limit(1).Find(&jobBoundary).Error; err != nil {
			return err
		}
		expired := tx.Model(&InputAuditReviewJob{}).Select("id").Where("status NOT IN ?", []string{"pending", "running"}).Where("created_at < ? OR id < ?", now-int64(retentionDays)*86400, jobBoundary.Id)
		if err := tx.Where("job_id IN (?)", expired).Delete(&InputAuditReviewResult{}).Error; err != nil {
			return err
		}
		return tx.Where("status NOT IN ?", []string{"pending", "running"}).Where("created_at < ? OR id < ?", now-int64(retentionDays)*86400, jobBoundary.Id).Delete(&InputAuditReviewJob{}).Error
	})
}
