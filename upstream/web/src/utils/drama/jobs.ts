import type { Drama, DramaJob, DramaStep, EpisodeSummary } from "@/api/drama/type";

import type { WorkspaceStage } from "./stages";
import { durationLabel, unitWord } from "./start-settings";

/** 排队中或进行中 */
export const isActiveJob = (job: Pick<DramaJob, "status">): boolean =>
  job.status === "queued" || job.status === "running";

/** 重试失败任务时提交的集号：拆解中途失败时已写入的批次已锁集，只重拆还没锁的集；其他步骤原样 */
export const retryEpisodes = (
  job: Pick<DramaJob, "step" | "episodes">,
  episodes: readonly Pick<EpisodeSummary, "no" | "locked">[],
): number[] => {
  if (job.step !== "breakdown") return job.episodes;
  const locked = new Set(episodes.filter((ep) => ep.locked).map((ep) => ep.no));
  return job.episodes.filter((no) => !locked.has(no));
};

/** 是否有任务正在写资产提示词：拆解边拆边写，单独的提示词任务也算 */
export const writingAssetPrompts = (jobs: readonly Pick<DramaJob, "step" | "status">[]): boolean =>
  jobs.some(
    (job) => (job.step === "asset_prompts" || job.step === "breakdown") && isActiveJob(job),
  );

const STATUS_RANK: Record<DramaJob["status"], number> = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  canceled: 2,
};

const byCreatedDesc = (a: DramaJob, b: DramaJob) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/**
 * 并入一条任务快照（WebSocket 推送或 HTTP 对账都走这里）：
 * 同 id 更新；终态不被迟到的非终态快照覆盖，状态不倒退（running 不回 queued），进度不回退。
 * 结果按创建时间新的在前。
 */
export function mergeJob(jobs: readonly DramaJob[], incoming: DramaJob): DramaJob[] {
  const existing = jobs.find((job) => job.id === incoming.id);
  let next = incoming;
  if (existing) {
    if (STATUS_RANK[incoming.status] < STATUS_RANK[existing.status]) {
      next = existing;
    } else if (!isActiveJob(existing) && isActiveJob(incoming)) {
      next = existing;
    } else if (isActiveJob(incoming) && incoming.progress < existing.progress) {
      next = { ...incoming, progress: existing.progress };
    }
  }
  return [...jobs.filter((job) => job.id !== incoming.id), next].sort(byCreatedDesc);
}

/**
 * 用服务端的进行中任务对账本地列表：
 * 服务端有的并入（以服务端为准的最新状态）；本地还显示进行中、服务端已经没有的说明在离线期间结束了，
 * 不知道成败，从列表移出并通过 ended 交给调用方重新拉详情；本地已收到终态的卡片（失败待重试）保留。
 */
export function reconcileJobs(
  local: readonly DramaJob[],
  active: readonly DramaJob[],
): { jobs: DramaJob[]; ended: DramaJob[] } {
  const activeIds = new Set(active.map((job) => job.id));
  const ended = local.filter((job) => isActiveJob(job) && !activeIds.has(job.id));
  const endedIds = new Set(ended.map((job) => job.id));
  let jobs = local.filter((job) => !endedIds.has(job.id));
  for (const job of active) jobs = mergeJob(jobs, job);
  return { jobs, ended };
}

/** 保留全部进行中的任务和最近 keep 条已结束的（新的在前） */
export function pruneFinished(jobs: readonly DramaJob[], keep: number): DramaJob[] {
  const sorted = [...jobs].sort(byCreatedDesc);
  let kept = 0;
  return sorted.filter((job) => {
    if (isActiveJob(job)) return true;
    kept += 1;
    return kept <= keep;
  });
}

const STEP_NAME: Record<DramaStep, string> = {
  analyze: "研读剧本",
  plan: "分集规划",
  outline: "故事大纲与人物",
  scripts: "分集剧本",
  breakdown: "资产拆解",
  asset_prompts: "写资产提示词",
  storyboard: "分镜脚本",
  compose: "合成整集",
};

/** 步骤的短名称 */
export const stepName = (step: DramaStep): string => STEP_NAME[step];

/** 进度卡标题：带上范围，如「资产拆解 · 第 2 集」「分集剧本 · 3 集」 */
export function jobTitle(job: Pick<DramaJob, "step" | "episodes">): string {
  const name = STEP_NAME[job.step];
  if (
    job.step === "analyze" ||
    job.step === "plan" ||
    job.step === "outline" ||
    job.step === "asset_prompts"
  ) {
    return name;
  }
  if (job.episodes.length === 0) return name;
  if (
    job.episodes.length === 1 &&
    (job.step === "breakdown" || job.step === "storyboard" || job.step === "compose")
  ) {
    return `${name} · 第 ${job.episodes[0]} 集`;
  }
  return `${name} · ${job.episodes.length} 集`;
}

/** 这条任务是系统自动发起的研读 / 规划（pipeline 线）；没带 lane 的老任务按步骤判断 */
export function isPipelineJob(job: Pick<DramaJob, "lane" | "step">): boolean {
  return (
    job.lane === "pipeline" ||
    job.step === "analyze" ||
    job.step === "outline" ||
    job.step === "plan"
  );
}

/** 用户发起的任务（user 线），不含自动研读 / 规划 */
export const userJobs = (jobs: readonly DramaJob[]): DramaJob[] =>
  jobs.filter((job) => !isPipelineJob(job));

/**
 * 用户任务进行中时给出「为什么不能再提交 / 改集」，没有返回 null。
 * 自动规划（pipeline 线）与用户任务互不阻塞，不算在内。
 */
export function busyReason(jobs: readonly DramaJob[]): string | null {
  const running = userJobs(jobs).find(isActiveJob);
  if (!running) return null;
  return `有进行中的任务：${jobTitle(running)}`;
}

const TEXT_STEPS: readonly DramaStep[] = ["scripts", "breakdown", "asset_prompts"];

/**
 * 提交某一步会不会撞上进行中的任务（与后端 dramaJobsConflict 同规则，撞上即 67004）：
 * 文本任务（剧本 / 拆解 / 资产提示词）之间互斥；分镜、合成只和同一集的分镜、合成冲突，不同集可以并行。
 * 自动规划不算在内。不冲突返回 null。
 * @param step 要提交的步骤
 * @param episodes 要提交的集号
 */
export function jobConflictReason(
  jobs: readonly DramaJob[],
  step: DramaStep,
  episodes: readonly number[],
): string | null {
  const text = TEXT_STEPS.includes(step);
  const hit = userJobs(jobs).find((job) => {
    if (!isActiveJob(job)) return false;
    if (TEXT_STEPS.includes(job.step) !== text) return false;
    if (text || job.episodes.length === 0) return true;
    return episodes.some((no) => job.episodes.includes(no));
  });
  return hit ? `有进行中的任务：${jobTitle(hit)}` : null;
}

const RUNNING_TEXT: Record<DramaStep, string> = {
  analyze: "正在研读剧本…",
  plan: "正在规划分集…",
  outline: "正在整理故事大纲与人物…",
  scripts: "正在生成分集剧本…",
  breakdown: "正在拆解剧本资产…",
  asset_prompts: "正在写资产提示词…",
  storyboard: "正在生成分镜脚本…",
  compose: "正在合成整集…",
};

/** 进行中的话术，如「正在拆解剧本资产…」 */
export const jobRunningText = (step: DramaStep): string => RUNNING_TEXT[step];

const STEP_STAGE: Record<DramaStep, WorkspaceStage> = {
  analyze: "script",
  plan: "script",
  outline: "script",
  scripts: "script",
  breakdown: "assets",
  asset_prompts: "assets",
  storyboard: "studio",
  compose: "final",
};

/** 任务提交后用户该看哪道工序页 */
export const jobStage = (step: DramaStep): WorkspaceStage => STEP_STAGE[step];

/** 正在给第 no 集生成分镜的任务（排队或进行中）；没有为 undefined */
export function activeStoryboardJob(jobs: readonly DramaJob[], no: number): DramaJob | undefined {
  return jobs.find(
    (job) => job.step === "storyboard" && isActiveJob(job) && job.episodes.includes(no),
  );
}

/** 失败的任务是否已被后来的同步骤、有重叠集号的任务取代（重试过） */
const supersededBy = (failed: DramaJob, later: DramaJob): boolean =>
  later.step === failed.step &&
  later.createdAt > failed.createdAt &&
  (failed.episodes.length === 0 ||
    later.episodes.length === 0 ||
    failed.episodes.some((no) => later.episodes.includes(no)));

/**
 * 任务面板里要列的失败任务（用户任务，新的在前）：每条失败都列，直到用户关掉；
 * 同一步骤、同一集后来又提交过的（重试成功或正在跑）就不再显示旧的失败。
 */
export function failedJobs(jobs: readonly DramaJob[]): DramaJob[] {
  const mine = userJobs(jobs);
  return mine
    .filter((job) => job.status === "failed")
    .filter((job) => !mine.some((other) => other.id !== job.id && supersededBy(job, other)))
    .sort(byCreatedDesc);
}

/** 任务面板里的一组：同一步骤的进行中任务 */
export type TaskGroup = {
  step: DramaStep;
  /** 组内任务，按第一个集号从小到大 */
  jobs: DramaJob[];
  /** 组内全部集号，从小到大 */
  episodes: number[];
  /** 平均进度 0–100 */
  progress: number;
};

const average = (values: readonly number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

/**
 * 进行中的用户任务按步骤分组（批量分镜一集一个任务，合成一组显示）。
 * 组的顺序按在列表里第一次出现的位置（列表是新的在前）。
 */
export function taskGroups(jobs: readonly DramaJob[]): TaskGroup[] {
  const groups = new Map<DramaStep, DramaJob[]>();
  for (const job of userJobs(jobs).filter(isActiveJob)) {
    groups.set(job.step, [...(groups.get(job.step) ?? []), job]);
  }
  return [...groups].map(([step, list]) => {
    const sorted = [...list].sort((a, b) => (a.episodes[0] ?? 0) - (b.episodes[0] ?? 0));
    return {
      step,
      jobs: sorted,
      episodes: [...new Set(sorted.flatMap((job) => job.episodes))].sort((a, b) => a - b),
      progress: average(sorted.map((job) => job.progress)),
    };
  });
}

/** 集号写成「第 3 集」「第 2–5 集」「第 1、3、7 集」，不连续超过 4 个写「第 1、3、5、7 等 9 集」 */
export function episodesLabel(episodes: readonly number[]): string {
  const sorted = [...episodes].sort((a, b) => a - b);
  if (sorted.length === 1) return `第 ${sorted[0]} 集`;
  const consecutive = sorted.every((no, i) => i === 0 || no === sorted[i - 1] + 1);
  if (consecutive) return `第 ${sorted[0]}–${sorted.at(-1)} 集`;
  if (sorted.length <= 4) return `第 ${sorted.join("、")} 集`;
  return `第 ${sorted.slice(0, 4).join("、")} 等 ${sorted.length} 集`;
}

/** 顶栏任务胶囊的摘要 */
export type TaskSummary = {
  /** 主文案：一个任务写名称，多个写「N 个任务」；只剩失败时为 null */
  label: string | null;
  /** 进行中任务的平均进度；没有进行中的为 null */
  progress: number | null;
  /** 失败数（含规划因错误暂停） */
  failed: number;
};

/**
 * 顶栏任务胶囊：进行中的用户任务和自动规划合起来算；没有进行中、没有失败、规划也没暂停时返回 null（胶囊收起）。
 * @param jobs 任务卡
 * @param planning 自动规划那一行（planningRow 的结果）
 */
export function taskSummary(
  jobs: readonly DramaJob[],
  planning: PlanningRowView | null,
): TaskSummary | null {
  const running = userJobs(jobs).filter(isActiveJob);
  const planRunning = planning?.kind === "running" ? planning : null;
  const count = running.length + (planRunning ? 1 : 0);
  const failed =
    failedJobs(jobs).length + (planning?.kind === "paused" && planning.tone === "error" ? 1 : 0);
  const userPaused = planning?.kind === "paused" && planning.tone === "muted" ? planning : null;
  if (count === 0 && failed === 0 && !userPaused) return null;
  const progress =
    count === 0
      ? null
      : average([
          ...running.map((job) => job.progress),
          ...(planRunning ? [planRunning.progress] : []),
        ]);
  let label: string | null = null;
  if (count > 1) label = `${count} 个任务`;
  else if (running[0]) label = jobTitle(running[0]);
  else if (planRunning) label = planRunning.title;
  else if (userPaused && failed === 0) label = userPaused.title;
  return { label, progress, failed };
}

/** 每集正在跑的用户任务（排队或进行中），集号 → 任务；一集同时有几条时取先出现的（新的） */
export function runningByEpisode(jobs: readonly DramaJob[]): Map<number, DramaJob> {
  const map = new Map<number, DramaJob>();
  for (const job of userJobs(jobs).filter(isActiveJob)) {
    for (const no of job.episodes) if (!map.has(no)) map.set(no, job);
  }
  return map;
}

/** 规划行的数据来源：只用到的那几个字段，方便测试 */
type PlanningDrama = Pick<
  Drama,
  "phase" | "planCursor" | "rangeEnd" | "pauseReason" | "pauseCode" | "unitKind"
> & { episodes: readonly unknown[]; eta?: Drama["eta"] };

/** 规划行上的操作：继续 / 重试 / 改用内置重试 */
export type PlanningAction = "resume" | "retry" | "builtin";

/** JobBar 里「分集规划」那一行的展示内容 */
export type PlanningRowView =
  | {
      /** 研读 / 规划进行中 */
      kind: "running";
      /** 主文案，如「正在规划第 301–312 章」 */
      title: string;
      /** 灰字：当前在做什么、已出多少集目录 */
      detail: string;
      /** 0–100 */
      progress: number;
    }
  | {
      /** 暂停或失败 */
      kind: "paused";
      /** muted 用户主动暂停；error 积分 / 失败等需要处理 */
      tone: "muted" | "error";
      /** 主文案 */
      title: string;
      /** 原因 */
      reason: string;
      /** 可用操作，按显示顺序 */
      actions: PlanningAction[];
    };

/** 任务已经跑了多少秒；还在排队（没有开始时间）算 0 */
const elapsedSeconds = (job: DramaJob, now: number) =>
  job.startedAt ? Math.max(0, (now - new Date(job.startedAt).getTime()) / 1000) : 0;

/** 自动规划里正在研读（粗读）的任务 */
const analyzeJob = (jobs: readonly DramaJob[]) =>
  jobs.find(
    (job) =>
      isPipelineJob(job) && isActiveJob(job) && (job.step === "analyze" || job.step === "outline"),
  );

/**
 * 自动规划还要多久（秒）：粗读 = 同模型粗读中位耗时 − 已跑时间；规划 = 当前批剩余 + 后面批次 × 每批中位耗时。
 * 中位耗时为 0（历史不足）的步骤不估；合计要求正在做和之后的步骤都能估。跑超了按 0 算，不出现负数
 * @param drama 规划阶段与预计耗时原料
 * @param jobs 任务卡
 * @param now 当前时间（毫秒）
 */
export function pipelineEta(
  drama: { phase: Drama["phase"]; eta?: Drama["eta"] },
  jobs: readonly DramaJob[],
  now: number,
): { analyze: number | null; plan: number | null; total: number | null } {
  const eta = drama.eta;
  if (drama.phase !== "running" || !eta) return { analyze: null, plan: null, total: null };
  const reading = analyzeJob(jobs);
  const analyze =
    reading && eta.analyzeSeconds > 0
      ? Math.max(0, Math.round(eta.analyzeSeconds - elapsedSeconds(reading, now)))
      : null;
  let plan: number | null = null;
  if (eta.planSeconds > 0) {
    const batch = jobs.find((job) => isPipelineJob(job) && isActiveJob(job) && job.step === "plan");
    const current =
      eta.planBatchesLeft > 0 && batch
        ? Math.max(0, eta.planSeconds - elapsedSeconds(batch, now))
        : 0;
    const rest = batch ? Math.max(0, eta.planBatchesLeft - 1) : eta.planBatchesLeft;
    plan = Math.round(current + rest * eta.planSeconds);
  }
  const total = plan === null || (reading && analyze === null) ? null : (analyze ?? 0) + plan;
  return { analyze, plan, total };
}

/**
 * 还需多久的文案：跑超了写「即将完成」，不到一分钟写「还需不到 1 分钟」
 * @param seconds 剩余秒数
 */
export function etaLabel(seconds: number): string {
  if (seconds <= 0) return "即将完成";
  if (seconds < 60) return "还需不到 1 分钟";
  return `还需约 ${durationLabel(seconds / 60)}`;
}

const batchRange = (from: number, to: number, word: string) =>
  from === to ? `第 ${from} ${word}` : `第 ${from}–${to} ${word}`;

/**
 * 自动规划那一行（JobBar 顶部）：done 没有；running 显示研读 / 正在规划第 a–b 章和进度；
 * paused 按暂停原因给文案和操作（用户暂停 / 积分不足 → 继续，失败 / 上下文不足 → 重试，
 * 自定义提示词导致失败 → 重试 + 改用内置重试）。
 * @param drama 短剧的规划相关字段
 * @param jobs 任务卡
 * @param now 当前时间（毫秒），用来推算粗读进度
 */
export function planningRow(
  drama: PlanningDrama,
  jobs: readonly DramaJob[],
  now = Date.now(),
): PlanningRowView | null {
  if (drama.phase === "done") return null;
  const word = unitWord(drama.unitKind);
  if (drama.phase === "running") {
    const active = jobs.filter((job) => isPipelineJob(job) && isActiveJob(job));
    const analyze = active.find((job) => job.step === "analyze" || job.step === "outline");
    const plan = active.find((job) => job.step === "plan");
    if (analyze && !plan) {
      // 粗读只有一次模型调用，中途没有进度：有历史耗时就按已用时间走，最多到 90%
      const median = drama.eta?.analyzeSeconds ?? 0;
      const guess =
        median > 0 ? Math.min(90, Math.round((elapsedSeconds(analyze, now) / median) * 100)) : 0;
      return {
        kind: "running",
        title: "正在粗读全书",
        detail: "研读 · 抽样读开篇与后文，整理人物与梗概",
        progress: Math.max(analyze.progress, guess),
      };
    }
    const progress =
      drama.rangeEnd > 0 ? Math.min(99, Math.round((drama.planCursor / drama.rangeEnd) * 100)) : 0;
    const title =
      plan && plan.batchFrom && plan.batchTo
        ? `正在规划${batchRange(plan.batchFrom, plan.batchTo, word)}`
        : "正在规划";
    return {
      kind: "running",
      title,
      detail: `分集规划 · 已出 ${drama.episodes.length.toLocaleString("en-US")} 集目录`,
      progress,
    };
  }
  const code = drama.pauseCode || "user";
  const reasonOr = (fallback: string) => drama.pauseReason || fallback;
  switch (code) {
    case "credits":
      return {
        kind: "paused",
        tone: "error",
        title: "分集规划暂停",
        reason: "积分不足，充值后继续",
        actions: ["resume"],
      };
    case "failed":
      return {
        kind: "paused",
        tone: "error",
        title: "分集规划暂停",
        reason: `${reasonOr("规划失败")} · 失败不扣积分`,
        actions: ["retry"],
      };
    case "context":
      return {
        kind: "paused",
        tone: "error",
        title: "分集规划暂停",
        reason: `${reasonOr("模型上下文不足")} · 失败不扣积分`,
        actions: ["retry"],
      };
    case "custom_prompt":
      return {
        kind: "paused",
        tone: "error",
        title: "分集规划暂停",
        reason: `${reasonOr("自定义提示词导致输出不合格")} · 失败不扣积分`,
        actions: ["retry", "builtin"],
      };
    default:
      return {
        kind: "paused",
        tone: "muted",
        title: "分集规划已暂停",
        reason: `已规划到第 ${drama.planCursor} ${word}，已规划的集照常可以写剧本`,
        actions: ["resume"],
      };
  }
}
