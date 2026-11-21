package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/service"
)

// 「剧本改编」拆成「分集规划」(plan) 与「分集剧本」(scripts) 两个独立环节：
// 我的提示词、项目选择和技能都按环节各管各的，adapt 不再是合法环节。
func TestDramaPromptStepsSplitPlanAndScripts(t *testing.T) {
	r := newDramaMemory()
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	ctx := context.Background()

	plan, err := s.SavePrompt(ctx, 7, 0, &model.SaveDramaPromptReq{Step: "plan", Name: "规划法", Bodies: map[string]string{"plan": "按章拆集"}})
	if err != nil {
		t.Fatal(err)
	}
	scripts, err := s.SavePrompt(ctx, 7, 0, &model.SaveDramaPromptReq{Step: "scripts", Name: "解说", Bodies: map[string]string{"scripts": "第一人称解说文案"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.SavePrompt(ctx, 7, 0, &model.SaveDramaPromptReq{Step: "plan", Name: "错页", Bodies: map[string]string{"scripts": "正文"}})
	dramaCheckCode(t, err, 67017)
	_, err = s.SavePrompt(ctx, 7, 0, &model.SaveDramaPromptReq{Step: "adapt", Name: "旧环节", Bodies: map[string]string{"plan": "正文"}})
	dramaCheckCode(t, err, 10001)

	if _, err = s.Update(ctx, 7, 1, &model.UpdateDramaReq{Revision: r.project.Revision, Prompts: map[string]model.DramaPromptChoice{
		"plan": {Source: "mine", ID: plan.ID}, "scripts": {Source: "mine", ID: scripts.ID},
	}}); err != nil {
		t.Fatal(err)
	}
	view, err := s.Get(ctx, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if view.PromptSettings["plan"].Label != "我的 · 规划法" || view.PromptSettings["scripts"].Label != "我的 · 解说" {
		t.Fatalf("两个环节应各自记录选择: %+v", view.PromptSettings)
	}
	if _, ok := view.PromptSettings["adapt"]; ok {
		t.Fatal("不应再返回 adapt 环节")
	}
	_, err = s.Update(ctx, 7, 1, &model.UpdateDramaReq{Revision: r.project.Revision, Prompts: map[string]model.DramaPromptChoice{"adapt": {Source: "builtin"}}})
	dramaCheckCode(t, err, 10001)

	// 分集剧本任务只用分集剧本环节的正文
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{outputs: []string{"我叫林川，那天……"}}
	s2, _ := dramaTestService(r, e, nil)
	j, err := s2.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s2.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(e.prompts[0], "第一人称解说文案") || strings.Contains(e.prompts[0], "按章拆集") {
		t.Fatalf("分集剧本应只用自己的正文:\n%s", e.prompts[0])
	}
}

// 剧本型输入不跑分集规划和分集剧本，两个环节都强制内置。
func TestDramaScriptKindForcesPlanAndScriptsBuiltin(t *testing.T) {
	r := newDramaMemory()
	seedDramaDraft(r, "第1集 开始\n甲：走。")
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	ctx := context.Background()
	mine, err := s.SavePrompt(ctx, 7, 0, &model.SaveDramaPromptReq{Step: "scripts", Name: "解说", Bodies: map[string]string{"scripts": "解说"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Create(ctx, 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "script", RangeEnd: 1, StyleKey: "custom", StyleCustom: "写实",
		Prompts: map[string]model.DramaPromptChoice{"scripts": {Source: "mine", ID: mine.ID}}}); err != nil {
		t.Fatal(err)
	}
	var settings map[string]model.DramaPromptSetting
	_ = json.Unmarshal(r.project.PromptSettings, &settings)
	if settings["plan"].Source != "builtin" || settings["scripts"].Source != "builtin" {
		t.Fatalf("剧本型输入两个环节都应是内置: %+v", settings)
	}
}

// 迁移前写进项目的 adapt 设置照常可用：读取时拆成两个环节，各取自己的那一页。
func TestDramaLegacyAdaptSettingsStillWork(t *testing.T) {
	r := newDramaMemory()
	r.project.PromptSettings = []byte(`{"adapt":{"source":"skill","skill":"old","label":"技能 · 老方法","bodies":{"plan":"老规划正文","scripts":"老剧本正文"}}}`)
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{outputs: []string{"剧本"}}
	s, _ := dramaTestService(r, e, nil)
	ctx := context.Background()
	view, err := s.Get(ctx, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if view.PromptSettings["plan"].Label != "技能 · 老方法" || view.PromptSettings["scripts"].Label != "技能 · 老方法" {
		t.Fatalf("老设置应拆到两个环节: %+v", view.PromptSettings)
	}
	if _, ok := view.PromptSettings["adapt"]; ok {
		t.Fatal("不应再返回 adapt 环节")
	}
	j, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "scripts", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(e.prompts[0], "老剧本正文") {
		t.Fatalf("应使用老设置里的剧本正文:\n%s", e.prompts[0])
	}
}

// adaptSplitMemory 是启动修补用的仓储替身：项目快照与迁移留下的旧 id → 新 id 对照。
type adaptSplitMemory struct {
	projects map[uint64][]byte
	splits   map[uint64]model.DramaPromptSplit
	saved    []uint64
}

func (m *adaptSplitMemory) AdaptPromptProjects(context.Context) ([]model.DramaProject, error) {
	var out []model.DramaProject
	for id, raw := range m.projects {
		if strings.Contains(string(raw), `"adapt"`) {
			out = append(out, model.DramaProject{BaseModel: model.BaseModel{ID: id}, PromptSettings: raw})
		}
	}
	return out, nil
}
func (m *adaptSplitMemory) DramaPromptSplits(context.Context) (map[uint64]model.DramaPromptSplit, error) {
	return m.splits, nil
}
func (m *adaptSplitMemory) SaveAdaptPromptSettings(_ context.Context, id uint64, raw []byte) error {
	m.projects[id] = raw
	m.saved = append(m.saved, id)
	return nil
}

// 启动修补把项目快照里的 adapt 拆成 plan / scripts：我的提示词换成迁移拆出的新 id，
// 原提示词缺哪一页，那个环节就回到内置；技能和内置两个环节照抄。跑第二遍什么都不改。
func TestSplitAdaptPromptSettings(t *testing.T) {
	mine := func(id uint64) string {
		return `{"adapt":{"source":"mine","id":"` + idcodec.Encode(id) + `","label":"我的 · 老","bodies":{"plan":"P","scripts":"S"}}}`
	}
	m := &adaptSplitMemory{
		projects: map[uint64][]byte{
			1: []byte(mine(10)),
			2: []byte(mine(20)),
			3: []byte(`{"adapt":{"source":"skill","skill":"old","label":"技能 · 老","version":2,"bodies":{"plan":"P","scripts":"S"}},"video":{"source":"builtin","label":"内置"}}`),
			4: []byte(`{"plan":{"source":"builtin","label":"内置"}}`),
		},
		splits: map[uint64]model.DramaPromptSplit{10: {OldID: 10, PlanID: 10, ScriptsID: 11}, 20: {OldID: 20, ScriptsID: 21}},
	}
	n, err := service.SplitAdaptPromptSettings(context.Background(), m)
	if err != nil || n != 3 {
		t.Fatalf("应修补 3 个项目: %d %v", n, err)
	}
	read := func(id uint64) map[string]model.DramaPromptSetting {
		out := map[string]model.DramaPromptSetting{}
		_ = json.Unmarshal(m.projects[id], &out)
		if _, ok := out["adapt"]; ok {
			t.Fatalf("项目 %d 仍有 adapt", id)
		}
		return out
	}
	p1 := read(1)
	if uint64(p1["plan"].ID) != 10 || uint64(p1["scripts"].ID) != 11 || p1["plan"].Bodies["plan"] != "P" || p1["scripts"].Bodies["scripts"] != "S" {
		t.Fatalf("我的提示词应换成拆出的 id、各留一页: %+v", p1)
	}
	if _, ok := p1["plan"].Bodies["scripts"]; ok {
		t.Fatal("plan 环节不应带 scripts 页")
	}
	p2 := read(2)
	if p2["plan"].Source != "builtin" || p2["plan"].Bodies["plan"] != drama.PromptBody("plan") || uint64(p2["scripts"].ID) != 21 {
		t.Fatalf("原提示词没有规划页时规划回到内置: %+v", p2)
	}
	p3 := read(3)
	if p3["plan"].Skill != "old" || p3["scripts"].Skill != "old" || p3["scripts"].Version != 2 || p3["video"].Source != "builtin" {
		t.Fatalf("技能应照抄到两个环节、其他环节不动: %+v", p3)
	}
	if n, err = service.SplitAdaptPromptSettings(context.Background(), m); err != nil || n != 0 {
		t.Fatalf("第二遍不应再改: %d %v", n, err)
	}
}
