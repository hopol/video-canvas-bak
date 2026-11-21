package service_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

// TestDramaMediaIntegration_ConcurrentSegments 验证同一集的不同片段可以同时提交视频，同一片段并发提交只接受一个。
func TestDramaMediaIntegration_ConcurrentSegments(t *testing.T) {
	// 排队上限放宽到 5：同集两段 + 另一集一段同时在排队
	e := newGTIEnv(t, &fakeLimits{initial: 50, defMax: 5})
	if err := e.db.AutoMigrate(&model.DramaProject{}, &model.DramaEpisode{}, &model.DramaSegment{}, &model.DramaJob{}); err != nil {
		t.Fatal(err)
	}
	p := model.DramaProject{UserID: e.user, CanvasID: 7, Title: "并行测试", SourceText: "原文", StyleKey: "custom"}
	if err := e.db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	ep := model.DramaEpisode{UserID: e.user, DramaID: p.ID, No: 1, LockedAt: &now}
	if err := e.db.Create(&ep).Error; err != nil {
		t.Fatal(err)
	}
	segments := []model.DramaSegment{{UserID: e.user, EpisodeID: ep.ID, Seq: 0}, {UserID: e.user, EpisodeID: ep.ID, Seq: 1}}
	if err := e.db.Create(&segments).Error; err != nil {
		t.Fatal(err)
	}
	// submit 让每个片段各发一次请求，同时出发，返回各自的错误
	submit := func(rows []model.DramaSegment, prefix string) []error {
		start := make(chan struct{})
		errs := make([]error, len(rows))
		var wg sync.WaitGroup
		for i, row := range rows {
			wg.Add(1)
			go func(i int, row model.DramaSegment) {
				defer wg.Done()
				<-start
				req := validCreateReq()
				req.NodeID = "seg:" + idcodec.Encode(row.ID)
				req.CanvasID = 7
				_, errs[i] = createSingle(context.Background(), e.svc, e.user, prefix+idcodec.Encode(uint64(i+1)), req)
			}(i, row)
		}
		close(start)
		wg.Wait()
		return errs
	}
	for i, err := range submit(segments, "media-") {
		if err != nil {
			t.Fatalf("同一集的片段 %d 应能并行提交: %v", i, err)
		}
	}
	// 同一片段已有进行中的视频，再提交（并发两次）都要拒绝
	for _, err := range submit([]model.DramaSegment{segments[0], segments[0]}, "again-") {
		assertTaskCode(t, err, errcode.ErrDramaJobBusy.Code)
	}
	// 已排队的视频不应被自动规划阻塞，也不能被同集零费用合成绕过。
	dramaSvc := service.NewDramaService(service.DramaDeps{Repo: repository.NewDramaRepository(e.db)})
	_, err := dramaSvc.CreateJob(context.Background(), e.user, p.ID, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	assertTaskCode(t, err, 67004)
	ep2 := model.DramaEpisode{UserID: e.user, DramaID: p.ID, No: 2, LockedAt: &now}
	if err := e.db.Create(&ep2).Error; err != nil {
		t.Fatal(err)
	}
	other := model.DramaSegment{UserID: e.user, EpisodeID: ep2.ID, Seq: 0}
	if err := e.db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	req := validCreateReq()
	req.NodeID = "seg:" + idcodec.Encode(other.ID)
	if _, err := createSingle(context.Background(), e.svc, e.user, "other-episode", req); err != nil {
		t.Fatalf("不同集应能并行: %v", err)
	}
}
