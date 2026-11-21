import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { SkillTable as SkillTableType } from "@/pages/admin/agent-skills/skill-table";

/**
 * 技能列表：「用在哪里」只读标签列替代行末启用开关；显示名和技能名一样时只显示一次。
 */

const item = (patch: Partial<SkillItem> = {}): SkillItem => ({
  name: "demo",
  title: "演示",
  description: "说明",
  source: "imported",
  readonly: false,
  enabled: false,
  active_version: 1,
  latest_version: 1,
  pending_version: false,
  version_count: 1,
  file_count: 1,
  total_bytes: 1,
  has_scripts: false,
  unsupported_fields: [],
  drama_steps: [],
  in_use: false,
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("技能列表", () => {
  let dom: DomEnv;
  let SkillTable: typeof SkillTableType;
  beforeAll(async () => {
    dom = await installDom();
    SkillTable = (await import("@/pages/admin/agent-skills/skill-table")).SkillTable;
  });
  afterAll(() => dom.restore());

  const row = (c: HTMLElement, name: string) =>
    c.querySelector<HTMLElement>(`[data-skill-name="${name}"]`)!;

  test("场景标签按固定顺序；哪里都没用写「未使用」；没有开关", async () => {
    const m = await dom.mount(
      <SkillTable
        items={[
          item({
            name: "a",
            enabled: true,
            drama_steps: ["video", "scripts", "plan"],
            in_use: true,
          }),
          item({ name: "b" }),
        ]}
        loading={false}
        freshName={null}
        onOpen={() => {}}
      />,
    );
    const tags = [...row(m.container, "a").querySelectorAll("[data-slot=scope-tag]")].map(
      (t) => t.textContent,
    );
    expect(tags).toEqual(["画布 Agent", "规划", "剧本", "视频"]);
    expect(row(m.container, "b").textContent).toContain("未使用");
    expect(m.container.querySelector("[role=switch]")).toBeNull();
    await m.unmount();
  });

  test("显示名与技能名相同时只显示一次；内置技能带「内置」", async () => {
    const m = await dom.mount(
      <SkillTable
        items={[
          item({ name: "same", title: "same" }),
          item({ name: "b", title: "画布排版", source: "builtin", readonly: true, enabled: true }),
        ]}
        loading={false}
        freshName={null}
        onOpen={() => {}}
      />,
    );
    expect(row(m.container, "same").textContent?.match(/same/g)?.length).toBe(1);
    expect(row(m.container, "b").textContent).toContain("内置");
    await m.unmount();
  });

  test("点行打开详情", async () => {
    const opened: string[] = [];
    const m = await dom.mount(
      <SkillTable
        items={[item()]}
        loading={false}
        freshName={null}
        onOpen={(it) => opened.push(it.name)}
      />,
    );
    await dom.click(row(m.container, "demo"));
    expect(opened).toEqual(["demo"]);
    await m.unmount();
  });
});
