package service

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/model"
)

type databaseCleanupHandler struct{}

func (databaseCleanupHandler) Type() string { return model.SystemTaskTypeDatabaseCleanup }

func init() {
	RegisterSystemTaskHandler(databaseCleanupHandler{})
}

func (databaseCleanupHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var snapshot model.DatabaseCleanupSnapshot
	if err := task.DecodePayload(&snapshot); err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	remaining, err := model.CountDatabaseCleanup(ctx, snapshot)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	state := LogCleanupState{Total: remaining, Remaining: remaining}
	for {
		state.Progress = logCleanupProgress(state.Processed, state.Total)
		if err := model.UpdateSystemTaskState(task.TaskID, runnerID, state); err != nil {
			logSystemTaskLockError(ctx, task, err)
			return
		}
		if state.Remaining == 0 {
			break
		}
		// A slow or blocked statement cannot monopolize the maintenance worker.
		batchContext, cancel := context.WithTimeout(ctx, 5*time.Second)
		deleted, err := model.DeleteDatabaseCleanupBatch(batchContext, snapshot)
		cancel()
		if err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		state.Processed += deleted
		state.Remaining = max(0, state.Remaining-deleted)
		if deleted == 0 || state.Remaining == 0 {
			state.Remaining, err = model.CountDatabaseCleanup(ctx, snapshot)
			if err != nil {
				failSystemTask(task, runnerID, err)
				return
			}
			if deleted == 0 && state.Remaining > 0 {
				failSystemTask(task, runnerID, errors.New("No eligible rows were deleted. Preview the cleanup again."))
				return
			}
			state.Total = state.Processed + state.Remaining
		}
		// Yield between small writes so regular gateway traffic keeps database
		// capacity. A lost task lease cancels before the next batch.
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, LogCleanupResult{DeletedCount: state.Processed}, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
