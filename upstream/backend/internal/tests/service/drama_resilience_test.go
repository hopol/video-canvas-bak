package service_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"video-canvas/internal/llmgateway"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
)

// 渠道限流（429）或上游故障（5xx）可能稍后就好：退避后重试同一次调用，不让整个任务失败。
func TestDramaRetriesRetryableUpstreamError(t *testing.T) {
	r := newDramaMemory()
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{failAt: 1, failErr: &llmgateway.UpstreamError{Status: 429, Message: "上游请求太频繁，请稍后重试", Retryable: true}, outputs: []string{"△ 剧本正文"}}
	s, _ := dramaTestService(r, e, nil)
	s.SetRetryDelaysForTest([]time.Duration{time.Millisecond, time.Millisecond, time.Millisecond})
	j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if got := r.jobs[0]; got.Status != "succeeded" || e.calls != 2 || r.episodes[0].ScriptMD != "△ 剧本正文" {
		t.Fatalf("限流后应重试成功：status=%s calls=%d err=%q", got.Status, e.calls, got.ErrorMessage)
	}
}

// 重试次数用完仍被限流：以上游原文失败，不扣费；不可重试的错误（如 400）只调用一次。
func TestDramaRetryableErrorGivesUpAfterLimit(t *testing.T) {
	for _, tc := range []struct {
		name  string
		err   *llmgateway.UpstreamError
		calls int
	}{
		{"限流重试三次后放弃", &llmgateway.UpstreamError{Status: 429, Message: "上游请求太频繁，请稍后重试", Retryable: true}, 4},
		{"不可重试只调一次", &llmgateway.UpstreamError{Status: 400, Message: "参数错误"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newDramaMemory()
			dramaAddEpisode(r, 1, "")
			e := &dramaTextStreamer{respond: func(context.Context, string) (*llmgateway.Result, error) { return nil, tc.err }}
			s, _ := dramaTestService(r, e, nil)
			s.SetRetryDelaysForTest([]time.Duration{time.Millisecond, time.Millisecond, time.Millisecond})
			j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
			if err != nil {
				t.Fatal(err)
			}
			_ = s.HandleDrama(context.Background(), 7, 1, uint64(j.ID))
			got := r.jobs[0]
			if got.Status != "failed" || got.ErrorCode != errcode.ErrDramaModelCall.Code || got.ErrorMessage != tc.err.Message || e.calls != tc.calls {
				t.Fatalf("status=%s code=%d msg=%q calls=%d", got.Status, got.ErrorCode, got.ErrorMessage, e.calls)
			}
			if r.credit.Balance != 1000 || r.credit.Frozen != 0 {
				t.Fatalf("失败不扣费：%+v", r.credit)
			}
		})
	}
}

// 输出被最大输出截断（finish_reason=length）：同样的输入重试还会被截，不原样重试；创作稿哪怕看着完整也不能当成功保存。
func TestDramaTruncatedOutputFailsWithoutRetry(t *testing.T) {
	r := newDramaMemory()
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{respond: func(context.Context, string) (*llmgateway.Result, error) {
		return &llmgateway.Result{Text: "△ 写到一半的剧本", FinishReason: "length"}, nil
	}}
	s, _ := dramaTestService(r, e, nil)
	j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	got := r.jobs[0]
	if got.Status != "failed" || got.ErrorCode != errcode.ErrDramaOutputTruncated.Code || e.calls != 1 || !strings.Contains(got.ErrorMessage, "最大输出") {
		t.Fatalf("应一次调用后以输出截断失败：%s %d %q calls=%d", got.Status, got.ErrorCode, got.ErrorMessage, e.calls)
	}
	if r.episodes[0].ScriptMD != "" {
		t.Fatalf("截断的剧本不应保存：%q", r.episodes[0].ScriptMD)
	}
}

// 一批多集的资产拆解被截断：把这批对半拆开重跑，直到单集也能写完；资产不丢。
func TestDramaBreakdownSplitsTruncatedBatch(t *testing.T) {
	m := &dramaFakeModel{}
	e := &dramaTextStreamer{}
	e.respond = func(ctx context.Context, prompt string) (*llmgateway.Result, error) {
		if len(dramaEpisodeRe.FindAllString(prompt, -1)) > 1 {
			return &llmgateway.Result{Text: "写到一半", FinishReason: "length"}, nil
		}
		return m.respond(ctx, prompt)
	}
	s, r, c, jobID := dramaBreakdownJob(t, 3, e, 0)
	if err := s.HandleDrama(context.Background(), 7, 1, jobID); err != nil {
		t.Fatal(err)
	}
	got := r.jobs[0]
	if got.Status != "succeeded" || got.Progress != 100 || c.applied != 3 {
		t.Fatalf("拆成单集后应成功：status=%s progress=%d applied=%d err=%q", got.Status, got.Progress, c.applied, got.ErrorMessage)
	}
	for _, id := range []string{"node-角色1", "node-角色2", "node-角色3"} {
		if !c.hasPrompt(id) {
			t.Fatalf("缺少 %s 的提示词：%v", id, c.prompts)
		}
	}
}

// 单集也被截断就没法再拆：任务以输出截断失败，告诉用户调大最大输出。
func TestDramaBreakdownSingleEpisodeTruncatedFails(t *testing.T) {
	e := &dramaTextStreamer{respond: func(context.Context, string) (*llmgateway.Result, error) {
		return &llmgateway.Result{Text: "写到一半", FinishReason: "length"}, nil
	}}
	s, r, _, jobID := dramaBreakdownJob(t, 1, e, 0)
	if err := s.HandleDrama(context.Background(), 7, 1, jobID); err != nil {
		t.Fatal(err)
	}
	if got := r.jobs[0]; got.Status != "failed" || got.ErrorCode != errcode.ErrDramaOutputTruncated.Code || e.calls != 1 {
		t.Fatalf("应以输出截断失败：%s %d %q calls=%d", got.Status, got.ErrorCode, got.ErrorMessage, e.calls)
	}
}

// 一组资产的提示词被截断：对半拆开分别写，和安全过滤的处理一样。
func TestDramaPromptsSplitTruncatedGroup(t *testing.T) {
	m := &dramaFakeModel{names: func(int) []string { return []string{"苏晚", "顾北辰", "苏星月"} }}
	e := &dramaTextStreamer{}
	e.respond = func(ctx context.Context, prompt string) (*llmgateway.Result, error) {
		if len(dramaNodeRe.FindAllString(prompt, -1)) > 1 {
			return &llmgateway.Result{Text: "写到一半", FinishReason: "length"}, nil
		}
		return m.respond(ctx, prompt)
	}
	s, r, c, jobID := dramaBreakdownJob(t, 1, e, 0)
	if err := s.HandleDrama(context.Background(), 7, 1, jobID); err != nil {
		t.Fatal(err)
	}
	if r.jobs[0].Status != "succeeded" || len(r.jobs) != 1 {
		t.Fatalf("拆开后都写成，不另起提示词任务：jobs=%+v", r.jobs)
	}
	for _, id := range []string{"node-苏晚", "node-顾北辰", "node-苏星月"} {
		if !c.hasPrompt(id) {
			t.Fatalf("缺少 %s 的提示词：%v", id, c.prompts)
		}
	}
}

// 资产拆解每批的剧本字数跟着模型窗口走：20k 窗口一批只放得下约 3800 字，三集各 2500 字就各成一批。
func TestDramaBreakdownBatchesFollowContextWindow(t *testing.T) {
	r := newDramaMemory()
	r.project.Ratio = "9:16"
	for no := 1; no <= 3; no++ {
		dramaAddEpisode(r, no, fmt.Sprintf("第%d集正文", no)+strings.Repeat("戏", 2500))
	}
	m := &dramaFakeModel{}
	e := &dramaTextStreamer{}
	var mu sync.Mutex
	most := 0
	e.respond = func(ctx context.Context, prompt string) (*llmgateway.Result, error) {
		mu.Lock()
		most = max(most, len(dramaEpisodeRe.FindAllString(prompt, -1)))
		mu.Unlock()
		return m.respond(ctx, prompt)
	}
	c := &dramaPipelineCanvas{mem: r}
	s, reg := dramaTestService(r, e, c)
	reg.snap.Model.Capabilities.Context.Window = 20000
	j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "breakdown", Episodes: []int{1, 2, 3}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if got := r.jobs[0]; got.Status != "succeeded" || c.applied != 3 || most != 1 {
		t.Fatalf("应每集一批：status=%s applied=%d 单次最多 %d 集 err=%q", got.Status, c.applied, most, got.ErrorMessage)
	}
}
