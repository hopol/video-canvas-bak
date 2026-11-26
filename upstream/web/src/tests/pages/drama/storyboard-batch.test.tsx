import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import type { Drama, EpisodeSummary } from "@/api/drama/type";
import { holdExitAnimations, installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";
import type { StoryboardBatchBody as BodyType } from "@/pages/drama/workspace/storyboard-batch-dialog";
import type { DramaWorkspaceContext as DramaWorkspaceContextType } from "@/pages/drama/workspace/context";
import type { Dialog as DialogType } from "@/components/ui/dialog";

/**
 * 批量生成分镜脚本弹窗：选集、按集分别估价后加总、每集各提交一个任务并同时发出。
 */

let dom: DomEnv;
let Body: typeof BodyType;
let DramaWorkspaceContext: typeof DramaWorkspaceContextType;
let Dialog: typeof DialogType;
beforeAll(async () => {
  dom = await installDom();
  Body = (await import("@/pages/drama/workspace/storyboard-batch-dialog")).StoryboardBatchBody;
  DramaWorkspaceContext = (await import("@/pages/drama/workspace/context")).DramaWorkspaceContext;
  Dialog = (await import("@/components/ui/dialog")).Dialog;
}, 60_000);
afterAll(() => dom?.restore());

const ep = (no: number, patch: Partial<EpisodeSummary> = {}) =>
  ({
    no,
    title: `第${no}集`,
    scriptStatus: "ready",
    locked: true,
    storyboardStatus: "empty",
    segmentCount: 0,
    doneSegmentCount: 0,
    revision: 1,
    ...patch,
  }) as EpisodeSummary;

/** 1–3 可生成，4 没拆解，5 已有分镜 */
const drama = {
  id: "d1",
  episodes: [ep(1), ep(2), ep(3), ep(4, { locked: false }), ep(5, { storyboardStatus: "ready" })],
} as unknown as Drama;

let post: ReturnType<typeof spyOn>;
/** 提交时要失败的集号 → 错误码 */
let failOn: Record<number, number> = {};
/** 提交的到达顺序与是否已全部发出：验证是同时发出，不是等上一个回来再发下一个 */
let inflight = 0;
let maxInflight = 0;
beforeEach(() => {
  failOn = {};
  inflight = 0;
  maxInflight = 0;
  post = spyOn(service, "post").mockImplementation((async (url: string, body: unknown) => {
    const { episodes, step } = body as { episodes: number[]; step: string };
    if (url.endsWith("/estimate")) return { credits: 10 * episodes[0], gap_episodes: [] };
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inflight -= 1;
    const code = failOn[episodes[0]];
    if (code) throw Object.assign(new Error("业务错误"), { code, msg: "业务错误" });
    return {
      id: `j${episodes[0]}`,
      step,
      episodes,
      status: "queued",
      progress: 0,
      credits: 0,
      error_code: 0,
      error_message: "",
      created_at: "2026-11-16T10:00:00Z",
      finished_at: null,
      lane: "user",
    };
  }) as never);
});
afterEach(() => post.mockRestore());

const mount = (node: React.ReactElement) =>
  dom.mount(
    <DramaWorkspaceContext.Provider value={{ drama, jobs: [], refresh: async () => {} } as never}>
      <Dialog open>{node}</Dialog>
    </DramaWorkspaceContext.Provider>,
  );
const cell = (c: HTMLElement, no: number) =>
  [...c.querySelectorAll('[data-slot="episode-grid"] button')].find((b) =>
    (b.textContent ?? "").startsWith(`${no}.`),
  ) as HTMLButtonElement;
const picked = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-slot="episode-grid"] button[aria-pressed="true"]')].map((b) =>
    Number((b.textContent ?? "").match(/^(\d+)\./)?.[1]),
  );
const byText = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
const jobCalls = () => post.mock.calls.filter((c) => c[0] === "/dramas/d1/jobs");

describe("批量生成分镜脚本弹窗", () => {
  test("预选当前集；没拆解、已有分镜的置灰；全选只选能生成的", async () => {
    const m = await mount(
      <Body initial={2} storyboard={{ maxSeconds: 15, videoModel: "h3" }} onClose={() => {}} />,
    );
    expect(picked(m.container)).toEqual([2]);
    expect(cell(m.container, 4).disabled).toBe(true);
    expect(cell(m.container, 4).title).toBe("还没拆解");
    expect(cell(m.container, 5).title).toBe("已有分镜");
    await dom.click(byText(m.container, "全选可用"));
    expect(picked(m.container)).toEqual([1, 2, 3]);
    await m.unmount();
  });

  test("积分：每集单独估价再加总（分镜接口一次只估一集）", async () => {
    const m = await mount(
      <Body initial={1} storyboard={{ maxSeconds: 15, videoModel: "h3" }} onClose={() => {}} />,
    );
    await dom.click(byText(m.container, "全选可用"));
    await dom.flush(400);
    const estimates = post.mock.calls.filter((c) => String(c[0]).endsWith("/estimate"));
    expect(estimates.every((c) => (c[1] as { episodes: number[] }).episodes.length === 1)).toBe(
      true,
    );
    expect(estimates.at(-1)?.[1]).toMatchObject({
      step: "storyboard",
      max_seconds: 15,
      video_model: "h3",
    });
    // 10 + 20 + 30
    expect(m.container.textContent).toContain("约 60 积分");
    await m.unmount();
  });

  test("提交：每集一个任务，同时发出；全部成功后关闭", async () => {
    let closed = 0;
    const m = await mount(
      <Body
        initial={1}
        storyboard={{ maxSeconds: 15, videoModel: "h3" }}
        onClose={() => (closed += 1)}
      />,
    );
    await dom.click(byText(m.container, "全选可用"));
    await dom.click(byText(m.container, "生成 3 集脚本"));
    await dom.flush(100);
    expect(jobCalls().map((c) => (c[1] as { episodes: number[] }).episodes)).toEqual([
      [1],
      [2],
      [3],
    ]);
    expect(jobCalls()[0][1]).toMatchObject({
      step: "storyboard",
      max_seconds: 15,
      video_model: "h3",
    });
    expect(maxInflight).toBe(3);
    expect(closed).toBe(1);
    await m.unmount();
  });

  test("部分失败：成功的照常提交并关闭，失败的不影响其他集", async () => {
    failOn = { 2: 67004 };
    let closed = 0;
    const m = await mount(
      <Body
        initial={1}
        storyboard={{ maxSeconds: 15, videoModel: "h3" }}
        onClose={() => (closed += 1)}
      />,
    );
    await dom.click(byText(m.container, "全选可用"));
    await dom.click(byText(m.container, "生成 3 集脚本"));
    await dom.flush(100);
    expect(jobCalls()).toHaveLength(3);
    expect(closed).toBe(1);
    await m.unmount();
  });

  test("全部失败：不关闭，弹窗里写明原因", async () => {
    failOn = { 1: 67004 };
    let closed = 0;
    const m = await mount(
      <Body
        initial={1}
        storyboard={{ maxSeconds: 15, videoModel: "h3" }}
        onClose={() => (closed += 1)}
      />,
    );
    await dom.click(byText(m.container, "生成 1 集脚本"));
    await dom.flush(100);
    expect(closed).toBe(0);
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain("第 1 集");
    await m.unmount();
  });
});

describe("批量生成分镜脚本弹窗的开关", () => {
  test("关闭时内容不先卸载：退出动画期间弹窗里仍是原来的内容", async () => {
    const { StoryboardBatchButton } =
      await import("@/pages/drama/workspace/storyboard-batch-dialog");
    const release = holdExitAnimations(dom);
    try {
      const m = await dom.mount(
        <DramaWorkspaceContext.Provider
          value={{ drama, jobs: [], refresh: async () => {} } as never}
        >
          <StoryboardBatchButton current={1} storyboard={{ maxSeconds: 15, videoModel: "h3" }} />
        </DramaWorkspaceContext.Provider>,
      );
      const body = dom.win.document.body;
      await dom.click(byText(m.container, "批量生成脚本"));
      await dom.click(byText(body, "取消"));
      const popup = body.querySelector('[data-slot="dialog-content"]');
      expect(popup?.hasAttribute("data-ending-style")).toBe(true);
      expect(popup?.textContent).toContain("选择集数");
      await m.unmount();
    } finally {
      release();
    }
  });
});
