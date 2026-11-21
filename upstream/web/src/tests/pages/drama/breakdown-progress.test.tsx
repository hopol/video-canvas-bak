import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { DramaJob } from "@/api/drama/type";
import type { BreakdownProgress as BreakdownProgressType } from "@/pages/drama/workspace/breakdown-progress";
import type { DramaWorkspace } from "@/pages/drama/workspace/use-workspace";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

/**
 * 资产管理顶栏的拆解进度：有进行中的拆解任务时就地显示集数、百分比和取消，
 * 排队时写「排队中」，没有拆解任务时什么都不显示。
 */

let dom: DomEnv;
let BreakdownProgress: typeof BreakdownProgressType;
let Context: typeof import("@/pages/drama/workspace/context").DramaWorkspaceContext;
beforeAll(async () => {
  dom = await installDom();
  BreakdownProgress = (await import("@/pages/drama/workspace/breakdown-progress"))
    .BreakdownProgress;
  Context = (await import("@/pages/drama/workspace/context")).DramaWorkspaceContext;
}, 60_000);
afterAll(() => dom?.restore());

const job = (patch: Partial<DramaJob>): DramaJob =>
  ({
    id: "b1",
    step: "breakdown",
    episodes: [7, 8],
    status: "running",
    progress: 90,
    lane: "user",
    createdAt: "2026-11-16T10:00:00Z",
    ...patch,
  }) as DramaJob;

async function render(jobs: DramaJob[]) {
  const view = await dom.mount(
    <Context.Provider
      value={{ drama: { id: "d1", episodes: [] }, jobs } as unknown as DramaWorkspace}
    >
      <BreakdownProgress />
    </Context.Provider>,
  );
  const status = view.container.querySelector('[role="status"]');
  const text = status?.textContent ?? "";
  const hasCancel = [...view.container.querySelectorAll("button")].some((b) =>
    (b.textContent ?? "").includes("取消"),
  );
  await view.unmount();
  return { status, text, hasCancel };
}

describe("资产管理：拆解进度", () => {
  test("拆解进行中：显示集数、百分比和取消", async () => {
    const { text, hasCancel } = await render([job({})]);
    expect(text).toContain("拆解第 7–8 集");
    expect(text).toContain("90%");
    expect(hasCancel).toBe(true);
  });

  test("排队中：写「排队中」，不写百分比", async () => {
    const { text } = await render([job({ status: "queued", progress: 0 })]);
    expect(text).toContain("排队中");
    expect(text).not.toContain("0%");
  });

  test("没有进行中的拆解（其它任务、已完成的拆解）：不显示", async () => {
    const { status } = await render([
      job({ step: "storyboard" }),
      job({ id: "b0", status: "succeeded", progress: 100 }),
    ]);
    expect(status).toBeNull();
  });
});
