package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/service"
)

// 积分流水必须满足 freeze = settle + refund，且失败任务整笔退回、不扣费。
func TestDramaLedgerConservation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		outputs []string
		status  string
		settled int
	}{
		{"成功只结算实际费用", []string{`{"script_md":"剧本"}`}, "succeeded", 5},
		{"校验两次失败整笔退回", []string{`{bad`, `{bad`}, "failed", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newDramaMemory()
			dramaAddEpisode(r, 1, "")
			s, _ := dramaTestService(r, &dramaTextStreamer{outputs: tc.outputs}, nil)
			j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
			if err != nil {
				t.Fatal(err)
			}
			if err := s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
				t.Fatal(err)
			}
			sum := map[string]int{}
			for _, e := range r.ledger {
				sum[e.Type] += e.Amount
			}
			if sum[model.LedgerFreeze] != sum[model.LedgerSettle]+sum[model.LedgerRefund] {
				t.Fatalf("流水不守恒: %v", sum)
			}
			if sum[model.LedgerSettle] != tc.settled || r.jobs[0].Status != tc.status || r.credit.Frozen != 0 {
				t.Fatalf("sum=%v job=%+v credit=%+v", sum, r.jobs[0], r.credit)
			}
			// 重复投递终态任务不得再次结算或调用模型。
			if err := s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
				t.Fatal(err)
			}
			if r.credit.Balance != 1000-tc.settled {
				t.Fatalf("重复投递改变了余额: %+v", r.credit)
			}
		})
	}
}

// 拆解里写提示词失败不影响拆解：资产留在画布上，接续的提示词任务只处理这次新建的资产，而不是整张画布。
func TestDramaAssetPromptsRetryKeepsNewAssetList(t *testing.T) {
	r := newDramaMemory()
	r.project.Ratio = "9:16"
	dramaAddEpisode(r, 1, "正文")
	asset := drama.Asset{Type: "character", Name: "林川", Aliases: []string{}, Episodes: []int{1}, Description: "人物"}
	raw, _ := json.Marshal(drama.BreakdownOutput{Assets: []drama.Asset{asset}})
	good, _ := json.Marshal(drama.AssetPromptsOutput{Prompts: []drama.AssetPrompt{{NodeID: "new", Prompt: "角色正向描述"}}})
	e := &dramaTextStreamer{outputs: []string{string(raw), `{bad`, `{bad`, string(good)}}
	c := &dramaPipelineCanvas{created: []service.DramaCanvasAsset{{NodeID: "new", Asset: asset}}}
	c.mem = r
	s, _ := dramaTestService(r, e, c)
	ctx := context.Background()

	j, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "breakdown", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	// 拆解里的提示词两次输出非法：拆解照样成功、只扣拆解那次，接一个提示词任务。
	if r.jobs[0].Status != "succeeded" || r.jobs[0].Credits != 5 || c.applied != 1 || len(r.jobs) != 2 || r.jobs[1].Step != "asset_prompts" {
		t.Fatalf("jobs=%+v applied=%d", r.jobs, c.applied)
	}
	if err = s.HandleDrama(ctx, 7, 1, r.jobs[1].ID); err != nil {
		t.Fatal(err)
	}
	last := e.prompts[len(e.prompts)-1]
	if r.jobs[1].Status != "succeeded" || c.prompts["new"] != "角色正向描述" || !strings.Contains(last, `"node_id":"new"`) {
		t.Fatalf("job=%+v prompts=%v prompt=%s", r.jobs[1], c.prompts, last)
	}
	// 失败的提示词不扣费，成功的拆解与接续任务各扣一次。
	if r.credit.Balance != 1000-2*5 || r.credit.Frozen != 0 {
		t.Fatalf("credit=%+v", r.credit)
	}
}
