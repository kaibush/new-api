package model

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SiteVisit contains analytics metadata only; never store query strings or auth sessions.
// Kept in the primary database, independently of the optional usage log database.
type SiteVisit struct {
	ID        int64  `json:"id"`
	CreatedAt int64  `json:"created_at" gorm:"index"`
	Day       string `json:"day" gorm:"size:10;index"`
	UserID    int    `json:"user_id" gorm:"index"`
	Username  string `json:"username" gorm:"size:64"`
	Visitor   string `json:"-" gorm:"size:80"`
	Session   string `json:"-" gorm:"size:120"`
	Page      string `json:"page" gorm:"size:255;index"`
	Referrer  string `json:"referrer" gorm:"size:255"`
	IP        string `json:"ip" gorm:"size:64"`
	Browser   string `json:"browser" gorm:"size:32"`
	OS        string `json:"os" gorm:"size:32"`
	Device    string `json:"device" gorm:"size:16"`
	Language  string `json:"language" gorm:"size:32"`
}

type VisitFilter struct {
	Start, End    int64
	Page          string
	UserID        int
	Offset, Limit int
}

type VisitCounts struct {
	PV       int64 `json:"pv"`
	UV       int64 `json:"uv"`
	Sessions int64 `json:"sessions"`
	Users    int64 `json:"users"`
}

type VisitBucket struct {
	Name string `json:"name"`
	PV   int64  `json:"pv"`
	UV   int64  `json:"uv"`
}

type VisitReport struct {
	VisitCounts
	Trend       []VisitBucket `json:"trend"`
	Pages       []VisitBucket `json:"pages"`
	Referrers   []VisitBucket `json:"referrers"`
	Browsers    []VisitBucket `json:"browsers"`
	Devices     []VisitBucket `json:"devices"`
	Systems     []VisitBucket `json:"systems"`
	UserRanking []VisitBucket `json:"user_ranking"`
}

func visitQuery(db *gorm.DB, filter VisitFilter) *gorm.DB {
	q := db.Model(&SiteVisit{}).Where("created_at >= ? AND created_at < ?", filter.Start, filter.End)
	if filter.Page != "" {
		q = q.Where("page = ?", filter.Page)
	}
	if filter.UserID > 0 {
		q = q.Where("user_id = ?", filter.UserID)
	}
	return q
}

func QueryVisitReport(db *gorm.DB, filter VisitFilter) (VisitReport, error) {
	report := VisitReport{}
	err := visitQuery(db, filter).Select("COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv, COUNT(DISTINCT session) AS sessions, COUNT(DISTINCT NULLIF(user_id, 0)) AS users").Scan(&report.VisitCounts).Error
	if err != nil {
		return report, err
	}
	// Column names are server-owned constants, never request parameters.
	for _, dimension := range []struct {
		column string
		target *[]VisitBucket
	}{
		{"day", &report.Trend}, {"page", &report.Pages}, {"referrer", &report.Referrers},
		{"browser", &report.Browsers}, {"device", &report.Devices}, {"os", &report.Systems}, {"username", &report.UserRanking},
	} {
		*dimension.target = []VisitBucket{}
		q := visitQuery(db, filter).Select(dimension.column + " AS name, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv").Group(dimension.column)
		if dimension.column == "day" {
			q = q.Order("day ASC")
		} else {
			q = q.Order("pv DESC").Order(dimension.column + " ASC").Limit(50)
		}
		if dimension.column == "username" {
			q = q.Where("user_id > 0")
		}
		if err := q.Scan(dimension.target).Error; err != nil {
			return report, err
		}
	}
	// Zero-fill UTC days, including days without visits.
	buckets := make(map[string]VisitBucket, len(report.Trend))
	for _, bucket := range report.Trend {
		buckets[bucket.Name] = bucket
	}
	report.Trend = []VisitBucket{}
	start := time.Unix(filter.Start, 0).UTC()
	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for day.Unix() < filter.End {
		name := day.Format("2006-01-02")
		bucket := buckets[name]
		bucket.Name = name
		report.Trend = append(report.Trend, bucket)
		day = day.AddDate(0, 0, 1)
	}
	return report, nil
}

func QueryVisitDetails(db *gorm.DB, filter VisitFilter) ([]SiteVisit, int64, error) {
	rows := []SiteVisit{}
	var total int64
	if err := visitQuery(db, filter).Count(&total).Error; err != nil {
		return rows, 0, err
	}
	err := visitQuery(db, filter).Order("id DESC").Offset(filter.Offset).Limit(filter.Limit).Find(&rows).Error
	return rows, total, err
}

// PruneSiteVisits deletes in bounded batches so retention cannot lock an entire large table.
func PruneSiteVisits(db *gorm.DB, before int64) error {
	for {
		ids := []int64{}
		if err := db.Model(&SiteVisit{}).Where("created_at < ?", before).Order("id").Limit(1000).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := db.Where("id IN ?", ids).Delete(&SiteVisit{}).Error; err != nil {
			return err
		}
	}
}

func StartSiteVisitRetention() {
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			err := PruneSiteVisits(DB.WithContext(ctx), time.Now().AddDate(0, 0, -90).Unix())
			cancel()
			if err != nil {
				common.SysError("site visit retention failed: " + err.Error())
			}
			time.Sleep(time.Hour)
		}
	}()
}
