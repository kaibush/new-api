package model

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// Redemption schema from v1.0.0-rc.42, the latest release at implementation.
type releasedPacketRedemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"`
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"`
}

func TestCommunityRedPacketDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "packets.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				// Match chooseDB: startup migrations run without pgx's statement cache.
				driver = postgres.New(postgres.Config{DSN: os.Getenv("TEST_POSTGRES_DSN"), PreferSimpleProtocol: true})
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "packet_test_"}, Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)
			previousDB, previousLog, previousType := DB, LOG_DB, common.MainDatabaseType()
			previousSettings := *operation_setting.GetPaymentSetting()
			operation_setting.GetPaymentSetting().MonthlyTopUpLimitEnabled = false
			DB, LOG_DB = db, db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				DB, LOG_DB = previousDB, previousLog
				common.SetMainDatabaseType(previousType)
				initCol()
				*operation_setting.GetPaymentSetting() = previousSettings
				assert.NoError(t, sqlDB.Close())
			})
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade_%t", upgrade), func(t *testing.T) {
					models := []any{&User{}, &Redemption{}, &CommunityMessage{}, &CommunityProfile{}, &CommunityRedPacket{}, &CommunityRedPacketItem{}, &Log{}, &TopUp{}, &Option{}}
					require.NoError(t, db.Migrator().DropTable(models...))
					t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(models...)) })
					if upgrade {
						table := db.NamingStrategy.TableName("redemptions")
						require.NoError(t, db.Table(table).AutoMigrate(&releasedPacketRedemption{}))
						require.NoError(t, db.Table(table).Create(&releasedPacketRedemption{Id: 700, Key: "00000000000000000000000000000700", Name: "released credit", Quota: 700}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(models...))
					}
					if upgrade {
						var saved Redemption
						require.NoError(t, db.First(&saved, 700).Error)
						assert.Equal(t, "released credit", saved.Name)
						assert.Equal(t, 700, saved.Quota)
						assert.Nil(t, saved.RedPacketID)
						assert.Error(t, db.Create(&Redemption{Key: saved.Key, Name: "duplicate"}).Error)
					}
					users := []User{{Username: "sender", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}, {Username: "alice", Status: common.UserStatusEnabled}, {Username: "bob", Status: common.UserStatusEnabled}, {Username: "carol", Status: common.UserStatusEnabled}, {Username: "dave", Status: common.UserStatusEnabled}}
					for i := range users {
						users[i].AffCode = fmt.Sprintf("packet%d", i)
						require.NoError(t, db.Create(&users[i]).Error)
					}
					codes := []Redemption{{Key: "11111111111111111111111111111111", Name: "first", Quota: 100}, {Key: "22222222222222222222222222222222", Name: "second", Quota: 200}, {Key: "33333333333333333333333333333333", Name: "expiry", Quota: 300}}
					for i := range codes {
						require.NoError(t, codes[i].Insert())
					}
					for _, input := range [][]string{nil, {codes[0].Key, codes[0].Key}, {"bad"}, {codes[0].Key, "44444444444444444444444444444444"}} {
						_, err := CreateCommunityRedPacket(users[0].Id, "hello", input)
						require.ErrorIs(t, err, ErrRedPacketCodes)
					}
					_, err := CreateCommunityRedPacket(users[1].Id, "forbidden", []string{codes[0].Key})
					require.ErrorIs(t, err, ErrRedPacketUnavailable)
					var total int64
					require.NoError(t, db.Model(&CommunityMessage{}).Count(&total).Error)
					assert.Zero(t, total)
					packet, err := CreateCommunityRedPacket(users[0].Id, "Good luck", []string{codes[0].Key, codes[1].Key})
					require.NoError(t, err)
					var message CommunityMessage
					require.NoError(t, db.First(&message, packet.ID).Error)
					assert.Equal(t, "red_packet", message.Kind)
					assert.Equal(t, "Good luck", message.Text)
					_, err = CreateCommunityRedPacket(users[0].Id, "duplicate", []string{codes[0].Key})
					require.ErrorIs(t, err, ErrRedPacketCodes)
					_, err = Redeem(codes[0].Key, users[1].Id)
					require.ErrorIs(t, err, ErrRedeemFailed)
					require.NoError(t, ClaimCommunityRedPacket(packet.ID, users[1].Id))
					var wg sync.WaitGroup
					results := make(chan error, 3)
					for i := range 3 {
						wg.Go(func() { results <- ClaimCommunityRedPacket(packet.ID, users[i+2].Id) })
					}
					wg.Wait()
					close(results)
					success := 0
					for result := range results {
						if result == nil {
							success++
						}
					}
					assert.Equal(t, 1, success, "only one remaining code may be assigned")
					require.NoError(t, ClaimCommunityRedPacket(packet.ID, users[1].Id))
					detail, err := GetCommunityRedPacket(packet.ID, users[1].Id)
					require.NoError(t, err)
					assert.Len(t, detail.Records, 2)
					assert.Equal(t, 2, detail.Claimed)
					assert.Equal(t, codes[0].Key, detail.MyCode)
					public, err := GetCommunityRedPacket(packet.ID, users[0].Id)
					require.NoError(t, err)
					payload, err := common.Marshal(public)
					require.NoError(t, err)
					for _, code := range codes {
						assert.NotContains(t, string(payload), code.Key)
					}
					_, err = Redeem(detail.MyCode, users[0].Id)
					require.ErrorIs(t, err, ErrRedeemFailed)
					quota, err := Redeem(detail.MyCode, users[1].Id)
					require.NoError(t, err)
					assert.Equal(t, 100, quota)
					_, err = Redeem(detail.MyCode, users[1].Id)
					require.ErrorIs(t, err, ErrRedeemFailed)
					var alice User
					require.NoError(t, db.First(&alice, users[1].Id).Error)
					assert.Equal(t, 100, alice.Quota)
					locked, err := GetRedemptionById(codes[1].Id)
					require.NoError(t, err)
					locked.Quota = 999
					require.Error(t, locked.Update())
					require.Error(t, locked.Delete())
					deleted, err := BatchDeleteRedemptions([]int{codes[1].Id})
					require.NoError(t, err)
					assert.Zero(t, deleted)
					expiring, err := CreateCommunityRedPacket(users[0].Id, "expiry", []string{codes[2].Key})
					require.NoError(t, err)
					require.NoError(t, db.Model(&CommunityMessage{}).Where("id = ?", expiring.ID).Update("deleted", true).Error)
					require.ErrorIs(t, ClaimCommunityRedPacket(expiring.ID, users[1].Id), ErrRedPacketUnavailable)
					visible, err := ListCommunityRedPackets(0)
					require.NoError(t, err)
					require.Len(t, visible, 1)
					assert.Equal(t, packet.ID, visible[0].ID)
					moderated, err := GetCommunityRedPacket(expiring.ID, users[1].Id)
					require.NoError(t, err)
					assert.True(t, moderated.Deleted)
					assert.Empty(t, moderated.Greeting)
					require.NoError(t, db.Model(&CommunityMessage{}).Where("id = ?", expiring.ID).Update("deleted", false).Error)
					require.NoError(t, db.Model(&expiring).Update("expires_at", time.Now().Unix()-1).Error)
					require.ErrorIs(t, ClaimCommunityRedPacket(expiring.ID, users[1].Id), ErrRedPacketUnavailable)
					_, err = Redeem(codes[2].Key, users[0].Id)
					require.NoError(t, err, "unclaimed codes return to ordinary redemption after expiry")
					for range 2 {
						require.NoError(t, db.AutoMigrate(models...))
					}
					after, err := GetCommunityRedPacket(packet.ID, users[1].Id)
					require.NoError(t, err)
					assert.Equal(t, detail.MyCode, after.MyCode)
					assert.Len(t, after.Records, 2)
					assert.True(t, after.Redeemed)
				})
			}
		})
	}
}
