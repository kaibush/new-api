package service

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func StartCheckinStatsCleanup() {
	go func() {
		time.Sleep(30 * time.Second)
		for {
			if err := model.CleanupCheckinStats(); err != nil {
				common.SysError("check-in statistics cleanup failed: " + err.Error())
			}
			time.Sleep(time.Hour)
		}
	}()
}
