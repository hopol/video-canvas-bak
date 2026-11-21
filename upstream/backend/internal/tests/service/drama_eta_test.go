package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"video-canvas/internal/model"
)

// 研读 / 规划中，详情带上预计耗时的原料：该模型两个步骤的历史中位耗时和剩余批次数。
func TestDramaGetReportsPlanningEta(t *testing.T) {
	r := newDramaMemory()
	seedDramaDraft(r, "第1章 开始\n"+strings.Repeat("原文。", 200)+"\n第2章 结尾\n最后一段原文。")
	r.durations = map[string][]int{"analyze": {50, 30, 40}, "plan": {140, 100, 120, 130}}
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", Ratio: "9:16", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now().Add(-10 * time.Second)
	r.jobs[0].Status, r.jobs[0].StartedAt = "running", &started

	got, err := s.Get(context.Background(), 7, uint64(v.ID))
	if err != nil {
		t.Fatal(err)
	}
	if got.Eta == nil || *got.Eta != (model.DramaEta{AnalyzeSeconds: 40, PlanSeconds: 125, PlanBatchesLeft: 1}) {
		t.Fatalf("eta=%+v", got.Eta)
	}
	if len(got.ActiveJobs) != 1 || got.ActiveJobs[0].StartedAt == nil || !got.ActiveJobs[0].StartedAt.Equal(started) {
		t.Fatalf("任务要带开始时间：%+v", got.ActiveJobs)
	}
}

// 历史不足三次的步骤不给耗时（0），界面据此不显示；规划结束后不再带预计耗时。
func TestDramaGetEtaNeedsHistoryAndRunningPhase(t *testing.T) {
	r := newDramaMemory()
	seedDramaDraft(r, "第1章 开始\n原文。\n第2章 结尾\n最后一段原文。")
	r.durations = map[string][]int{"analyze": {30, 40}, "plan": {100, 120, 140}}
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", Ratio: "9:16", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(context.Background(), 7, uint64(v.ID))
	if err != nil {
		t.Fatal(err)
	}
	if got.Eta == nil || got.Eta.AnalyzeSeconds != 0 || got.Eta.PlanSeconds != 120 {
		t.Fatalf("eta=%+v", got.Eta)
	}
	r.project.Phase = "done"
	if got, err = s.Get(context.Background(), 7, uint64(v.ID)); err != nil || got.Eta != nil {
		t.Fatalf("规划结束后不该有预计耗时：eta=%+v err=%v", got.Eta, err)
	}
}
