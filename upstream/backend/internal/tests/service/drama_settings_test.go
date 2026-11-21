package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

func seedDramaDraft(r *dramaMemory, text string) string {
	if r.drafts == nil {
		r.drafts = map[string]model.DramaSourceDraft{}
	}
	r.drafts["draft"] = model.DramaSourceDraft{ID: "draft", UserID: 7, Text: text, Filename: "原文.txt", ExpiresAt: time.Now().Add(time.Hour)}
	return "draft"
}
func (r *dramaMemory) CreateDraft(_ context.Context, d *model.DramaSourceDraft) error {
	if r.drafts == nil {
		r.drafts = map[string]model.DramaSourceDraft{}
	}
	r.drafts[d.ID] = *d
	return nil
}
func (r *dramaMemory) Draft(_ context.Context, user uint64, token string, _ bool) (*model.DramaSourceDraft, error) {
	d, ok := r.drafts[token]
	if !ok || d.UserID != user || !d.ExpiresAt.After(time.Now()) {
		return nil, repository.ErrNotFound
	}
	return &d, nil
}
func (r *dramaMemory) DeleteDraft(_ context.Context, _ uint64, token string) error {
	delete(r.drafts, token)
	return nil
}
func (r *dramaMemory) InsertUnits(_ context.Context, units []model.DramaUnit) error {
	r.units = append(r.units, units...)
	return nil
}
func (r *dramaMemory) Units(_ context.Context, user, id uint64, from, to int) ([]model.DramaUnit, error) {
	out := []model.DramaUnit{}
	for _, u := range r.units {
		if u.UserID == user && u.DramaID == id && u.No >= from && (to == 0 || u.No <= to) {
			out = append(out, u)
		}
	}
	return out, nil
}
func (r *dramaMemory) Canvas(ctx context.Context, user, id uint64) (*model.CanvasProject, error) {
	return r.GetByID(ctx, user, id)
}
func (r *dramaMemory) Prompts(_ context.Context, user uint64, step string) ([]model.DramaPrompt, error) {
	out := []model.DramaPrompt{}
	for _, p := range r.prompts {
		if p.UserID == user && (step == "" || p.Step == step) {
			out = append(out, p)
		}
	}
	return out, nil
}
func (r *dramaMemory) Prompt(_ context.Context, user, id uint64) (*model.DramaPrompt, error) {
	p, ok := r.prompts[id]
	if !ok || p.UserID != user {
		return nil, repository.ErrNotFound
	}
	return &p, nil
}
func (r *dramaMemory) SavePrompt(_ context.Context, p *model.DramaPrompt) error {
	if r.prompts == nil {
		r.prompts = map[uint64]model.DramaPrompt{}
	}
	if p.ID == 0 {
		p.ID = uint64(len(r.prompts) + 1)
	}
	r.prompts[p.ID] = *p
	return nil
}
func (r *dramaMemory) DeletePrompt(_ context.Context, _ uint64, id uint64) error {
	delete(r.prompts, id)
	return nil
}

func TestDramaPlanningReadsFullBatchAndAppends(t *testing.T) {
	r := newDramaMemory()
	source := "第1章 开始\n" + strings.Repeat("必须保留全文。", 2000) + "\n第2章 结尾\n最后一段原文。"
	seedDramaDraft(r, source)
	e := &dramaTextStreamer{outputs: []string{
		`{"source_kind":"script","summary":"梗概","characters_md":"人物","outline_md":"后文为抽样推断"}`,
		"分集目录草稿",
		`{"episodes":[{"title":"开始","synopsis":"梗概","hook":"钩子","cliffhanger":"悬念","unit_from":1,"unit_to":3}]}`,
	}}
	s, _ := dramaTestService(r, e, nil)
	v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", Ratio: "9:16", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	if r.project.SourceKind != "novel" || len(r.jobs) != 2 || r.jobs[1].Step != "plan" {
		t.Fatalf("%+v %+v", r.project, r.jobs)
	}
	var vars map[string]any
	if err = json.Unmarshal(r.jobs[1].InputJSON, &vars); err != nil {
		t.Fatal(err)
	}
	for _, u := range r.units {
		if !strings.Contains(vars["source"].(string), u.Text) {
			t.Fatal("规划缺少批内完整原文")
		}
	}
	if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[1].ID); err != nil {
		t.Fatal(err)
	}
	if r.project.Phase != "done" || r.project.PlanCursor != 3 || len(r.episodes) != 1 || r.episodes[0].ScriptMD != "" {
		t.Fatalf("phase=%s cursor=%d units=%d episodes=%d jobs=%v", r.project.Phase, r.project.PlanCursor, r.project.UnitsTotal, len(r.episodes), func() []string {
			out := []string{}
			for _, j := range r.jobs {
				out = append(out, j.Step+":"+j.Status+":"+j.ErrorMessage)
			}
			return out
		}())
	}
}

func TestDramaPipelineAndUserCanOverlap(t *testing.T) {
	r := newDramaMemory()
	r.project.Phase = "running"
	r.jobs = []model.DramaJob{{BaseModel: model.BaseModel{ID: 2}, UserID: 7, DramaID: 1, Step: "plan", Lane: "pipeline", Status: "running"}}
	dramaAddEpisode(r, 1, "")
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	if _, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "breakdown", Episodes: []int{1}}); err == nil {
		t.Fatal("用户文本任务应互斥")
	}
	if _, err := s.CreateEpisode(context.Background(), 7, 1, &model.CreateDramaEpisodeReq{}); err == nil {
		t.Fatal("规划中不能新增集")
	}
	if err := s.DeleteEpisode(context.Background(), 7, 1, 1); err == nil {
		t.Fatal("规划中不能删集")
	}
}

func TestDramaScriptsUseUnitAndPreviousSynopsis(t *testing.T) {
	r := newDramaMemory()
	dramaAddEpisode(r, 1, "")
	dramaAddEpisode(r, 2, "")
	r.episodes[0].Synopsis = "上一集梗概"
	r.episodes[0].Cliffhanger = "上一集悬念"
	r.episodes[1].UnitFrom = 1
	r.episodes[1].UnitTo = 1
	r.episodes[1].Hook = "开场钩子"
	r.units = []model.DramaUnit{{UserID: 7, DramaID: 1, No: 1, Text: "本集必须出现的原文对白", Chars: 12}}
	e := &dramaTextStreamer{outputs: []string{"本集剧本"}}
	s, _ := dramaTestService(r, e, nil)
	j, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{2}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"本集必须出现的原文对白", "上一集梗概", "上一集悬念", "开场钩子"} {
		if !strings.Contains(e.prompts[0], text) {
			t.Fatalf("缺少 %s", text)
		}
	}
}

func TestDramaPromptSnapshotAndCustomFailure(t *testing.T) {
	r := newDramaMemory()
	r.project.Phase = "paused"
	r.project.PlanCursor = 0
	r.project.RangeEnd = 1
	r.project.UnitsTotal = 1
	r.units = []model.DramaUnit{{UserID: 7, DramaID: 1, No: 1, Title: "第一章", Text: "正文", Chars: 2}}
	// 创作段写出纯文本，格式段两次都输出 Markdown：自定义正文导致格式不合格
	e := &dramaTextStreamer{outputs: []string{"Markdown", "Markdown", "Markdown"}}
	s, _ := dramaTestService(r, e, nil)
	scriptsPrompt, err := s.SavePrompt(context.Background(), 7, 0, &model.SaveDramaPromptReq{Step: "scripts", Name: "解说", Bodies: map[string]string{"scripts": "解说文案"}})
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := s.SavePrompt(context.Background(), 7, 0, &model.SaveDramaPromptReq{Step: "plan", Name: "我的", Bodies: map[string]string{"plan": "只输出 Markdown"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Update(context.Background(), 7, 1, &model.UpdateDramaReq{Revision: r.project.Revision, Prompts: map[string]model.DramaPromptChoice{"plan": {Source: "mine", ID: prompt.ID}, "scripts": {Source: "mine", ID: scriptsPrompt.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Planning(context.Background(), 7, 1, "resume", &model.DramaPlanningReq{})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeletePrompt(context.Background(), 7, uint64(prompt.ID)); err != nil {
		t.Fatal(err)
	}
	// 项目更新不得影响已经排队的正文。
	_, err = s.Update(context.Background(), 7, 1, &model.UpdateDramaReq{Revision: r.project.Revision, Prompts: map[string]model.DramaPromptChoice{"plan": {Source: "builtin"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, 1, r.jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	if r.project.Phase != "paused" || r.project.PauseCode != "custom_prompt" || r.jobs[0].ErrorCode != 67015 || !strings.Contains(e.prompts[0], "只输出 Markdown") {
		t.Fatalf("%+v %+v", r.project, r.jobs)
	}
	// 恢复内置后重新入队同一批，已失败任务的历史快照保持不变。
	e.outputs = []string{"分集目录草稿", `{"episodes":[{"title":"首集","synopsis":"梗概","hook":"开场","cliffhanger":"结尾","unit_from":1,"unit_to":1}]}`}
	// 改用内置只针对分集规划：传别的环节不行
	_, err = s.Planning(context.Background(), 7, 1, "retry-builtin", &model.DramaPlanningReq{Step: "scripts"})
	dramaCheckCode(t, err, 67019)
	// 把项目里的分集规划改回之前的自定义，确认重试只重置分集规划
	var cur map[string]model.DramaPromptSetting
	_ = json.Unmarshal(r.project.PromptSettings, &cur)
	cur["plan"] = model.DramaPromptSetting{Source: "mine", Label: "我的 · 我的", Bodies: map[string]string{"plan": "只输出 Markdown"}}
	r.project.PromptSettings, _ = json.Marshal(cur)
	if _, err = s.Planning(context.Background(), 7, 1, "retry-builtin", &model.DramaPlanningReq{Step: "plan"}); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(r.project.PromptSettings, &cur)
	if cur["plan"].Source != "builtin" || cur["scripts"].Label != "我的 · 解说" {
		t.Fatalf("改用内置只应重置分集规划: %+v", cur)
	}
	if len(r.jobs) != 2 {
		t.Fatalf("重试应产生新任务: %d", len(r.jobs))
	}
	if err = s.HandleDrama(context.Background(), 7, 1, r.jobs[1].ID); err != nil {
		t.Fatal(err)
	}
	if r.project.Phase != "done" || r.jobs[1].Status != "succeeded" {
		t.Fatal("内置重试没有完成")
	}
}

// 不再有固定的上下文门槛：每批原文按窗口的 60% 扣掉提示词预留来切，只要最长一章能整章放进一批就能用；
// 放不下时建剧、估价、换模型都报 67022 并点名那一章。
func TestDramaContextFitsLongestUnit(t *testing.T) {
	short := "第1章 开始\n" + strings.Repeat("短", 2000) + "\n第2章 结尾\n" + strings.Repeat("尾", 2000)
	// 预检会把超过九千字的章切段，这里用五千字的整章：20k 窗口一批只能放约 3800 字
	long := "第1章 开始\n" + strings.Repeat("短", 2000) + "\n第2章 大战\n" + strings.Repeat("长", 5000)

	t.Run("小窗口模型章节都放得下就能建剧、估价、换模型", func(t *testing.T) {
		r := newDramaMemory()
		seedDramaDraft(r, short)
		s, reg := dramaTestService(r, &dramaTextStreamer{}, nil)
		reg.snap.Model.Capabilities.Context.Window = 32000
		if _, err := s.EstimateSource(context.Background(), 7, "draft", &model.DramaSourceEstimateReq{SourceKind: "novel"}); err != nil {
			t.Fatal(err)
		}
		v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", StyleKey: "custom", StyleCustom: "写实"})
		if err != nil {
			t.Fatal(err)
		}
		key := "text"
		if _, err = s.Update(context.Background(), 7, uint64(v.ID), &model.UpdateDramaReq{Revision: r.project.Revision, TextModel: &key}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("后台没填上下文窗口按兜底额度分批", func(t *testing.T) {
		r := newDramaMemory()
		seedDramaDraft(r, "第1章 开始\n短短一段\n第2章 结尾\n也很短")
		s, reg := dramaTestService(r, &dramaTextStreamer{}, nil)
		reg.snap.Model.Capabilities.Context = nil
		if _, err := s.EstimateSource(context.Background(), 7, "draft", &model.DramaSourceEstimateReq{SourceKind: "novel"}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("最长一章放不下时报 67022 并点名那一章", func(t *testing.T) {
		r := newDramaMemory()
		seedDramaDraft(r, long)
		s, reg := dramaTestService(r, &dramaTextStreamer{}, nil)
		reg.snap.Model.Capabilities.Context.Window = 20000
		_, err := s.EstimateSource(context.Background(), 7, "draft", &model.DramaSourceEstimateReq{SourceKind: "novel"})
		dramaCheckContextMsg(t, err, "第2章 大战")
		_, err = s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", StyleKey: "custom", StyleCustom: "写实"})
		dramaCheckContextMsg(t, err, "第2章 大战")
	})

	t.Run("换成放不下最长一章的模型被拒，大窗口不受影响", func(t *testing.T) {
		r := newDramaMemory()
		seedDramaDraft(r, long)
		s, reg := dramaTestService(r, &dramaTextStreamer{}, nil)
		v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", StyleKey: "custom", StyleCustom: "写实"})
		if err != nil {
			t.Fatal(err)
		}
		reg.snap.Model.Capabilities.Context.Window = 20000
		key := "text"
		_, err = s.Update(context.Background(), 7, uint64(v.ID), &model.UpdateDramaReq{Revision: r.project.Revision, TextModel: &key})
		dramaCheckContextMsg(t, err, "第2章 大战")
	})
}

func dramaCheckContextMsg(t *testing.T, err error, unit string) {
	t.Helper()
	dramaCheckCode(t, err, 67022)
	var business *errcode.Error
	errors.As(err, &business)
	if !strings.Contains(business.Msg, unit) || strings.Contains(business.Msg, "128k") {
		t.Fatalf("提示应点名「%s」且不再提 128k: %s", unit, business.Msg)
	}
}

func TestDramaPlanningPauseRangeAndCredits(t *testing.T) {
	r := newDramaMemory()
	r.project.Phase = "done"
	r.project.UnitsTotal = 2
	r.project.RangeEnd = 1
	r.project.PlanCursor = 1
	r.units = []model.DramaUnit{{UserID: 7, DramaID: 1, No: 1, Title: "第一章", Text: "正文", Chars: 2}, {UserID: 7, DramaID: 1, No: 2, Title: "第二章", Text: "后文", Chars: 2}}
	r.credit.Balance = 0
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	v, err := s.Planning(context.Background(), 7, 1, "range", &model.DramaPlanningReq{RangeEnd: 2})
	if err != nil || v.Phase != "paused" || v.PauseCode != "credits" || v.RangeEnd != 2 {
		t.Fatalf("%+v %v", v, err)
	}
	r.credit.Balance = 100
	v, err = s.Planning(context.Background(), 7, 1, "resume", &model.DramaPlanningReq{})
	if err != nil || v.Phase != "running" || len(r.jobs) != 1 {
		t.Fatalf("%+v %v", v, err)
	}
	v, err = s.Planning(context.Background(), 7, 1, "pause", &model.DramaPlanningReq{})
	if err != nil || v.PauseCode != "user" || r.jobs[0].Status != "queued" {
		t.Fatalf("%+v %v", v, err)
	}
}

func TestDramaPlanningContinuesWhileUserJobQueued(t *testing.T) {
	r := newDramaMemory()
	r.project.Phase = "paused"
	r.project.UnitsTotal = 13
	r.project.RangeEnd = 13
	r.project.EpisodeSeconds = 60
	for i := 1; i <= 13; i++ {
		r.units = append(r.units, model.DramaUnit{UserID: 7, DramaID: 1, No: i, Title: "章节", Text: strings.Repeat("文", 2500), Chars: 2500})
	}
	e := &dramaTextStreamer{}
	s, _ := dramaTestService(r, e, nil)
	if _, err := s.Planning(context.Background(), 7, 1, "resume", &model.DramaPlanningReq{}); err != nil {
		t.Fatal(err)
	}
	runPlan := func(index int) {
		j := r.jobs[index]
		raw, _ := json.Marshal(drama.PlanOutput{Episodes: []drama.PlanEpisode{{Title: "本批", Synopsis: "梗概", Hook: "钩子", Cliffhanger: "悬念", UnitFrom: j.BatchFrom, UnitTo: j.BatchTo}}})
		e.outputs = []string{"分集目录草稿", string(raw)}
		if err := s.HandleDrama(context.Background(), 7, 1, j.ID); err != nil {
			t.Fatal(err)
		}
	}
	runPlan(0)
	if len(r.jobs) != 2 {
		t.Fatalf("没有下一批: %d", len(r.jobs))
	}
	if _, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}}); err != nil {
		t.Fatal(err)
	}
	runPlan(1)
	if r.project.Phase != "done" || r.project.PlanCursor != 13 || r.jobs[2].Status != "queued" || len(r.episodes) != 2 {
		t.Fatalf("phase=%s cursor=%d eps=%d", r.project.Phase, r.project.PlanCursor, len(r.episodes))
	}
}

func TestDramaEstimateScriptGaps(t *testing.T) {
	r := newDramaMemory()
	for i := 1; i <= 5; i++ {
		dramaAddEpisode(r, i, "")
	}
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	gaps, err := s.ScriptGaps(context.Background(), 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{3, 5}})
	if err != nil || len(gaps) != 2 || gaps[0] != 2 || gaps[1] != 4 {
		t.Fatalf("%v %v", gaps, err)
	}
}

func TestDramaScriptImportSkipsPlanAndScripts(t *testing.T) {
	for _, source := range []string{"第1集 开始\n甲：走。\n第2集 结束\n乙：好。", "1-1 日 内\n甲：走。\n1-2 夜 外\n乙：好。\n1-3 日 内\n甲：来。"} {
		r := newDramaMemory()
		seedDramaDraft(r, source)
		e := &dramaTextStreamer{outputs: []string{`{"source_kind":"script","summary":"梗概","characters_md":"人物","outline_md":"主线"}`}}
		s, _ := dramaTestService(r, e, nil)
		v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "script", RangeEnd: 1, StyleKey: "custom", StyleCustom: "写实"})
		if err != nil {
			t.Fatal(err)
		}
		if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[0].ID); err != nil {
			t.Fatal(err)
		}
		if len(r.jobs) != 1 || r.project.Phase != "done" || len(r.episodes) == 0 {
			t.Fatalf("%+v %+v", r.project, r.jobs)
		}
		var b strings.Builder
		for _, ep := range r.episodes {
			b.WriteString(ep.ScriptMD)
		}
		if !strings.Contains(b.String(), "乙：好。") {
			t.Fatal("导入丢失台词")
		}
		_, err = s.CreateJob(context.Background(), 7, uint64(v.ID), &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
		dramaCheckCode(t, err, 67006)
	}
}

// 编译期保证替身覆盖预检及原文仓储，不依赖内嵌 nil 接口。
var _ service.DramaSettingsRepo = (*dramaMemory)(nil)
var _ = drama.MaxSourceRunes

func (r *dramaMemory) CleanupDrafts(context.Context) error { return nil }
func (r *dramaMemory) RecentDramaDurations(_ context.Context, modelID uint64, step string) ([]int, error) {
	if modelID != 9 {
		return nil, nil
	}
	return append([]int{}, r.durations[step]...), nil
}
func (r *dramaMemory) UnitSizes(ctx context.Context, user, id uint64, from, to int) ([]model.DramaUnit, error) {
	units, err := r.Units(ctx, user, id, from, to)
	for i := range units {
		units[i].Text = ""
	}
	return units, err
}

func (r *dramaMemory) SegmentTasks(context.Context, uint64, uint64, string) ([]model.GenerationTask, error) {
	return nil, nil
}

func (r *dramaMemory) RecentDramaBatches(ctx context.Context, user, id uint64) ([]model.DramaJob, error) {
	return r.Jobs(ctx, user, id, false)
}
