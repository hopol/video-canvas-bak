package repository_test

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"

	"gorm.io/gorm"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

// 本文件是拆分镜任务仓储的集成测试，连 TEST_DATABASE_DSN 里的独立 schema；未设置时跳过。

func splitTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	return isolatedDB(t, &model.User{}, &model.UserCredit{}, &model.CreditLedger{}, &model.CanvasProject{}, &model.StoryboardSplitJob{})
}

// splitEnqueuer 记录入队的任务 id；fail 非空时入队失败，用来验证事务整体回滚。
type splitEnqueuer struct {
	mu   sync.Mutex
	ids  []uint64
	fail error
}

func (e *splitEnqueuer) EnqueueStoryboardSplitTx(_ context.Context, tx *sql.Tx, id uint64) error {
	if tx == nil {
		return errors.New("入队必须带事务")
	}
	if e.fail != nil {
		return e.fail
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.ids = append(e.ids, id)
	return nil
}

func newSplitJob(canvas uint64, node string) *model.StoryboardSplitJob {
	return &model.StoryboardSplitJob{UserID: 7, CanvasID: canvas, NodeID: node, ModelKey: "m", Script: "剧本", Status: model.SplitJobPending}
}

// create 在事务里建任务。
func createSplit(t *testing.T, r *repository.StoryboardRepository, job *model.StoryboardSplitJob) error {
	t.Helper()
	return r.WithTx(context.Background(), func(tx repository.StoryboardTx) error {
		return tx.CreateSplitJob(context.Background(), job)
	})
}

// TestStoryboardSplitJob_CreateEnqueuesInSameTx 建任务和入队在同一个事务：入队失败时任务行一并回滚，不留孤儿任务。
func TestStoryboardSplitJob_CreateEnqueuesInSameTx(t *testing.T) {
	db := splitTestDB(t)
	enq := &splitEnqueuer{}
	r := repository.NewStoryboardRepository(db)
	r.SetEnqueuer(enq)

	job := newSplitJob(1, "n1")
	if err := createSplit(t, r, job); err != nil {
		t.Fatalf("建任务: %v", err)
	}
	if job.ID == 0 || len(enq.ids) != 1 || enq.ids[0] != job.ID {
		t.Fatalf("应带着任务 id 入队：job=%d ids=%v", job.ID, enq.ids)
	}

	enq.fail = errors.New("队列挂了")
	bad := newSplitJob(2, "n2")
	if err := createSplit(t, r, bad); err == nil {
		t.Fatal("入队失败应让建任务失败")
	}
	var n int64
	db.Model(&model.StoryboardSplitJob{}).Where("canvas_id = ?", 2).Count(&n)
	if n != 0 {
		t.Errorf("入队失败，任务行应一起回滚，实际 %d 行", n)
	}
}

// TestStoryboardSplitJob_OnlyOneActivePerNode 同画布同节点同时只允许一条进行中的任务（部分唯一索引）；
// 终态之后能再建；别的节点、别的画布互不影响。
func TestStoryboardSplitJob_OnlyOneActivePerNode(t *testing.T) {
	db := splitTestDB(t)
	r := repository.NewStoryboardRepository(db)
	r.SetEnqueuer(&splitEnqueuer{})

	first := newSplitJob(1, "n1")
	if err := createSplit(t, r, first); err != nil {
		t.Fatal(err)
	}
	if err := createSplit(t, r, newSplitJob(1, "n1")); !errors.Is(err, repository.ErrSplitJobBusy) {
		t.Fatalf("同节点第二条应报 busy，实际 %v", err)
	}
	if err := createSplit(t, r, newSplitJob(1, "n2")); err != nil {
		t.Errorf("别的节点应能建：%v", err)
	}
	if err := createSplit(t, r, newSplitJob(2, "n1")); err != nil {
		t.Errorf("别的画布应能建：%v", err)
	}

	// running 也算进行中
	err := r.WithTx(context.Background(), func(tx repository.StoryboardTx) error {
		return tx.UpdateSplitJob(context.Background(), first.ID, map[string]any{"status": model.SplitJobRunning})
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := createSplit(t, r, newSplitJob(1, "n1")); !errors.Is(err, repository.ErrSplitJobBusy) {
		t.Fatalf("running 时也应拦住，实际 %v", err)
	}

	// 终态之后同一个节点能再拆
	for _, st := range []string{model.SplitJobSucceeded, model.SplitJobFailed} {
		if err := r.WithTx(context.Background(), func(tx repository.StoryboardTx) error {
			return tx.UpdateSplitJob(context.Background(), first.ID, map[string]any{"status": st})
		}); err != nil {
			t.Fatal(err)
		}
		next := newSplitJob(1, "n1")
		if err := createSplit(t, r, next); err != nil {
			t.Fatalf("%s 之后应能再建：%v", st, err)
		}
		first = next
	}
}

// TestStoryboardSplitJob_ActiveAndByID 补查：按节点查进行中的任务，只看自己的；按 id 读，别人的当不存在。
func TestStoryboardSplitJob_ActiveAndByID(t *testing.T) {
	db := splitTestDB(t)
	r := repository.NewStoryboardRepository(db)
	r.SetEnqueuer(&splitEnqueuer{})
	job := newSplitJob(1, "n1")
	if err := createSplit(t, r, job); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	got, err := r.ActiveSplitJob(ctx, 7, 1, "n1")
	if err != nil || got.ID != job.ID {
		t.Fatalf("应查到进行中的任务：%v %v", got, err)
	}
	if _, err := r.ActiveSplitJob(ctx, 8, 1, "n1"); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("别人的任务不该查到：%v", err)
	}
	if _, err := r.ActiveSplitJob(ctx, 7, 1, "other"); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("别的节点没有进行中的任务：%v", err)
	}
	if _, err := r.SplitJobByID(ctx, 8, job.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("按 id 读别人的任务应当不存在：%v", err)
	}
	if got, err := r.SplitJobByID(ctx, 7, job.ID); err != nil || got.Status != model.SplitJobPending {
		t.Errorf("按 id 读自己的：%v %v", got, err)
	}

	// 结束后不再是「进行中」
	_ = r.WithTx(ctx, func(tx repository.StoryboardTx) error {
		return tx.UpdateSplitJob(ctx, job.ID, map[string]any{"status": model.SplitJobSucceeded})
	})
	if _, err := r.ActiveSplitJob(ctx, 7, 1, "n1"); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("结束的任务不该出现在进行中里：%v", err)
	}
}

// TestStoryboardSplitJob_ForUpdateSerializesWorkers 行锁读：两个实例同时抢同一个任务，只有一个把它从 pending 改成 running。
func TestStoryboardSplitJob_ForUpdateSerializesWorkers(t *testing.T) {
	db := splitTestDB(t)
	r := repository.NewStoryboardRepository(db)
	r.SetEnqueuer(&splitEnqueuer{})
	job := newSplitJob(1, "n1")
	if err := createSplit(t, r, job); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = r.WithTx(context.Background(), func(tx repository.StoryboardTx) error {
				j, err := tx.SplitJobForUpdate(context.Background(), job.ID)
				if err != nil {
					return err
				}
				if j.Status != model.SplitJobPending {
					return nil
				}
				mu.Lock()
				won++
				mu.Unlock()
				return tx.UpdateSplitJob(context.Background(), job.ID, map[string]any{"status": model.SplitJobRunning})
			})
		}()
	}
	wg.Wait()
	if won != 1 {
		t.Fatalf("8 个并发里应只有 1 个抢到任务，实际 %d", won)
	}
}

// TestStoryboardSplitJob_ResultRoundTrip 成功时的镜头、积分原样存取。
func TestStoryboardSplitJob_ResultRoundTrip(t *testing.T) {
	db := splitTestDB(t)
	r := repository.NewStoryboardRepository(db)
	r.SetEnqueuer(&splitEnqueuer{})
	job := newSplitJob(1, "n1")
	if err := createSplit(t, r, job); err != nil {
		t.Fatal(err)
	}
	shots := []byte(`[{"scene":"月夜瓜地","shot":"远景","camera":"摇","action":"","dialogue":"","duration":5}]`)
	if err := r.WithTx(context.Background(), func(tx repository.StoryboardTx) error {
		return tx.UpdateSplitJob(context.Background(), job.ID, map[string]any{"status": model.SplitJobSucceeded, "shots": shots, "credits": 5, "script": ""})
	}); err != nil {
		t.Fatal(err)
	}
	got, err := r.SplitJobByID(context.Background(), 7, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SplitJobSucceeded || got.Credits != 5 || got.Script != "" || string(got.Shots) == "" {
		t.Fatalf("终态不对：%+v", got)
	}
}
