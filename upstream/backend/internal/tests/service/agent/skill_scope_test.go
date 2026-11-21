package agent_test

import (
	"context"
	"testing"

	"video-canvas/internal/model"
	. "video-canvas/internal/service/agent"
)

// 使用场景：画布 Agent（enabled）与短剧四环节（drama_steps）各自独立，短剧不再要求先启用。
func TestSkillService_DramaStepsIndependentOfEnabled(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	mustConfirm(t, e, 1, standardPkg(t, "demo", "正文"))
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"assets"}); err != nil {
		t.Fatal(err)
	}
	items, err := e.svc.DramaSkills(ctx, "assets")
	if err != nil || len(items) != 1 {
		t.Fatalf("只开短剧环节、未开画布 Agent 也应出现在短剧下拉: %+v %v", items, err)
	}
	if _, err := e.svc.DramaSkill(ctx, "demo", "assets"); err != nil {
		t.Fatalf("只开短剧环节应可读取: %v", err)
	}
	enabled, err := e.svc.Enabled(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range enabled {
		if b.Name == "demo" {
			t.Fatal("没开画布 Agent 不应进 Agent 目录")
		}
	}
}

func TestSkillService_DramaStepsNeedActiveVersion(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	if _, _, err := e.repo.ReserveVersionForTest("draft"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "draft", []string{"video"}); codeOf(err) != 61009 {
		t.Fatalf("没有生效版本时新增环节应返回 61009: %v", err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "draft", []string{}); err != nil {
		t.Fatalf("清空环节不需要生效版本: %v", err)
	}
}

func TestSkillService_DeleteNeedsAllScopesOff(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	mustConfirm(t, e, 1, standardPkg(t, "demo", "正文"))
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"video"}); err != nil {
		t.Fatal(err)
	}
	check, err := e.svc.DeleteCheck(ctx, "demo")
	if err != nil || check.CanDelete || check.Reason == "" {
		t.Fatalf("开着短剧环节时不能删除: %+v %v", check, err)
	}
	if err := e.svc.DeleteSkill(ctx, 1, "demo"); codeOf(err) != 61010 {
		t.Fatalf("应返回 61010: %v", err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", nil); err != nil {
		t.Fatal(err)
	}
	if check, _ := e.svc.DeleteCheck(ctx, "demo"); !check.CanDelete {
		t.Fatalf("全部场景关闭后应可删除: %+v", check)
	}
	if err := e.svc.DeleteSkill(ctx, 1, "demo"); err != nil {
		t.Fatal(err)
	}
}

func TestSkillService_ListScopeFilter(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	mustConfirm(t, e, 1, standardPkg(t, "agent-only", "正文"))
	mustConfirm(t, e, 1, standardPkg(t, "drama-only", "正文"))
	mustConfirm(t, e, 1, standardPkg(t, "idle", "正文"))
	if _, err := e.svc.SetEnabled(ctx, 1, "agent-only", true); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "drama-only", []string{"plan"}); err != nil {
		t.Fatal(err)
	}
	names := func(status string) map[string]bool {
		t.Helper()
		page, err := e.svc.List(ctx, &model.ListSkillReq{Status: status})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, it := range page.List {
			if it.Source == "imported" {
				out[it.Name] = it.InUse
			}
		}
		return out
	}
	if got := names("agent"); len(got) != 1 || !got["agent-only"] {
		t.Errorf("agent: %v", got)
	}
	if got := names("drama"); len(got) != 1 || !got["drama-only"] {
		t.Errorf("drama: %v", got)
	}
	if got := names("unused"); len(got) != 1 || got["idle"] {
		t.Errorf("unused 应只有 idle 且 in_use=false: %v", got)
	}
	// 旧取值兼容一个版本：enabled 同 agent、disabled 同 unused
	if got := names("enabled"); len(got) != 1 || !got["agent-only"] {
		t.Errorf("enabled: %v", got)
	}
	if got := names("disabled"); len(got) != 1 || got["idle"] {
		t.Errorf("disabled: %v", got)
	}
	page, _ := e.svc.List(ctx, &model.ListSkillReq{Status: "unused"})
	for _, it := range page.List {
		if it.Source == "builtin" {
			t.Fatal("内置技能不算未使用")
		}
	}
}

func TestSkillService_ConfirmImportWithScope(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	t.Run("新技能按确认时选的场景生效", func(t *testing.T) {
		v := mustImport(t, e, 1, standardPkg(t, "demo", "第一版"))
		it, err := e.svc.ConfirmImport(ctx, 1, v.ID, SkillScope{Enabled: true, DramaSteps: []string{"video", "assets"}})
		if err != nil {
			t.Fatal(err)
		}
		if !it.Enabled || len(it.DramaSteps) != 2 || !it.InUse {
			t.Fatalf("%+v", it)
		}
		if items, _ := e.svc.DramaSkills(ctx, "video"); len(items) != 1 {
			t.Fatalf("导入后应立即出现在短剧下拉: %+v", items)
		}
	})
	t.Run("新版本忽略场景，沿用技能现有设置", func(t *testing.T) {
		v := mustImport(t, e, 1, standardPkg(t, "demo", "第二版"))
		it, err := e.svc.ConfirmImport(ctx, 1, v.ID, SkillScope{Enabled: false, DramaSteps: []string{"plan"}})
		if err != nil {
			t.Fatal(err)
		}
		if !it.Enabled || len(it.DramaSteps) != 2 {
			t.Fatalf("新版本不应改动场景: %+v", it)
		}
	})
	t.Run("非法环节 10001，且不入库", func(t *testing.T) {
		v := mustImport(t, e, 1, standardPkg(t, "other", "正文"))
		if _, err := e.svc.ConfirmImport(ctx, 1, v.ID, SkillScope{DramaSteps: []string{"bad"}}); codeOf(err) != 10001 {
			t.Fatalf("%v", err)
		}
		if _, err := e.svc.Get(ctx, "other"); codeOf(err) != 61004 {
			t.Fatalf("非法请求不应建技能: %v", err)
		}
	})
}
