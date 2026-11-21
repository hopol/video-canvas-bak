package migration_test

import (
	"context"
	"testing"

	"video-canvas/internal/migration"
)

// 0040：短剧环节不再要求先启用。停用但标了环节的技能原本对用户不可见，迁移清空它们的环节保持不可见；
// 启用且标了环节的技能行为不变。
func TestAgentSkillScopesMigration_ClearsDisabledSteps(t *testing.T) {
	db := isolatedDB(t)
	if err := migration.Run(context.Background(), db, migration.Options{FS: migrationsExcept(t, "0040_"), Logger: testLogger()}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		name    string
		enabled bool
	}{{"off", false}, {"on", true}} {
		if err := db.Exec(`INSERT INTO agent_skills (name,title,enabled,drama_steps,created_by,latest_version) VALUES (?,?,?,'["video"]'::jsonb,1,1)`, row.name, row.name, row.enabled).Error; err != nil {
			t.Fatal(err)
		}
	}
	runReal(t, db)
	steps := map[string]string{}
	rows, err := db.Raw(`SELECT name, drama_steps::text FROM agent_skills`).Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			t.Fatal(err)
		}
		steps[name] = value
	}
	if steps["off"] != "[]" || steps["on"] != `["video"]` {
		t.Fatalf("迁移结果不对: %v", steps)
	}
}
