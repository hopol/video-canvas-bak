import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { holdExitAnimations, installDom, type DomEnv } from "@/tests/helpers/dom";

/**
 * 任务历史侧栏的开关：关闭时内容不先卸载，退出动画能完整播放。
 */

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
}, 60_000);
afterAll(() => dom?.restore());

describe("任务历史侧栏", () => {
  test("关闭时内容不先卸载：退出动画期间侧栏里仍是原来的列表", async () => {
    const { ReactFlowProvider } = await import("@xyflow/react");
    const { useState } = await import("react");
    const { TasksSheet } = await import("@/pages/canvas/chrome/tasks-sheet");
    const Host = () => {
      const [open, setOpen] = useState(true);
      return (
        <ReactFlowProvider>
          <button type="button" onClick={() => setOpen(false)}>
            收起
          </button>
          <TasksSheet open={open} onOpenChange={setOpen} />
        </ReactFlowProvider>
      );
    };
    const release = holdExitAnimations(dom);
    try {
      const m = await dom.mount(<Host />);
      const body = dom.win.document.body;
      expect(body.textContent).toContain("这张画布还没有生成过内容");
      await dom.click(
        [...m.container.querySelectorAll("button")].find((b) => b.textContent === "收起"),
      );
      const popup = body.querySelector('[data-slot="sheet-content"]');
      expect(popup?.hasAttribute("data-ending-style")).toBe(true);
      expect(popup?.textContent).toContain("这张画布还没有生成过内容");
      await m.unmount();
    } finally {
      release();
    }
  });
});
