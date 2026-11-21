package migration_test

import (
	"context"
	"testing"

	"video-canvas/internal/migration"
)

// 0041：「剧本改编」拆成「分集规划」「分集剧本」。我的提示词按页拆成两条（规划页留原 id，剧本页建新行），
// 对照表记下旧 id → 新 id 供启动修补项目快照；技能的 adapt 换成 plan + scripts。
func TestDramaPromptSplitMigration(t *testing.T) {
	db := isolatedDB(t)
	if err := migration.Run(context.Background(), db, migration.Options{FS: migrationsExcept(t, "0041_"), Logger: testLogger()}); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO drama_prompts (id,user_id,step,name,bodies,revision) VALUES (1,7,'adapt','两页','{"plan":"规划正文","scripts":"剧本正文"}',3)`,
		`INSERT INTO drama_prompts (id,user_id,step,name,bodies,revision) VALUES (2,7,'adapt','只有剧本','{"scripts":"只剧本"}',1)`,
		`INSERT INTO drama_prompts (id,user_id,step,name,bodies,revision) VALUES (3,7,'assets','拆解','{"breakdown":"拆"}',1)`,
		`SELECT setval('drama_prompts_id_seq', 3)`,
		`INSERT INTO agent_skills (name,title,drama_steps,created_by,latest_version) VALUES ('a','a','["adapt","video"]',1,1),('b','b','["assets"]',1,1)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	runReal(t, db)

	type row struct {
		ID     uint64
		Step   string
		Name   string
		Bodies string
	}
	var rows []row
	if err := db.Raw(`SELECT id, step, name, bodies::text AS bodies FROM drama_prompts ORDER BY id`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]row{}
	for _, r := range rows {
		got[r.Step+"/"+r.Name] = r
	}
	if len(rows) != 4 {
		t.Fatalf("应剩 4 条（两页拆成 2 条、只剧本 1 条、拆解 1 条）：%+v", rows)
	}
	if r := got["plan/两页"]; r.ID != 1 || r.Bodies != `{"plan": "规划正文"}` {
		t.Fatalf("规划页应保留原 id 且只留规划页：%+v", r)
	}
	if r := got["scripts/两页"]; r.ID == 0 || r.Bodies != `{"scripts": "剧本正文"}` {
		t.Fatalf("剧本页应拆成新行：%+v", r)
	}
	if r := got["scripts/只有剧本"]; r.Bodies != `{"scripts": "只剧本"}` {
		t.Fatalf("只有剧本页的提示词只拆出剧本：%+v", r)
	}
	if _, ok := got["plan/只有剧本"]; ok {
		t.Fatal("没有规划页就不建分集规划")
	}
	if got["assets/拆解"].ID != 3 {
		t.Fatal("其他环节不动")
	}

	type split struct{ OldID, PlanID, ScriptsID uint64 }
	var splits []split
	if err := db.Raw(`SELECT old_id, COALESCE(plan_id,0) AS plan_id, COALESCE(scripts_id,0) AS scripts_id FROM drama_prompt_splits ORDER BY old_id`).Scan(&splits).Error; err != nil {
		t.Fatal(err)
	}
	if len(splits) != 2 || splits[0] != (split{1, 1, got["scripts/两页"].ID}) || splits[1] != (split{2, 0, got["scripts/只有剧本"].ID}) {
		t.Fatalf("对照表不对：%+v", splits)
	}

	var steps []string
	if err := db.Raw(`SELECT drama_steps::text FROM agent_skills ORDER BY name`).Scan(&steps).Error; err != nil {
		t.Fatal(err)
	}
	if len(steps) != 2 || steps[0] != `["plan", "scripts", "video"]` || steps[1] != `["assets"]` {
		t.Fatalf("技能环节不对：%v", steps)
	}
}
