import { describe, expect, test } from "bun:test";

import type { DramaJob } from "@/api/drama/type";
import {
  activeStoryboardJob,
  busyReason,
  episodesLabel,
  failedJobs,
  runningByEpisode,
  taskGroups,
  taskSummary,
  jobRunningText,
  jobStage,
  isActiveJob,
  isPipelineJob,
  jobConflictReason,
  userJobs,
  planningRow,
  pipelineEta,
  etaLabel,
  jobTitle,
  mergeJob,
  pruneFinished,
  reconcileJobs,
  retryEpisodes,
  writingAssetPrompts,
} from "@/utils/drama/jobs";

const job = (patch: Partial<DramaJob> = {}): DramaJob => ({
  id: "j1",
  step: "breakdown",
  episodes: [1],
  status: "running",
  progress: 20,
  credits: 0,
  errorCode: 0,
  errorMessage: "",
  createdAt: "2026-10-28T10:00:00Z",
  startedAt: null,
  finishedAt: null,
  lane: "user",
  batchFrom: null,
  batchTo: null,
  ...patch,
});

describe("任务合并 mergeJob", () => {
  test("新任务插入，按创建时间新的在前", () => {
    const merged = mergeJob(
      [job({ id: "old", createdAt: "2026-10-28T09:00:00Z" })],
      job({ id: "new", createdAt: "2026-10-28T10:00:00Z" }),
    );
    expect(merged.map((j) => j.id)).toEqual(["new", "old"]);
  });

  test("同 id 更新状态与进度", () => {
    const merged = mergeJob([job({ progress: 20 })], job({ progress: 60 }));
    expect(merged).toHaveLength(1);
    expect(merged[0].progress).toBe(60);
  });

  test("进度不回退：乱序到达的旧进度被忽略", () => {
    const merged = mergeJob([job({ progress: 60 })], job({ progress: 30 }));
    expect(merged[0].progress).toBe(60);
  });

  test("终态不被迟到的非终态事件覆盖", () => {
    const done = job({ status: "succeeded", progress: 100, finishedAt: "2026-10-28T10:05:00Z" });
    expect(mergeJob([done], job({ status: "running", progress: 80 }))[0].status).toBe("succeeded");
    expect(mergeJob([done], job({ status: "queued", progress: 0 }))[0].status).toBe("succeeded");
  });

  test("running 不会退回 queued", () => {
    expect(
      mergeJob([job({ status: "running" })], job({ status: "queued", progress: 0 }))[0].status,
    ).toBe("running");
  });

  test("成功收尾：进度补到 100 并带上扣费", () => {
    const merged = mergeJob(
      [job({ progress: 60 })],
      job({ status: "succeeded", progress: 100, credits: 12, finishedAt: "x" }),
    );
    expect(merged[0]).toMatchObject({ status: "succeeded", progress: 100, credits: 12 });
  });
});

describe("挂载 / 重连对账 reconcileJobs", () => {
  test("服务端的进行中任务并入本地", () => {
    const { jobs, ended } = reconcileJobs([], [job({ id: "a" })]);
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
    expect(ended).toEqual([]);
  });

  test("本地还显示进行中、服务端已经没有：算已结束，移出并提示重新拉详情", () => {
    const { jobs, ended } = reconcileJobs([job({ id: "a" }), job({ id: "b" })], [job({ id: "b" })]);
    expect(jobs.map((j) => j.id)).toEqual(["b"]);
    expect(ended.map((j) => j.id)).toEqual(["a"]);
  });

  test("本地已经收到终态的任务（失败卡片）保留，不当成结束", () => {
    const failed = job({ id: "f", status: "failed", errorCode: 67008 });
    const { jobs, ended } = reconcileJobs([failed], []);
    expect(jobs).toEqual([failed]);
    expect(ended).toEqual([]);
  });

  test("服务端的新进度覆盖本地旧进度", () => {
    const { jobs } = reconcileJobs([job({ progress: 10 })], [job({ progress: 50 })]);
    expect(jobs[0].progress).toBe(50);
  });
});

describe("展示与禁用原因", () => {
  test("任务标题", () => {
    expect(jobTitle(job({ step: "analyze", episodes: [] }))).toBe("研读剧本");
    expect(jobTitle(job({ step: "outline", episodes: [] }))).toBe("故事大纲与人物");
    expect(jobTitle(job({ step: "scripts", episodes: [3, 4, 5] }))).toBe("分集剧本 · 3 集");
    expect(jobTitle(job({ step: "breakdown", episodes: [2] }))).toBe("资产拆解 · 第 2 集");
    expect(jobTitle(job({ step: "breakdown", episodes: [1, 2, 3] }))).toBe("资产拆解 · 3 集");
    expect(jobTitle(job({ step: "asset_prompts", episodes: [] }))).toBe("写资产提示词");
  });

  test("有进行中任务时给禁用原因，否则为 null", () => {
    expect(busyReason([])).toBeNull();
    expect(busyReason([job({ status: "succeeded" })])).toBeNull();
    expect(busyReason([job({ status: "failed" })])).toBeNull();
    expect(busyReason([job({ status: "running", step: "scripts", episodes: [2, 3] })])).toContain(
      "分集剧本",
    );
    expect(busyReason([job({ status: "queued" })])).not.toBeNull();
  });

  test("jobConflictReason 与后端同规则：分镜/合成只和同一集的分镜/合成冲突", () => {
    const sb3 = job({ step: "storyboard", episodes: [3] });
    expect(jobConflictReason([sb3], "storyboard", [4])).toBeNull();
    expect(jobConflictReason([sb3], "storyboard", [3])).toContain("第 3 集");
    expect(jobConflictReason([sb3], "compose", [3])).toContain("分镜脚本");
    expect(jobConflictReason([sb3], "compose", [5])).toBeNull();
    expect(
      jobConflictReason(
        [job({ step: "storyboard", episodes: [3], status: "succeeded" })],
        "storyboard",
        [3],
      ),
    ).toBeNull();
    // 文本任务不挡分镜，分镜也不挡文本任务
    expect(
      jobConflictReason([job({ step: "scripts", episodes: [3] })], "storyboard", [3]),
    ).toBeNull();
    expect(jobConflictReason([sb3], "breakdown", [3])).toBeNull();
    // 文本任务之间互斥，不看集号
    expect(
      jobConflictReason([job({ step: "scripts", episodes: [1] })], "breakdown", [9]),
    ).toContain("分集剧本");
    // 自动规划不挡用户任务
    expect(
      jobConflictReason([job({ step: "plan", lane: "pipeline", episodes: [] })], "storyboard", [3]),
    ).toBeNull();
    // 没写集号的非文本任务按全项目算
    expect(
      jobConflictReason([job({ step: "compose", episodes: [] })], "storyboard", [3]),
    ).not.toBeNull();
  });

  test("isActiveJob", () => {
    expect(isActiveJob(job({ status: "queued" }))).toBe(true);
    expect(isActiveJob(job({ status: "running" }))).toBe(true);
    expect(isActiveJob(job({ status: "canceled" }))).toBe(false);
  });

  test("只保留最近几条已结束的任务，进行中的全留", () => {
    const jobs = [
      job({ id: "r", status: "running", createdAt: "2026-10-28T10:10:00Z" }),
      ...[1, 2, 3, 4].map((n) =>
        job({ id: `d${n}`, status: "succeeded", createdAt: `2026-10-28T10:0${n}:00Z` }),
      ),
    ];
    const pruned = pruneFinished(jobs, 2);
    expect(pruned.map((j) => j.id)).toEqual(["r", "d4", "d3"]);
  });
});

describe("activeStoryboardJob", () => {
  test("找出正在给这一集生成分镜的任务", () => {
    const sb = job({ id: "s", step: "storyboard", episodes: [2] });
    const jobs = [job({ id: "b" }), sb, job({ id: "d", step: "storyboard", status: "succeeded" })];
    expect(activeStoryboardJob(jobs, 2)?.id).toBe("s");
    expect(activeStoryboardJob(jobs, 1)).toBeUndefined();
  });
});

describe("任务面板：失败的任务", () => {
  test("每条失败都列出（批量分镜可能几集同时失败），自动规划的不算", () => {
    const jobs = [
      job({ id: "a", step: "storyboard", episodes: [2], status: "failed" }),
      job({ id: "b", step: "storyboard", episodes: [3], status: "failed" }),
      job({ id: "p", step: "plan", lane: "pipeline", episodes: [], status: "failed" }),
      job({ id: "c", status: "canceled" }),
    ];
    expect(failedJobs(jobs).map((j) => j.id)).toEqual(["a", "b"]);
  });

  test("同一步骤、同一集后来又提交过（重试成功或正在跑）的旧失败不再显示；别的集不受影响", () => {
    const jobs = [
      job({
        id: "new",
        step: "storyboard",
        episodes: [2],
        status: "succeeded",
        createdAt: "2026-10-28T11:00:00Z",
      }),
      job({
        id: "old",
        step: "storyboard",
        episodes: [2],
        status: "failed",
        createdAt: "2026-10-28T10:00:00Z",
      }),
      job({
        id: "other",
        step: "storyboard",
        episodes: [3],
        status: "failed",
        createdAt: "2026-10-28T10:00:00Z",
      }),
    ];
    expect(failedJobs(jobs).map((j) => j.id)).toEqual(["other"]);
  });
});

describe("任务面板：按步骤分组", () => {
  test("进行中的按步骤合成一组，组内按集号排；组的顺序按最早出现", () => {
    const groups = taskGroups([
      job({ id: "s5", step: "storyboard", episodes: [5], progress: 0, status: "queued" }),
      job({ id: "s2", step: "storyboard", episodes: [2], progress: 40 }),
      job({ id: "sc", step: "scripts", episodes: [7, 8], progress: 10 }),
      job({ id: "f", step: "storyboard", episodes: [3], status: "failed" }),
    ]);
    expect(groups.map((g) => [g.step, g.jobs.map((j) => j.id), g.progress])).toEqual([
      ["storyboard", ["s2", "s5"], 20],
      ["scripts", ["sc"], 10],
    ]);
    expect(groups[0].episodes).toEqual([2, 5]);
  });
});

describe("分集栏：每集正在跑的任务", () => {
  test("排队或进行中的用户任务按集号索引；结束的、自动规划的不算", () => {
    const map = runningByEpisode([
      job({ id: "a", step: "storyboard", episodes: [2] }),
      job({ id: "b", step: "scripts", episodes: [3, 4], status: "queued" }),
      job({ id: "c", step: "storyboard", episodes: [5], status: "succeeded" }),
      job({ id: "p", step: "plan", lane: "pipeline", episodes: [6] }),
    ]);
    expect([...map].map(([no, j]) => [no, j.id])).toEqual([
      [2, "a"],
      [3, "b"],
      [4, "b"],
    ]);
  });
});

describe("集号范围的写法", () => {
  test("一集、连续、不连续（超过 4 个写「等」）", () => {
    expect(episodesLabel([3])).toBe("第 3 集");
    expect(episodesLabel([4, 2, 3, 5])).toBe("第 2–5 集");
    expect(episodesLabel([1, 3, 7])).toBe("第 1、3、7 集");
    expect(episodesLabel([1, 3, 5, 7, 9])).toBe("第 1、3、5、7 等 5 集");
  });
});

describe("任务胶囊的摘要", () => {
  const plan = {
    kind: "running",
    title: "正在规划第 301–312 章",
    detail: "",
    progress: 60,
  } as const;

  test("没有进行中、没有失败、规划没暂停：不显示", () => {
    expect(taskSummary([job({ status: "succeeded" })], null)).toBeNull();
  });

  test("只有一个任务：写任务名和集号，进度就是它的", () => {
    expect(taskSummary([job({ step: "storyboard", episodes: [2], progress: 18 })], null)).toEqual({
      label: "分镜脚本 · 第 2 集",
      progress: 18,
      failed: 0,
    });
    expect(taskSummary([], plan)).toEqual({ label: plan.title, progress: 60, failed: 0 });
  });

  test("多个任务：写个数，进度取平均；规划也算一个", () => {
    const jobs = [
      job({ id: "a", progress: 20 }),
      job({ id: "b", step: "storyboard", progress: 40 }),
    ];
    expect(taskSummary(jobs, plan)).toEqual({ label: "3 个任务", progress: 40, failed: 0 });
  });

  test("有失败：数上失败的（含规划因错暂停）；只剩失败时没有进度", () => {
    const paused = {
      kind: "paused",
      tone: "error",
      title: "分集规划暂停",
      reason: "",
      actions: [],
    } as const;
    expect(taskSummary([job({ status: "failed" })], paused)).toEqual({
      label: null,
      progress: null,
      failed: 2,
    });
  });

  test("规划被用户暂停、别的都没有：胶囊写「分集规划已暂停」，方便点开继续", () => {
    const paused = {
      kind: "paused",
      tone: "muted",
      title: "分集规划已暂停",
      reason: "",
      actions: [],
    } as const;
    expect(taskSummary([], paused)).toEqual({ label: "分集规划已暂停", progress: null, failed: 0 });
  });
});

describe("任务文案与落点", () => {
  test("进行中的话术", () => {
    expect(jobRunningText("breakdown")).toBe("正在拆解剧本资产…");
    expect(jobRunningText("analyze")).toBe("正在研读剧本…");
  });

  test("每个步骤对应的工序页", () => {
    expect(jobStage("analyze")).toBe("script");
    expect(jobStage("scripts")).toBe("script");
    expect(jobStage("breakdown")).toBe("assets");
    expect(jobStage("asset_prompts")).toBe("assets");
    expect(jobStage("storyboard")).toBe("studio");
    expect(jobStage("compose")).toBe("final");
  });
});

describe("两条线：pipeline 自动规划与 user 用户任务", () => {
  test("pipeline 线：研读 / 规划；没带 lane 的老任务按步骤判断", () => {
    expect(isPipelineJob(job({ lane: "pipeline", step: "plan" }))).toBe(true);
    expect(isPipelineJob(job({ lane: "user", step: "scripts" }))).toBe(false);
    expect(isPipelineJob(job({ lane: "user", step: "analyze" }))).toBe(true);
  });

  test("用户任务不含 pipeline；busyReason 不被规划拦住（互不阻塞）", () => {
    const plan = job({ id: "p", lane: "pipeline", step: "plan", episodes: [] });
    const scripts = job({ id: "s", step: "scripts", episodes: [1] });
    expect(userJobs([plan, scripts]).map((j) => j.id)).toEqual(["s"]);
    expect(busyReason([plan])).toBeNull();
    expect(busyReason([plan, scripts])).toContain("分集剧本");
  });

  test("规划任务标题", () => {
    expect(jobTitle(job({ step: "plan", episodes: [] }))).toBe("分集规划");
    expect(jobRunningText("plan")).toContain("规划");
  });
});

describe("JobBar 规划行 planningRow", () => {
  const drama = (patch: Record<string, unknown> = {}) => ({
    phase: "running" as const,
    planCursor: 0,
    rangeEnd: 1215,
    pauseReason: "",
    pauseCode: "" as const,
    unitKind: "chapter" as const,
    episodes: [] as { no: number }[],
    ...patch,
  });

  test("完成（done）没有规划行", () => {
    expect(planningRow(drama({ phase: "done" }), [])).toBeNull();
  });

  test("研读中：正在粗读全书", () => {
    const row = planningRow(drama(), [
      job({ lane: "pipeline", step: "analyze", episodes: [], progress: 30 }),
    ]);
    expect(row).toMatchObject({ kind: "running", title: "正在粗读全书", progress: 30 });
    expect(row?.kind === "running" && row.detail).toContain("研读");
  });

  test("研读中有粗读中位耗时：进度按已用时间 ÷ 中位耗时往前走，最多 90%", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    const eta = { analyzeSeconds: 40, planSeconds: 0, planBatchesLeft: 0 };
    const analyze = (seconds: number) =>
      job({
        lane: "pipeline",
        step: "analyze",
        episodes: [],
        progress: 0,
        startedAt: new Date(now - seconds * 1000).toISOString(),
      });
    expect(planningRow(drama({ eta }), [analyze(10)], now)).toMatchObject({ progress: 25 });
    expect(planningRow(drama({ eta }), [analyze(120)], now)).toMatchObject({ progress: 90 });
    // 历史不足：保持后端给的进度
    expect(
      planningRow(drama({ eta: { ...eta, analyzeSeconds: 0 } }), [analyze(10)], now),
    ).toMatchObject({ progress: 0 });
  });

  test("规划中：正在规划第 a–b 章 · 已出 N 集目录，进度按规划游标 / 范围终点", () => {
    const row = planningRow(
      drama({
        planCursor: 300,
        rangeEnd: 1200,
        episodes: Array.from({ length: 52 }, (_, i) => ({ no: i + 1 })),
      }),
      [job({ lane: "pipeline", step: "plan", episodes: [], batchFrom: 301, batchTo: 312 })],
    );
    expect(row).toMatchObject({
      kind: "running",
      title: "正在规划第 301–312 章",
      progress: 25,
    });
    expect(row?.kind === "running" && row.detail).toContain("已出 52 集目录");
  });

  test("规划行的单位跟着单元种类：场 / 段 / 集", () => {
    const row = planningRow(drama({ unitKind: "scene" }), [
      job({ lane: "pipeline", step: "plan", episodes: [], batchFrom: 8, batchTo: 8 }),
    ]);
    expect(row?.kind === "running" && row.title).toBe("正在规划第 8 场");
  });

  test("两批之间还没有进行中任务：不报错，写「正在规划」", () => {
    const row = planningRow(drama({ planCursor: 12 }), []);
    expect(row).toMatchObject({ kind: "running", title: "正在规划" });
  });

  test("用户暂停：已规划到第 N 章，操作只有「继续」", () => {
    const row = planningRow(drama({ phase: "paused", pauseCode: "user", planCursor: 44 }), []);
    expect(row).toMatchObject({
      kind: "paused",
      tone: "muted",
      title: "分集规划已暂停",
      actions: ["resume"],
    });
    expect(row?.kind === "paused" && row.reason).toContain("已规划到第 44 章");
  });

  test("积分不足：充值后继续；失败 / 上下文不足：重试", () => {
    expect(planningRow(drama({ phase: "paused", pauseCode: "credits" }), [])).toMatchObject({
      tone: "error",
      reason: "积分不足，充值后继续",
      actions: ["resume"],
    });
    expect(
      planningRow(drama({ phase: "paused", pauseCode: "failed", pauseReason: "模型超时" }), []),
    ).toMatchObject({ title: "分集规划暂停", actions: ["retry"] });
    const failed = planningRow(
      drama({ phase: "paused", pauseCode: "failed", pauseReason: "模型超时" }),
      [],
    );
    expect(failed?.kind === "paused" && failed.reason).toContain("模型超时");
    expect(planningRow(drama({ phase: "paused", pauseCode: "context" }), [])).toMatchObject({
      actions: ["retry"],
    });
  });

  test("自定义提示词导致失败：多一个「改用内置重试」", () => {
    expect(planningRow(drama({ phase: "paused", pauseCode: "custom_prompt" }), [])).toMatchObject({
      tone: "error",
      actions: ["retry", "builtin"],
    });
  });

  test("没有暂停原因分类（老数据）按用户暂停处理", () => {
    expect(planningRow(drama({ phase: "paused" }), [])).toMatchObject({ actions: ["resume"] });
  });
});

describe("自动规划还要多久 pipelineEta", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const eta = { analyzeSeconds: 40, planSeconds: 120, planBatchesLeft: 3 };
  const drama = (patch: Record<string, unknown> = {}) => ({
    phase: "running" as const,
    eta,
    ...patch,
  });
  const analyze = (startedAt: string | null) =>
    job({ lane: "pipeline", step: "analyze", episodes: [], startedAt, progress: 0 });
  const plan = (startedAt: string | null) =>
    job({ lane: "pipeline", step: "plan", episodes: [], startedAt });

  test("粗读中：粗读剩余 = 中位耗时 − 已跑时间；规划按批次 × 每批中位耗时；合计两者", () => {
    expect(pipelineEta(drama(), [analyze(ago(10))], now)).toEqual({
      analyze: 30,
      plan: 360,
      total: 390,
    });
  });

  test("粗读还在排队：剩余就是完整的中位耗时", () => {
    expect(pipelineEta(drama(), [analyze(null)], now).analyze).toBe(40);
  });

  test("超过中位耗时：剩余为 0（界面写「即将完成」），不出现负数", () => {
    expect(pipelineEta(drama(), [analyze(ago(90))], now)).toMatchObject({ analyze: 0, total: 360 });
  });

  test("规划中：当前批扣掉已跑时间，再加后面的批次", () => {
    expect(pipelineEta(drama(), [plan(ago(20))], now)).toEqual({
      analyze: null,
      plan: 340,
      total: 340,
    });
  });

  test("历史不足（秒数为 0）的步骤不估：粗读不知道就没有合计，规划不知道也没有合计", () => {
    expect(
      pipelineEta(drama({ eta: { ...eta, analyzeSeconds: 0 } }), [analyze(ago(10))], now),
    ).toEqual({ analyze: null, plan: 360, total: null });
    expect(pipelineEta(drama({ eta: { ...eta, planSeconds: 0 } }), [plan(ago(10))], now)).toEqual({
      analyze: null,
      plan: null,
      total: null,
    });
  });

  test("没有预计原料或不在规划中：都没有", () => {
    const none = { analyze: null, plan: null, total: null };
    expect(pipelineEta(drama({ eta: null }), [analyze(ago(10))], now)).toEqual(none);
    expect(pipelineEta(drama({ phase: "paused" }), [], now)).toEqual(none);
  });
});

describe("还需多久的文案 etaLabel", () => {
  test("0 秒写「即将完成」，不到一分钟写「还需不到 1 分钟」，其余按分钟 / 小时", () => {
    expect(etaLabel(0)).toBe("即将完成");
    expect(etaLabel(30)).toBe("还需不到 1 分钟");
    expect(etaLabel(390)).toBe("还需约 7 分钟");
    expect(etaLabel(9000)).toBe("还需约 2.5 小时");
  });
});

describe("资产提示词是否在写 writingAssetPrompts", () => {
  test("拆解边拆边写提示词，进行中的拆解和提示词任务都算", () => {
    expect(writingAssetPrompts([job({ step: "breakdown", status: "running" })])).toBe(true);
    expect(writingAssetPrompts([job({ step: "asset_prompts", status: "queued" })])).toBe(true);
  });

  test("已结束的任务和其他步骤不算", () => {
    expect(writingAssetPrompts([job({ step: "breakdown", status: "succeeded" })])).toBe(false);
    expect(writingAssetPrompts([job({ step: "scripts", status: "running" })])).toBe(false);
    expect(writingAssetPrompts([])).toBe(false);
  });
});

describe("重试时的集号 retryEpisodes", () => {
  const eps = [
    { no: 1, locked: true },
    { no: 2, locked: false },
    { no: 3, locked: true },
  ];

  test("拆解中途失败已写入的批次会锁集，重试只拆还没锁的集", () => {
    expect(retryEpisodes(job({ step: "breakdown", episodes: [1, 2, 3] }), eps)).toEqual([2]);
  });

  test("其他步骤原样重试", () => {
    expect(retryEpisodes(job({ step: "asset_prompts", episodes: [1, 3] }), eps)).toEqual([1, 3]);
  });
});
