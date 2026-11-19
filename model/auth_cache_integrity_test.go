package model

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Run against an isolated Redis node with cluster mode enabled and all slots
// assigned. Redis itself rejects cross-slot Lua and MGET operations.
func TestAuthCacheRedisCluster(t *testing.T) {
	address := os.Getenv("TEST_REDIS_CLUSTER_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_CLUSTER_ADDR is not configured")
	}
	previousRedis, previousEnabled := common.RDB, common.RedisEnabled
	client := redis.NewClient(&redis.Options{Addr: address})
	common.RDB, common.RedisEnabled = client, true
	t.Cleanup(func() {
		common.RDB, common.RedisEnabled = previousRedis, previousEnabled
		assert.NoError(t, client.Close())
	})
	info, err := client.ClusterInfo(t.Context()).Result()
	require.NoError(t, err)
	require.Contains(t, info, "cluster_state:ok")
	user := User{Id: 81001, Username: "cluster-cache", Group: "default", AuthVersion: 1, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 100}
	token := Token{Id: 81001, UserId: user.Id, Key: "cluster-cache-test-token", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 100}
	keys := []string{getUserCacheKey(user.Id), getUserAuthFenceKey(user.Id), getUserAuthVersionKey(user.Id), getTokenCacheKey(token.Key), getTokenCacheFenceKey(token.Key)}
	for _, key := range keys {
		require.NoError(t, client.Del(t.Context(), key).Err())
	}
	t.Cleanup(func() {
		for _, key := range keys {
			assert.NoError(t, client.Del(context.Background(), key).Err())
		}
	})
	require.NoError(t, populateUserCache(user))
	cachedUser, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, user.Role, cachedUser.Role)
	_, err = cacheInitToken(token)
	require.NoError(t, err)
	result, err := cacheTryReserveTokenQuota(token.Id, token.Key, 30)
	require.NoError(t, err)
	assert.Equal(t, cacheQuotaOK, result)
	cachedToken, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 70, cachedToken.RemainQuota)
	require.NoError(t, SetUserAuthVersionFence(user.Id, 2))
	_, err = cacheGetUserBase(user.Id)
	assert.ErrorIs(t, err, ErrUserAuthCachePending)
	require.NoError(t, invalidateTokenCacheForMutation(token.Key))
	_, err = cacheGetTokenByKey(token.Key)
	assert.Error(t, err)
	initResult, err := cacheInitToken(token)
	require.NoError(t, err)
	assert.Zero(t, initResult, "an active mutation fence must reject stale snapshots")
}

func TestAuthCacheIntegrityDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
				assert.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&User{}, &Token{}, &UserSession{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			useUserCacheMiniRedis(t)

			user := User{Username: "cache-integrity-user", AffCode: "cache-int", Role: common.RoleCommonUser,
				Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default", Quota: 100}
			require.NoError(t, DB.Create(&user).Error)
			t.Cleanup(func() { assert.NoError(t, db.Unscoped().Delete(&user).Error) })
			require.NoError(t, populateUserCache(user))
			quotaResult, err := cacheApplyUserQuotaDelta(user.Id, -70)
			require.NoError(t, err)
			require.Equal(t, cacheQuotaOK, quotaResult)

			t.Run("user_metadata_and_partial_refresh", func(t *testing.T) {
				for _, fields := range []map[string]any{
					{"Role": common.RoleRootUser},
					{"AuthVersion": 99, "Status": common.UserStatusDisabled},
					{"Group": "admin", "Setting": `{"language":"evil"}`},
				} {
					require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), fields).Err())
					_, err := cacheGetUserBase(user.Id)
					require.Error(t, err)
					// The version fence intentionally rejects snapshots below a cached version.
					if _, ok := fields["AuthVersion"]; ok {
						require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), "AuthVersion", user.AuthVersion).Err())
					}
					loaded, err := GetUserCache(user.Id)
					require.NoError(t, err)
					assert.Equal(t, user.Role, loaded.Role)
					assert.Equal(t, user.Group, loaded.Group)
					assert.Equal(t, user.Status, loaded.Status)
					cached, err := cacheGetUserBase(user.Id)
					require.NoError(t, err)
					assert.Equal(t, 30, cached.Quota)
				}
				require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), "Role", common.RoleRootUser).Err())
				require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("group", "paid").Error)
				require.NoError(t, RefreshUserGroupCache(user.Id))
				cached, err := cacheGetUserBase(user.Id)
				require.NoError(t, err)
				assert.Equal(t, common.RoleCommonUser, cached.Role)
				assert.Equal(t, "paid", cached.Group)
				assert.Equal(t, 30, cached.Quota)
			})

			allowIPs := "192.168.0.0/16"
			token := Token{UserId: user.Id, Key: "cache-integrity-token", Status: common.TokenStatusEnabled,
				ExpiredTime: -1, RemainQuota: 100, ModelLimitsEnabled: true, ModelLimits: "allowed-model",
				AllowIps: &allowIPs, Group: "auto", AutoGroups: `["default"]`}
			require.NoError(t, DB.Create(&token).Error)
			t.Cleanup(func() { assert.NoError(t, db.Unscoped().Delete(&token).Error) })
			_, err = GetTokenByKey(token.Key, false)
			require.NoError(t, err)
			quotaResult, err = cacheTryReserveTokenQuota(token.Id, token.Key, 70)
			require.NoError(t, err)
			require.Equal(t, cacheQuotaOK, quotaResult)

			t.Run("token_identity_and_permissions", func(t *testing.T) {
				for _, fields := range []map[string]any{
					{"UserId": user.Id + 1},
					{"UnlimitedQuota": "true"},
					{"ModelLimitsEnabled": "false", "ModelLimits": "", "AllowIps": ""},
					{"Group": "privileged", "AutoGroups": `["privileged"]`, "CrossGroupRetry": "true"},
					{"Status": common.TokenStatusDisabled, "ExpiredTime": 1},
					{"UnlimitedQuota": "garbage"},
					{"DeletedAt": time.Now().Format(time.RFC3339)},
				} {
					require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), fields).Err())
					_, err := cacheGetTokenByKey(token.Key)
					require.Error(t, err)
					_, err = GetTokenByKey(token.Key, false)
					require.NoError(t, err)
					cached, err := cacheGetTokenByKey(token.Key)
					require.NoError(t, err)
					assert.Equal(t, token.UserId, cached.UserId)
					assert.False(t, cached.UnlimitedQuota)
					assert.True(t, cached.ModelLimitsEnabled)
					assert.Equal(t, token.ModelLimits, cached.ModelLimits)
					assert.Equal(t, token.AllowIps, cached.AllowIps)
					assert.Equal(t, token.Group, cached.Group)
					assert.Equal(t, token.AutoGroups, cached.AutoGroups)
					assert.False(t, cached.CrossGroupRetry)
					assert.Equal(t, token.Status, cached.Status)
					assert.Equal(t, token.ExpiredTime, cached.ExpiredTime)
					assert.Equal(t, 30, cached.RemainQuota)
					assert.Equal(t, 70, cached.UsedQuota)
					assert.Positive(t, cached.AccessedTime)
				}
			})

			session := newTestUserSession("cache-integrity-session", user.Id, time.Now().Unix())
			require.NoError(t, CreateUserSession(session))
			t.Cleanup(func() { assert.NoError(t, db.Delete(session).Error) })
			t.Run("session_owner_and_versions", func(t *testing.T) {
				require.NoError(t, common.RDB.HSet(t.Context(), userSessionCacheKey(session.SID),
					"UserID", user.Id+1, "Version", 2, "UserAuthVersion", 2, "ExpiresAt", session.ExpiresAt+3600).Err())
				_, err := getUserSessionCache(session.SID)
				require.Error(t, err)
				// A higher cached version is a deny fence for delayed active snapshots.
				require.NoError(t, common.RDB.HSet(t.Context(), userSessionCacheKey(session.SID), "Version", 1).Err())
				loaded, err := GetUserSessionCached(session.SID)
				require.NoError(t, err)
				assert.Equal(t, session.UserID, loaded.UserID)
				assert.Equal(t, session.UserAuthVersion, loaded.UserAuthVersion)
				assert.Equal(t, session.ExpiresAt, loaded.ExpiresAt)
			})

			t.Run("unsigned_and_expired_cache", func(t *testing.T) {
				for _, key := range []string{getUserCacheKey(user.Id), getTokenCacheKey(token.Key), userSessionCacheKey(session.SID)} {
					require.NoError(t, common.RDB.HDel(t.Context(), key, "CacheMAC", "CacheExpiresAt").Err())
				}
				_, err := GetUserCache(user.Id)
				require.NoError(t, err)
				_, err = GetTokenByKey(token.Key, false)
				require.NoError(t, err)
				_, err = GetUserSessionCached(session.SID)
				require.NoError(t, err)
				cachedUser, err := cacheGetUserBase(user.Id)
				require.NoError(t, err)
				cachedToken, err := cacheGetTokenByKey(token.Key)
				require.NoError(t, err)
				cachedSession, err := getUserSessionCache(session.SID)
				require.NoError(t, err)
				expired := time.Now().Add(-time.Second).UnixMilli()
				cachedUser.CacheExpiresAt = expired
				cachedToken.CacheExpiresAt = expired
				cachedSession.CacheExpiresAt = expired
				userMAC, err := cachedUser.cacheMAC()
				require.NoError(t, err)
				tokenMAC, err := cachedToken.cacheMAC()
				require.NoError(t, err)
				sessionMAC, err := authCacheMAC(userSessionCacheKey(session.SID), cachedSession)
				require.NoError(t, err)
				for key, mac := range map[string]string{getUserCacheKey(user.Id): userMAC, getTokenCacheKey(token.Key): tokenMAC, userSessionCacheKey(session.SID): sessionMAC} {
					require.NoError(t, common.RDB.HSet(t.Context(), key, "CacheExpiresAt", expired, "CacheMAC", mac).Err())
					require.NoError(t, common.RDB.Persist(t.Context(), key).Err())
				}
				_, err = cacheGetUserBase(user.Id)
				assert.Error(t, err)
				_, err = cacheGetTokenByKey(token.Key)
				assert.Error(t, err)
				_, err = getUserSessionCache(session.SID)
				assert.Error(t, err)
				_, err = GetUserCache(user.Id)
				require.NoError(t, err)
				_, err = GetTokenByKey(token.Key, false)
				require.NoError(t, err)
				_, err = GetUserSessionCached(session.SID)
				require.NoError(t, err)
			})

			t.Run("repair_during_quota_reservation", func(t *testing.T) {
				require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), "CacheMAC", "invalid").Err())
				snapshotRead := make(chan struct{})
				releaseRepair := make(chan struct{}, 1)
				defer close(releaseRepair)
				var intercepted atomic.Bool
				require.NoError(t, DB.Callback().Query().After("gorm:query").Register("auth_cache_quota_race", func(tx *gorm.DB) {
					if tx.Statement.Table == "tokens" && intercepted.CompareAndSwap(false, true) {
						close(snapshotRead)
						<-releaseRepair
					}
				}))
				t.Cleanup(func() { assert.NoError(t, DB.Callback().Query().Remove("auth_cache_quota_race")) })
				done := make(chan error, 1)
				go func() {
					_, err := GetTokenByKey(token.Key, false)
					done <- err
				}()
				<-snapshotRead
				result, err := cacheTryReserveTokenQuota(token.Id, token.Key, 10)
				require.NoError(t, err)
				require.Equal(t, cacheQuotaOK, result)
				releaseRepair <- struct{}{}
				require.NoError(t, <-done)
				cached, err := cacheGetTokenByKey(token.Key)
				require.NoError(t, err)
				assert.Equal(t, 20, cached.RemainQuota)
				assert.Equal(t, 80, cached.UsedQuota)
			})

			t.Run("cross_identity_copy_and_database_failure", func(t *testing.T) {
				for source, destination := range map[string]string{
					getUserCacheKey(user.Id):         getUserCacheKey(user.Id + 1000),
					getTokenCacheKey(token.Key):      getTokenCacheKey("unknown-token"),
					userSessionCacheKey(session.SID): userSessionCacheKey("unknown-session"),
				} {
					fields, err := common.RDB.HGetAll(t.Context(), source).Result()
					require.NoError(t, err)
					require.NoError(t, common.RDB.HSet(t.Context(), destination, fields).Err())
				}
				require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id+1000), "Id", user.Id+1000).Err())
				require.NoError(t, common.RDB.HSet(t.Context(), userSessionCacheKey("unknown-session"), "SID", "unknown-session").Err())
				_, err := GetUserCache(user.Id + 1000)
				assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
				_, err = GetTokenByKey("unknown-token", false)
				assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
				_, err = GetUserSessionCached("unknown-session")
				assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
				require.NoError(t, DB.Callback().Query().Before("gorm:query").Register("auth_cache_db_failure", func(tx *gorm.DB) {
					tx.AddError(errors.New("database unavailable"))
				}))
				defer func() { require.NoError(t, DB.Callback().Query().Remove("auth_cache_db_failure")) }()
				_, err = GetTokenByKey(token.Key, false)
				require.NoError(t, err, "valid token cache must not query the database")
				_, err = GetUserSessionCached(session.SID)
				require.NoError(t, err, "valid session cache must not query the database")
				require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), "CacheMAC", "invalid").Err())
				require.NoError(t, common.RDB.HSet(t.Context(), userSessionCacheKey(session.SID), "CacheMAC", "invalid").Err())
				_, err = GetTokenByKey(token.Key, false)
				assert.Error(t, err)
				_, err = GetUserSessionCached(session.SID)
				assert.Error(t, err)
			})

			t.Run("session_revocation_cannot_be_cleared", func(t *testing.T) {
				revoked, err := RevokeUserSession(user.Id, session.SID, "test")
				require.NoError(t, err)
				require.True(t, revoked)
				require.NoError(t, common.RDB.HSet(t.Context(), userSessionCacheKey(session.SID),
					"Status", UserSessionStatusActive, "RevokedAt", 0, "RevokedReason", "").Err())
				_, err = GetUserSessionCached(session.SID)
				assert.ErrorIs(t, err, ErrUserSessionInactive)
			})

			t.Run("unreadable_quota_counters", func(t *testing.T) {
				require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), "Quota", "garbage").Err())
				require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), "RemainQuota", "garbage").Err())
				_, err := GetUserCache(user.Id)
				require.NoError(t, err)
				_, err = GetTokenByKey(token.Key, false)
				require.NoError(t, err)
				cachedUser, err := cacheGetUserBase(user.Id)
				require.NoError(t, err)
				assert.Equal(t, user.Quota, cachedUser.Quota)
				cachedToken, err := cacheGetTokenByKey(token.Key)
				require.NoError(t, err)
				assert.Equal(t, token.RemainQuota, cachedToken.RemainQuota)
				assert.Equal(t, 80, cachedToken.UsedQuota)
			})
		})
	}
}
