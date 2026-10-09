package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Released v1.0.0-rc.41 Option schema: a representative pre-existing table.
type releasedVisitOption struct {
	Key   string `gorm:"primaryKey"`
	Value string
}

func (releasedVisitOption) TableName() string { return "visit_upgrade_options" }

func TestSiteVisitDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "visits.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not set")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not set")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			for _, upgraded := range []bool{false, true} {
				require.NoError(t, db.Migrator().DropTable(&model.SiteVisit{}, &releasedVisitOption{}))
				if upgraded {
					require.NoError(t, db.AutoMigrate(&releasedVisitOption{}))
					require.NoError(t, db.Create(&releasedVisitOption{Key: "site-name", Value: "existing-site"}).Error)
				}
				require.NoError(t, db.AutoMigrate(&model.SiteVisit{}))
				start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).Unix()
				rows := []model.SiteVisit{
					{CreatedAt: start, Day: "2026-10-01", UserID: 1, Username: "alice", Visitor: "u:1", Session: "u:1:a", Page: "/dashboard", Browser: "Chrome"},
					{CreatedAt: start + 1, Day: "2026-10-01", UserID: 1, Username: "alice", Visitor: "u:1", Session: "u:1:a", Page: "/keys", Browser: "Chrome"},
					{CreatedAt: start + 86400, Day: "2026-10-02", UserID: 1, Username: "alice", Visitor: "u:1", Session: "u:1:b", Page: "/keys", Browser: "Firefox"},
					{CreatedAt: start + 86401, Day: "2026-10-02", Visitor: "a:2", Session: "a:2:a", Page: "/pricing", Browser: "Safari"},
					{CreatedAt: start - 1, Day: "2026-09-30", Visitor: "a:3", Session: "a:3:a", Page: "/"},
					{CreatedAt: start + 3*86400, Day: "2026-10-04", Visitor: "a:4", Session: "a:4:a", Page: "/"},
				}
				require.NoError(t, db.Create(&rows).Error)
				// Repeated startup must preserve rows and indexes.
				for range 2 {
					require.NoError(t, db.AutoMigrate(&model.SiteVisit{}))
				}
				assert.True(t, db.Migrator().HasIndex(&model.SiteVisit{}, "CreatedAt"))
				if upgraded {
					var option releasedVisitOption
					require.NoError(t, db.First(&option).Error)
					assert.Equal(t, "existing-site", option.Value)
					assert.Error(t, db.Create(&releasedVisitOption{Key: "site-name", Value: "duplicate"}).Error)
				}
				filter := model.VisitFilter{Start: start, End: start + 3*86400, Limit: 2}
				report, err := model.QueryVisitReport(db, filter)
				require.NoError(t, err)
				assert.Equal(t, model.VisitCounts{PV: 4, UV: 2, Sessions: 3, Users: 1}, report.VisitCounts)
				assert.Equal(t, []model.VisitBucket{{Name: "2026-10-01", PV: 2, UV: 1}, {Name: "2026-10-02", PV: 2, UV: 2}, {Name: "2026-10-03", PV: 0, UV: 0}}, report.Trend)
				assert.Equal(t, model.VisitBucket{Name: "/keys", PV: 2, UV: 1}, report.Pages[0])
				assert.Equal(t, []model.VisitBucket{{Name: "alice", PV: 3, UV: 1}}, report.UserRanking)
				details, total, err := model.QueryVisitDetails(db, filter)
				require.NoError(t, err)
				assert.EqualValues(t, 4, total)
				require.Len(t, details, 2)
				assert.Equal(t, "/pricing", details[0].Page)
				filter.Offset = 2
				details, _, err = model.QueryVisitDetails(db, filter)
				require.NoError(t, err)
				require.Len(t, details, 2)
				assert.Equal(t, "/keys", details[0].Page)
				filter.UserID = 1
				filter.Page = "/keys"
				report, err = model.QueryVisitReport(db, filter)
				require.NoError(t, err)
				assert.Equal(t, model.VisitCounts{PV: 2, UV: 1, Sessions: 2, Users: 1}, report.VisitCounts)
				filter.UserID = 99
				report, err = model.QueryVisitReport(db, filter)
				require.NoError(t, err)
				assert.Zero(t, report.PV)
				assert.Empty(t, report.Pages)
				require.NoError(t, model.PruneSiteVisits(db, start))
				var count int64
				require.NoError(t, db.Model(&model.SiteVisit{}).Count(&count).Error)
				assert.EqualValues(t, 5, count)
			}
			require.NoError(t, db.Migrator().DropTable(&model.SiteVisit{}, &releasedVisitOption{}))
		})
	}
}

func TestSiteVisitAccessAndMetadata(t *testing.T) {
	admin, _ := setupAccessTokenAudit(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SiteVisit{}))
	_, adminToken := createAccessTokenTestSession(t, admin.Id, "visit-admin")
	user := model.User{Username: "visitor", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "visitor"}
	require.NoError(t, model.DB.Create(&user).Error)
	_, userToken := createAccessTokenTestSession(t, user.Id, "visit-user")
	router := gin.New()
	router.POST("/api/site-visits", middleware.TryUserAuth(), RecordSiteVisit)
	router.GET("/api/site-visits", middleware.AdminAuth(), GetSiteVisits)
	now := time.Now().Unix()
	query := "/api/site-visits?start=invalid"
	// Use actual timestamps; unauthenticated requests must fail before parsing filters.
	for _, token := range []string{"", userToken, "invalid-token"} {
		response := accessTokenRequest(router, http.MethodGet, query, token, "", "")
		assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, response.Code)
	}
	body := `{"page":"/dashboard","visitor":"11111111-1111-4111-8111-111111111111","session":"22222222-2222-4222-8222-222222222222","referrer":"https://search.example/path?token=secret#secret","language":"zh-CN","user_id":999}`
	response := accessTokenRequest(router, http.MethodPost, "/api/site-visits", userToken, "", body)
	require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
	var visit model.SiteVisit
	require.NoError(t, model.DB.First(&visit).Error)
	assert.Equal(t, user.Id, visit.UserID)
	assert.Equal(t, "search.example", visit.Referrer)
	assert.Equal(t, "visitor", visit.Username)
	encoded, err := common.Marshal(visit)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "11111111")
	assert.NotContains(t, string(encoded), "secret")
	for _, page := range []string{"/dashboard?token=secret", "/chat/private-chat-id", "/dashboard#secret", "https://evil.example"} {
		response = accessTokenRequest(router, http.MethodPost, "/api/site-visits", userToken, "", strings.Replace(body, "/dashboard", page, 1))
		assert.Equal(t, http.StatusBadRequest, response.Code)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/site-visits", strings.NewReader(body))
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusForbidden, response.Code)
	query = fmt.Sprintf("/api/site-visits?start=%d&end=%d", now-86400, now+60)
	response = accessTokenRequest(router, http.MethodGet, query, adminToken, "", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Contains(t, response.Body.String(), `"pv":1`)
	response = accessTokenRequest(router, http.MethodGet, query+"&page=0", adminToken, "", "")
	assert.Equal(t, http.StatusBadRequest, response.Code)
	for _, status := range []string{model.UserSessionStatusRevoked, model.UserSessionStatusActive} {
		updates := map[string]any{"status": status, "expires_at": now + 3600}
		if status == model.UserSessionStatusActive {
			updates["expires_at"] = now - 1
		}
		require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", "visit-admin").Updates(updates).Error)
		response = accessTokenRequest(router, http.MethodGet, query, adminToken, "", "")
		assert.Equal(t, http.StatusUnauthorized, response.Code)
	}
}
