import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MemoryRouter } from "react-router";

import { CLI_AGENTS, CLI_FEATURE_GROUPS, CLIAgentDialog } from "@/components/cli/cli-agent-dialog";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
});
afterAll(() => dom.restore());

const body = () => dom.win.document.body;
const copyButton = () =>
  Array.from(body().querySelectorAll("button")).find((b) =>
    /复制命令给 Agent|已复制/.test(b.textContent ?? ""),
  );

function mountDialog(copy: () => Promise<boolean>) {
  return dom.mount(
    <MemoryRouter>
      <CLIAgentDialog open onOpenChange={() => {}} copy={copy} />
    </MemoryRouter>,
  );
}

describe("连镜 CLI 弹窗", () => {
  test("顶部是一排主流 Agent 的图标，每个都有可读的名字", async () => {
    const { unmount } = await mountDialog(async () => true);
    for (const agent of CLI_AGENTS) {
      expect(body().querySelector(`[aria-label="${agent.name}"]`)).not.toBeNull();
    }
    expect(CLI_AGENTS.length).toBeGreaterThanOrEqual(5);
    expect(CLI_AGENTS.map((a) => a.name)).toContain("Claude Code");
    await unmount();
  });

  test("只有一张 CLI 卡片：标题、复制按钮与能力清单，不放详细指南", async () => {
    const { unmount } = await mountDialog(async () => true);
    const text = body().textContent ?? "";
    expect(text).toContain("在你的 Agent 里用连镜创作");
    expect(text).toContain("画布 CLI");
    for (const item of CLI_FEATURE_GROUPS.flat()) expect(text).toContain(item);
    expect(copyButton()).toBeDefined();
    expect(body().querySelector('a[href="/cli/docs"]')).toBeNull();
    expect(text).not.toContain("详细指南");
    await unmount();
  });

  test("用清透弹层外观：半透明面板 + 压暗模糊的遮罩", async () => {
    const { unmount } = await mountDialog(async () => true);
    const overlay = body().querySelector('[data-slot="dialog-overlay"]');
    const popup = body().querySelector('[data-slot="dialog-content"]');
    expect(overlay?.className).toContain("bg-black/25");
    expect(popup?.className).toContain("bg-chrome");
    await unmount();
  });

  test("能力清单只写已经能用的：不提后端还没有的成片合成", () => {
    const all = CLI_FEATURE_GROUPS.flat().join("|");
    expect(all).not.toMatch(/合成|compose|粗剪/);
  });

  test("点复制按钮会复制给 Agent 的提示，成功后按钮变成「已复制」", async () => {
    let calls = 0;
    const { unmount } = await mountDialog(async () => {
      calls += 1;
      return true;
    });
    await dom.click(copyButton());
    await dom.flush();
    expect(calls).toBe(1);
    expect(copyButton()?.textContent).toContain("已复制");
    await unmount();
  });

  test("复制失败时按钮保持原样（失败原因由 toast 给出）", async () => {
    const { unmount } = await mountDialog(async () => false);
    await dom.click(copyButton());
    await dom.flush();
    expect(copyButton()?.textContent).toContain("复制命令给 Agent");
    await unmount();
  });
});
