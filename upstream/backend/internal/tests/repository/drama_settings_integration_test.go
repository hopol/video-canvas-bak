package repository_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

func TestDramaDraftsRetentionExpiryAndOwnership(t *testing.T) {
	db := isolatedDB(t, &model.User{}, &model.DramaSourceDraft{})
	u := model.User{Username: "draft-owner", Password: "x"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	r := repository.NewDramaRepository(db)
	ctx := context.Background()
	for i := 0; i < 4; i++ {
		d := model.DramaSourceDraft{ID: fmt.Sprint(i), UserID: u.ID, Filename: "小说.txt", Text: "正文", UnitsJSON: []byte(`[]`), SignalsJSON: []byte(`{}`), ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now().Add(time.Duration(i) * time.Second)}
		if err := r.CreateDraft(ctx, &d); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.Draft(ctx, u.ID, "0", false); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("没有挤掉最旧草稿: %v", err)
	}
	if _, err := r.Draft(ctx, u.ID+1, "3", false); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("他人草稿泄露: %v", err)
	}
	if err := db.Model(&model.DramaSourceDraft{}).Where("id = ?", "3").Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.Draft(ctx, u.ID, "3", false); !errors.Is(err, repository.ErrNotFound) {
		t.Fatal("过期草稿仍有效")
	}
	if err := r.CleanupDrafts(ctx); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.DramaSourceDraft{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("过期清理: %d %v", count, err)
	}
}

func TestDramaPromptOwnershipAndRevision(t *testing.T) {
	db := isolatedDB(t, &model.DramaPrompt{})
	r := repository.NewDramaRepository(db)
	ctx := context.Background()
	p := &model.DramaPrompt{UserID: 1, Step: "plan", Name: "我的", Bodies: []byte(`{"plan":"正文"}`), Revision: 1}
	if err := r.SavePrompt(ctx, p); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Prompt(ctx, 2, p.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatal("泄露提示词")
	}
	duplicate := *p
	duplicate.ID = 0
	if err := r.SavePrompt(ctx, &duplicate); !errors.Is(err, repository.ErrDuplicate) {
		t.Fatalf("重名: %v", err)
	}
	stale := *p
	p.Name = "改名"
	if err := r.SavePrompt(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := r.SavePrompt(ctx, &stale); !errors.Is(err, repository.ErrStateConflict) {
		t.Fatalf("版本冲突: %v", err)
	}
	if err := r.DeletePrompt(ctx, 2, p.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatal("越权删除")
	}
}

// 启动修补用的三个方法：只挑出还带 adapt 的项目，对照表的 NULL 读成 0，写回只改仍带 adapt 的行。
func TestDramaAdaptPromptSplitRepository(t *testing.T) {
	db := isolatedDB(t, &model.DramaProject{}, &model.DramaPromptSplit{})
	r := repository.NewDramaRepository(db)
	ctx := context.Background()
	for i, raw := range []string{`{"adapt":{"source":"builtin","label":"内置"}}`, `{"plan":{"source":"builtin","label":"内置"}}`} {
		p := model.DramaProject{UserID: 1, CanvasID: uint64(i + 1), Title: "剧", PromptSettings: []byte(raw)}
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO drama_prompt_splits (old_id, plan_id, scripts_id) VALUES (1, 1, 5), (2, NULL, 6)`).Error; err != nil {
		t.Fatal(err)
	}
	projects, err := r.AdaptPromptProjects(ctx)
	if err != nil || len(projects) != 1 || projects[0].ID == 0 {
		t.Fatalf("应只返回带 adapt 的项目: %+v %v", projects, err)
	}
	splits, err := r.DramaPromptSplits(ctx)
	if err != nil || splits[1] != (model.DramaPromptSplit{OldID: 1, PlanID: 1, ScriptsID: 5}) || splits[2] != (model.DramaPromptSplit{OldID: 2, ScriptsID: 6}) {
		t.Fatalf("对照表读取不对: %+v %v", splits, err)
	}
	id := projects[0].ID
	if err := r.SaveAdaptPromptSettings(ctx, id, []byte(`{"plan":{"source":"builtin","label":"内置"},"scripts":{"source":"builtin","label":"内置"}}`)); err != nil {
		t.Fatal(err)
	}
	if left, _ := r.AdaptPromptProjects(ctx); len(left) != 0 {
		t.Fatalf("写回后不应再有 adapt: %+v", left)
	}
	// 已修补的行不会被再次覆盖
	if err := r.SaveAdaptPromptSettings(ctx, id, []byte(`{"adapt":{}}`)); err != nil {
		t.Fatal(err)
	}
	var raw string
	db.Raw(`SELECT prompt_settings::text FROM drama_projects WHERE id = ?`, id).Scan(&raw)
	if raw == `{"adapt": {}}` {
		t.Fatal("已修补的行被覆盖")
	}
}
