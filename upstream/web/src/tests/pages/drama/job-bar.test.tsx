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

import type { Drama, DramaJob } from "@/api/drama/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";
import type { TaskPill as TaskPillType } from "@/pages/drama/workspace/job-bar";
import type { DramaWorkspaceContext as DramaWorkspaceContextType } from "@/pages/drama/workspace/context";

/**
 * 顶栏任务胶囊和任务面板：自动规划（研读 / 规划第 a–b 章 / 暂停 / 失败 / 改用内置重试）、
 * 用户任务按步骤分组（批量分镜一集一个任务）、失败任务的原因与任务 ID。
 */

let dom: DomEnv;
let TaskPill: typeof TaskPillType;
let DramaWorkspaceContext: typeof DramaWorkspaceContextType;
beforeAll(async () => {
  dom = await installDom();
  TaskPill = (await import("@/pages/drama/workspace/job-bar")).TaskPill;
  DramaWorkspaceContext = (await import("@/pages/drama/workspace/context")).DramaWorkspaceContext;
}, 60_000);
afterAll(() => dom?.restore());

const job = (patch: Partial<DramaJob> = {}): DramaJob => ({
  id: "j1",
  step: "plan",
  episodes: [],
  status: "running",
  progress: 10,
  credits: 0,
  errorCode: 0,
  errorMessage: "",
  createdAt: "2026-11-04T10:00:00Z",
  startedAt: null,
  finishedAt: null,
  result: null,
  lane: "pipeline",
  batchFrom: 301,
  batchTo: 312,
  ...patch,
});

/** 用户发起的单集分镜任务 */
const sb = (no: number, patch: Partial<DramaJob> = {}) =>
  job({
    id: `s${no}`,
    step: "storyboard",
    lane: "user",
    episodes: [no],
    batchFrom: null,
    batchTo: null,
    ...patch,
  });

const drama = (patch: Partial<Drama> = {}) =>
  ({
    id: "d1",
    phase: "running",
    planCursor: 300,
    rangeEnd: 1200,
    pauseReason: "",
    pauseCode: "",
    unitKind: "chapter",
    eta: { analyzeSeconds: 40, planSeconds: 120, planBatchesLeft: 75 },
    ratio: "9:16",
    episodes: Array.from({ length: 52 }, (_, i) => ({ no: i + 1 })),
    ...patch,
  }) as unknown as Drama;

let post: ReturnType<typeof spyOn>;
let refreshed = 0;
beforeEach(() => {
  post = spyOn(service, "post").mockImplementation((async (url: string) => {
    const hit = url.match(/jobs\/(\w+)\/cancel$/);
    if (!hit) return {};
    return {
      id: hit[1],
      step: "storyboard",
      episodes: [Number(hit[1].slice(1))],
      status: "canceled",
      progress: 0,
      credits: 0,
      error_code: 0,
      error_message: "",
      created_at: "2026-11-04T10:00:00Z",
      finished_at: null,
      lane: "user",
    };
  }) as never);
  refreshed = 0;
});
afterEach(() => post.mockRestore());

let went: Array<[string, number | undefined]> = [];
const mountPill = (d: Drama, jobs: DramaJob[]) => {
  went = [];
  return dom.mount(
    <DramaWorkspaceContext.Provider
      value={
        {
          drama: d,
          jobs,
          refresh: async () => {
            refreshed += 1;
          },
        } as never
      }
    >
      <TaskPill onGo={(stage, no) => went.push([stage, no])} />
    </DramaWorkspaceContext.Provider>,
  );
};
const pill = (c: HTMLElement) => c.querySelector('[data-slot="task-pill"]') as HTMLElement | null;
/** 点胶囊打开面板（面板渲染在 body 下的浮层里） */
const openPanel = async (c: HTMLElement) => {
  await dom.click(pill(c));
  await dom.flush();
  return document.querySelector('[data-slot="task-panel"]') as HTMLElement;
};
const byText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);

describe("任务胶囊：自动规划", () => {
  test("规划中：胶囊写「正在规划第 301–312 章」和进度；面板里有已出目录、还需多久和「暂停」", async () => {
    const m = await mountPill(drama(), [job()]);
    expect(pill(m.container)?.textContent).toContain("正在规划第 301–312 章");
    expect(pill(m.container)?.textContent).toContain("25%");
    const panel = await openPanel(m.container);
    const row = panel.querySelector('[data-slot="planning-row"]') as HTMLElement;
    expect(row.textContent).toContain("已出 52 集目录");
    expect(row.textContent).toContain("还需约 2.5 小时");
    await dom.click(byText(row, "暂停"));
    await dom.flush();
    expect(post.mock.calls[0][0]).toBe("/dramas/d1/planning/pause");
    expect(refreshed).toBe(1);
    await m.unmount();
  });

  test("历史不足（没有预计原料）：不写还需多久", async () => {
    const m = await mountPill(drama({ eta: null }), [job()]);
    const panel = await openPanel(m.container);
    const row = panel.querySelector('[data-slot="planning-row"]') as HTMLElement;
    expect(row.textContent).toContain("已出 52 集目录");
    expect(row.textContent).not.toContain("还需");
    await m.unmount();
  });

  test("研读中：正在粗读全书", async () => {
    const m = await mountPill(drama({ planCursor: 0 }), [
      job({ step: "analyze", batchFrom: null, batchTo: null, progress: 40 }),
    ]);
    expect(pill(m.container)?.textContent).toContain("正在粗读全书");
    expect(pill(m.container)?.textContent).toContain("40%");
    await m.unmount();
  });

  test("用户暂停：胶囊写「分集规划已暂停」，面板里点「继续」调 resume", async () => {
    const m = await mountPill(drama({ phase: "paused", pauseCode: "user", planCursor: 44 }), []);
    expect(pill(m.container)?.textContent).toContain("分集规划已暂停");
    const panel = await openPanel(m.container);
    expect(panel.textContent).toContain("已规划到第 44 章");
    await dom.click(byText(panel, "继续"));
    await dom.flush();
    expect(post.mock.calls[0][0]).toBe("/dramas/d1/planning/resume");
    await m.unmount();
  });

  test("积分不足、规划失败：胶囊显示 1 个失败；面板写原因，给「继续 / 重试」", async () => {
    const credits = await mountPill(drama({ phase: "paused", pauseCode: "credits" }), []);
    expect(pill(credits.container)?.textContent).toContain("1 个失败");
    const panel = await openPanel(credits.container);
    expect(panel.textContent).toContain("积分不足，充值后继续");
    expect(byText(panel, "继续")).toBeTruthy();
    await credits.unmount();

    const failed = await mountPill(
      drama({ phase: "paused", pauseCode: "failed", pauseReason: "模型超时" }),
      [],
    );
    const panel2 = await openPanel(failed.container);
    expect(panel2.textContent).toContain("模型超时");
    await dom.click(byText(panel2, "重试"));
    await dom.flush();
    expect(post.mock.calls[0][0]).toBe("/dramas/d1/planning/resume");
    await failed.unmount();
  });

  test("自定义提示词导致失败：多一个「改用内置重试」", async () => {
    const m = await mountPill(drama({ phase: "paused", pauseCode: "custom_prompt" }), []);
    const panel = await openPanel(m.container);
    expect(byText(panel, "重试")).toBeTruthy();
    await dom.click(byText(panel, "改用内置重试"));
    await dom.flush();
    expect(post.mock.calls[0][0]).toBe("/dramas/d1/planning/retry-builtin");
    // 改用内置只针对分集规划
    expect(post.mock.calls[0][1]).toEqual({ step: "plan" });
    await m.unmount();
  });

  test("规划完成、没有用户任务：胶囊收起；规划任务失败卡片不当用户任务显示", async () => {
    const m = await mountPill(drama({ phase: "done" }), [
      job({ status: "failed", errorCode: 67015 }),
    ]);
    expect(pill(m.container)).toBeNull();
    expect(m.container.textContent).toBe("");
    await m.unmount();
  });
});

describe("任务胶囊：用户任务", () => {
  test("规划与写剧本同时进行：胶囊写「2 个任务」，面板里各占一组", async () => {
    const m = await mountPill(drama(), [
      job(),
      job({
        id: "u1",
        step: "scripts",
        lane: "user",
        episodes: [1, 2, 3],
        batchFrom: null,
        batchTo: null,
        progress: 50,
      }),
    ]);
    expect(pill(m.container)?.textContent).toContain("2 个任务");
    const panel = await openPanel(m.container);
    const rows = [...panel.querySelectorAll('[role="status"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("正在规划第 301–312 章");
    expect(rows[1].textContent).toContain("分集剧本");
    expect(rows[1].textContent).toContain("第 1–3 集");
    await m.unmount();
  });

  test("批量分镜：4 集合成一组，组头写集数范围和平均进度；排队的写「排队中」；点集号跳到那一集的片场", async () => {
    const m = await mountPill(drama({ phase: "done" }), [
      sb(2, { progress: 40 }),
      sb(3, { progress: 20 }),
      sb(4, { progress: 0, status: "queued" }),
      sb(5, { progress: 0, status: "queued" }),
    ]);
    expect(pill(m.container)?.textContent).toContain("4 个任务");
    expect(pill(m.container)?.textContent).toContain("15%");
    const panel = await openPanel(m.container);
    const group = panel.querySelector('[data-slot="task-group"]') as HTMLElement;
    expect(group.textContent).toContain("分镜脚本");
    expect(group.textContent).toContain("4 集 · 第 2–5 集");
    expect(group.textContent).toContain("排队中");
    await dom.click(byText(group, "第 3 集"));
    expect(went).toEqual([["studio", 3]]);
    await m.unmount();
  });

  test("批量分镜：单独取消一集、全部取消都调取消接口", async () => {
    const m = await mountPill(drama({ phase: "done" }), [sb(2), sb(3)]);
    const panel = await openPanel(m.container);
    await dom.click(panel.querySelector('button[aria-label="取消第 2 集"]'));
    await dom.flush();
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/dramas/d1/jobs/s2/cancel"]);
    await dom.click(byText(panel, "全部取消"));
    await dom.flush();
    expect(
      post.mock.calls
        .map((c) => c[0])
        .slice(1)
        .sort(),
    ).toEqual(["/dramas/d1/jobs/s2/cancel", "/dramas/d1/jobs/s3/cancel"]);
    await m.unmount();
  });

  test("用户任务失败：胶囊红点；面板里有原因和可复制的任务 ID；进行中不显示任务 ID", async () => {
    const userJob = {
      id: "9f3c1a7e5b2d4c6f8a0e1b3d5f7a9c2e",
      step: "scripts",
      lane: "user",
      episodes: [3],
      batchFrom: null,
      batchTo: null,
    } as const;
    const failed = await mountPill(drama({ phase: "done" }), [
      job({ ...userJob, status: "failed", errorCode: 67008, errorMessage: "模型输出无法解析" }),
    ]);
    expect(pill(failed.container)?.textContent).toContain("1 个失败");
    const panel = await openPanel(failed.container);
    expect(panel.textContent).toContain("模型输出无法解析");
    expect(panel.textContent).toContain("任务 ID：9f3c1a7e5b2d4c6f8a0e1b3d5f7a9c2e");
    await failed.unmount();

    const running = await mountPill(drama({ phase: "done" }), [
      job({ ...userJob, status: "running" }),
    ]);
    const panel2 = await openPanel(running.container);
    expect(panel2.textContent).not.toContain("任务 ID");
    await running.unmount();
  });
});
