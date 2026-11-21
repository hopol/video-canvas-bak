package agent_test

import (
	"context"
	"strings"
	"testing"
)

func TestSkillService_DramaStepsAndAvailability(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	mustConfirm(t, e, 1, standardPkg(t, "demo", "第一版正文，参考 [方法](references/a.md)"))
	if _, err := e.svc.DramaSkill(ctx, "demo", "assets"); codeOf(err) != 67018 {
		t.Fatalf("未启用: %v", err)
	}
	_, _ = e.svc.SetEnabled(ctx, 1, "demo", true)
	if _, err := e.svc.DramaSkill(ctx, "demo", "assets"); codeOf(err) != 67018 {
		t.Fatalf("未标环节: %v", err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"assets", "video"}); err != nil {
		t.Fatal(err)
	}
	setting, err := e.svc.DramaSkill(ctx, "demo", "assets")
	if err != nil || !strings.Contains(setting.Bodies["breakdown"], "第一版正文") {
		t.Fatalf("%+v %v", setting, err)
	}
	if !strings.Contains(setting.Bodies["breakdown"], "# 参考") {
		t.Fatal("未注入正文引用的文本资源")
	}
	if len(e.audit.actions) == 0 || e.audit.actions[len(e.audit.actions)-1] != "agent_skill.drama_steps" {
		t.Fatalf("缺少环节审计: %v", e.audit.actions)
	}
	items, err := e.svc.DramaSkills(ctx, "assets")
	if err != nil || len(items) != 1 {
		t.Fatalf("%+v %v", items, err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"bad"}); codeOf(err) != 10001 {
		t.Fatalf("无效环节: %v", err)
	}
}

// 分集规划和分集剧本是两个独立环节：技能按环节打开，正文只写进该环节的那一页；adapt 不再合法。
func TestSkillService_DramaStepsPlanAndScriptsSeparate(t *testing.T) {
	e := newSkillEnv(t)
	ctx := context.Background()
	mustConfirm(t, e, 1, standardPkg(t, "demo", "方法正文"))
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"adapt"}); codeOf(err) != 10001 {
		t.Fatalf("adapt 应不再合法: %v", err)
	}
	if _, err := e.svc.SetDramaSteps(ctx, 1, "demo", []string{"scripts"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.DramaSkill(ctx, "demo", "plan"); codeOf(err) != 67018 {
		t.Fatalf("没开分集规划时不可用: %v", err)
	}
	setting, err := e.svc.DramaSkill(ctx, "demo", "scripts")
	if err != nil {
		t.Fatal(err)
	}
	if len(setting.Bodies) != 1 || !strings.Contains(setting.Bodies["scripts"], "方法正文") {
		t.Fatalf("分集剧本只应有 scripts 一页: %+v", setting.Bodies)
	}
	if items, _ := e.svc.DramaSkills(ctx, "scripts"); len(items) != 1 {
		t.Fatalf("%+v", items)
	}
}
