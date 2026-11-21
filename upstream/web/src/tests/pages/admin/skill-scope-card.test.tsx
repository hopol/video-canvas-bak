import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { SkillScopeKey } from "@/utils/admin/agent-skill";
import type { ScopeCard as ScopeCardType } from "@/pages/admin/agent-skills/skill-detail/scope-card";

/**
 * 技能详情右侧「用在哪里」：画布 Agent + 短剧四环节，五个平级开关，点了即生效，没有保存按钮。
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

describe("用在哪里", () => {
  let dom: DomEnv;
  let ScopeCard: typeof ScopeCardType;
  beforeAll(async () => {
    dom = await installDom();
    ScopeCard = (await import("@/pages/admin/agent-skills/skill-detail/scope-card")).ScopeCard;
  });
  afterAll(() => dom.restore());

  const switches = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[role=switch]")];
  const none = new Set<SkillScopeKey>();

  test("五个开关按固定顺序，状态来自 enabled 和 drama_steps；没有保存按钮", async () => {
    const m = await dom.mount(
      <ScopeCard
        item={item({ enabled: true, drama_steps: ["video"] })}
        busy={none}
        onToggle={() => {}}
      />,
    );
    expect(switches(m.container).map((s) => s.getAttribute("aria-label"))).toEqual([
      "画布 Agent",
      "分集规划",
      "分集剧本",
      "资产拆解",
      "资产图提示词",
      "视频提示词",
    ]);
    expect(switches(m.container).map((s) => s.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(m.container.textContent).toContain("画布");
    expect(m.container.textContent).toContain("短剧工作室");
    expect(m.container.textContent).not.toContain("保存");
    await m.unmount();
  });

  test("点开关直接回调（场景 + 目标状态）；点整行也一样", async () => {
    const calls: [SkillScopeKey, boolean][] = [];
    const m = await dom.mount(
      <ScopeCard
        item={item({ enabled: true })}
        busy={none}
        onToggle={(scope, on) => calls.push([scope, on])}
      />,
    );
    await dom.click(switches(m.container)[0]);
    await dom.click(m.container.querySelector("[data-scope=assets]"));
    expect(calls).toEqual([
      ["agent", false],
      ["assets", true],
    ]);
    await m.unmount();
  });

  test("内置技能全部禁用；正在提交的那一行禁用，其他行照常", async () => {
    const calls: SkillScopeKey[] = [];
    let m = await dom.mount(
      <ScopeCard
        item={item({ readonly: true, source: "builtin", enabled: true })}
        busy={none}
        onToggle={(s) => calls.push(s)}
      />,
    );
    expect(switches(m.container).every((s) => s.hasAttribute("data-disabled"))).toBe(true);
    await dom.click(m.container.querySelector("[data-scope=video]"));
    expect(calls).toEqual([]);
    await m.unmount();

    m = await dom.mount(
      <ScopeCard
        item={item()}
        busy={new Set<SkillScopeKey>(["plan"])}
        onToggle={(s) => calls.push(s)}
      />,
    );
    expect(switches(m.container).map((s) => s.hasAttribute("data-disabled"))).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    await m.unmount();
  });

  test("含脚本的技能在短剧分组标「仅用正文」", async () => {
    const m = await dom.mount(
      <ScopeCard item={item({ has_scripts: true })} busy={none} onToggle={() => {}} />,
    );
    expect(m.container.textContent).toContain("仅用正文");
    await m.unmount();
  });
});
