import { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Pause, Play, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

import { cancelJob, pausePlanning, resumePlanning, retryBuiltin, submitJob } from "@/api/drama";
import { dramaErrorMessage, jobFailureMessage } from "@/api/drama/errors";
import type { DramaJob, DramaStep } from "@/api/drama/type";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskIdTag } from "@/components/task-id-tag";
import { SPRING } from "@/lib/motion";
import { useNow } from "@/hooks/use-now";
import { useDramaJobsStore } from "@/store/drama";
import { cn } from "@/lib/utils";
import {
  episodesLabel,
  etaLabel,
  failedJobs,
  isActiveJob,
  jobStage,
  jobTitle,
  pipelineEta,
  planningRow,
  retryEpisodes,
  stepName,
  taskGroups,
  taskSummary,
  userJobs,
  type PlanningAction,
  type TaskGroup,
} from "@/utils/drama/jobs";
import type { WorkspaceStage } from "@/utils/drama/stages";

import { useWorkspace } from "./context";

/** 取消一条进行中的任务；busy 期间按钮该禁用 */
export function useCancelJob(job: DramaJob | undefined) {
  const { drama } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      useDramaJobsStore.getState().applyJob(drama.id, await cancelJob(drama.id, job.id));
    } catch (e) {
      toast.error(dramaErrorMessage(e, "取消失败"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, cancel };
}

/** 任务进度条（细条，弹簧推进）：任务面板和页面里就地显示进度的地方共用 */
export function JobProgressBar({ progress, className }: { progress: number; className?: string }) {
  return (
    <div className={cn("bg-muted h-1 overflow-hidden rounded-full", className)}>
      <motion.i
        className="bg-status-running block h-full origin-left rounded-full"
        initial={false}
        animate={{ scaleX: Math.max(0.03, progress / 100) }}
        transition={SPRING}
      />
    </div>
  );
}

/**
 * 圆环进度：任务胶囊、面板组头、分集栏共用。排队中（queued）画成灰色的一小段。
 * @param progress 0–100
 * @param size 直径（px）
 */
export function ProgressRing({
  progress,
  size = 16,
  queued = false,
  className,
}: {
  progress: number;
  size?: number;
  queued?: boolean;
  className?: string;
}) {
  const stroke = size <= 12 ? 2 : 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-muted"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        className={queued ? "stroke-muted-foreground/50" : "stroke-status-running"}
        initial={false}
        animate={{
          strokeDashoffset: queued ? c * 0.75 : c * (1 - Math.max(0.04, progress / 100)),
        }}
        transition={SPRING}
      />
    </svg>
  );
}

/** 面板里的一行：左边图标列，中间标题，右边百分比 / 操作 */
const ROW =
  "grid grid-cols-[16px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl px-2.5 py-2 text-[13px]";
/** 组内每集一行：集号、进度条、百分比、取消 */
const CHILD =
  "hover:bg-chrome-hover grid grid-cols-[16px_64px_minmax(0,1fr)_34px_22px] items-center gap-2 rounded-lg px-2.5 py-1 text-xs";
/** 失败、暂停行左边的小圆点 */
const DOT = "bg-destructive mx-auto size-1.5 rounded-full";

/** 取消某一条任务的小叉 */
function CancelButton({ job, label }: { job: DramaJob; label: string }) {
  const { busy, cancel } = useCancelJob(job);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`取消${label}`}
      title="取消"
      disabled={busy}
      onClick={() => void cancel()}
    >
      <X />
    </Button>
  );
}

/**
 * 面板里一组同步骤的进行中任务：只有一条时直接一行（标题、百分比、取消，下面一条进度条）；
 * 多条时组头写「N 集 · 第 a–b 集」和平均进度，可展开看每集，点集号跳过去。
 */
function TaskGroupRows({
  group,
  onEpisode,
}: {
  group: TaskGroup;
  onEpisode: (step: DramaStep, no: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const name = stepName(group.step);
  if (group.jobs.length === 1) {
    const job = group.jobs[0];
    const queued = job.status === "queued";
    const where = job.episodes.length > 0 ? episodesLabel(job.episodes) : "";
    return (
      <div role="status" data-slot="task-group" className="grid">
        <div className={ROW}>
          <ProgressRing progress={job.progress} queued={queued} />
          <span className="min-w-0 truncate">
            <b className="font-medium">{name}</b>
            {where && <span className="text-muted-foreground ml-1.5 text-xs">{where}</span>}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {queued ? "排队中" : `${job.progress}%`}
          </span>
          <CancelButton job={job} label={jobTitle(job)} />
        </div>
        {!queued && <JobProgressBar progress={job.progress} className="mr-10 mb-1.5 ml-9" />}
      </div>
    );
  }
  return (
    <div role="status" data-slot="task-group" className="grid">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          ROW,
          "hover:bg-chrome-hover focus-visible:ring-ring/50 text-left outline-none focus-visible:ring-2",
        )}
      >
        <ProgressRing progress={group.progress} />
        <span className="min-w-0 truncate">
          <b className="font-medium">{name}</b>
          <span className="text-muted-foreground ml-1.5 text-xs">
            {group.jobs.length} 集 · {episodesLabel(group.episodes)}
          </span>
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">{group.progress}%</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        group.jobs.map((job) => {
          const queued = job.status === "queued";
          const where = job.episodes.length > 0 ? episodesLabel(job.episodes) : name;
          return (
            <div key={job.id} className={CHILD}>
              <span />
              <button
                type="button"
                className="focus-visible:ring-ring/50 truncate rounded text-left outline-none hover:underline focus-visible:ring-2"
                onClick={() => job.episodes[0] && onEpisode(job.step, job.episodes[0])}
              >
                {where}
              </button>
              {queued ? (
                <span className="text-muted-foreground">排队中</span>
              ) : (
                <JobProgressBar progress={job.progress} />
              )}
              <span className="text-muted-foreground text-right tabular-nums">
                {queued ? "" : `${job.progress}%`}
              </span>
              <CancelButton job={job} label={where} />
            </div>
          );
        })}
    </div>
  );
}

/** 一条失败的任务：原因、重试、任务 ID、关闭 */
function FailedRow({ job }: { job: DramaJob }) {
  const { drama, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    const episodes = retryEpisodes(job, drama.episodes);
    // 拆解失败前已把所选集全部写入：没有剩下要拆的，关掉这条即可
    if (job.step === "breakdown" && episodes.length === 0) {
      useDramaJobsStore.getState().dismiss(drama.id, job.id);
      void refresh();
      return;
    }
    setBusy(true);
    try {
      const next = await submitJob(drama.id, { step: job.step, episodes });
      useDramaJobsStore.getState().dismiss(drama.id, job.id);
      useDramaJobsStore.getState().applyJob(drama.id, next);
      void refresh();
    } catch (e) {
      toast.error(dramaErrorMessage(e, "重试失败，请稍后再试"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" data-slot="task-failed" className="bg-destructive/10 grid rounded-xl">
      <div className={ROW}>
        <span className={DOT} />
        <b className="text-destructive min-w-0 truncate font-medium">{jobTitle(job)}失败</b>
        <span />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="关闭"
          onClick={() => useDramaJobsStore.getState().dismiss(drama.id, job.id)}
        >
          <X />
        </Button>
      </div>
      <div className="text-destructive flex flex-wrap items-center gap-2 pr-2.5 pb-2 pl-9 text-xs">
        <span className="min-w-0 flex-1">{jobFailureMessage(job)} · 失败不扣积分</span>
        <Button variant="outline" size="xs" disabled={busy} onClick={() => void retry()}>
          <RotateCw />
          重试
        </Button>
        {/* 用户把任务 ID 发给运维，运维按它在服务器日志里查到这次运行（run_id 与它相同） */}
        <TaskIdTag id={job.id} className="basis-full" />
      </div>
    </div>
  );
}

/** 自动规划中刷新「还需多久」和粗读推算进度的节拍（毫秒） */
const PLANNING_TICK = 2000;

/**
 * 自动规划（pipeline 线）那一组：研读 / 正在规划第 a–b 章 · 已出 N 集目录 · 还需多久 · 暂停；
 * 暂停或失败时写原因，给「继续 / 重试」，自定义提示词导致失败时多一个「改用内置重试」。
 */
function PlanningRows() {
  const { drama, jobs, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const now = useNow(drama.phase === "running", PLANNING_TICK);
  const row = planningRow(drama, jobs, now);
  if (!row) return null;

  const run = async (task: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await task();
      await refresh();
    } catch (e) {
      toast.error(dramaErrorMessage(e, failure));
    } finally {
      setBusy(false);
    }
  };
  const act = (action: PlanningAction) => {
    if (action === "builtin") return run(() => retryBuiltin(drama.id, "plan"), "重试失败");
    return run(() => resumePlanning(drama.id), "继续失败");
  };
  const eta = row.kind === "running" ? pipelineEta(drama, jobs, now).total : null;
  const error = row.kind === "paused" && row.tone === "error";

  return (
    <div
      role={row.kind === "running" ? "status" : "alert"}
      data-slot="planning-row"
      className={cn("grid rounded-xl", error && "bg-destructive/10")}
    >
      <div className={ROW}>
        {row.kind === "running" ? (
          <ProgressRing progress={row.progress} />
        ) : error ? (
          <span className={DOT} />
        ) : (
          <Pause aria-hidden className="text-muted-foreground size-3.5" />
        )}
        <b className={cn("min-w-0 truncate font-medium", error && "text-destructive")}>
          {row.title}
        </b>
        <span className="text-muted-foreground text-xs tabular-nums">
          {row.kind === "running" ? `${row.progress}%` : ""}
        </span>
        <span />
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 pr-2.5 pb-2 pl-9 text-xs",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <span className="min-w-0 flex-1">
          {row.kind === "running" ? (
            <>
              {row.detail}
              {eta !== null && ` · ${etaLabel(eta)}`}
            </>
          ) : (
            row.reason
          )}
        </span>
        {row.kind === "running" ? (
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => void run(() => pausePlanning(drama.id), "暂停失败")}
          >
            暂停
          </Button>
        ) : (
          row.actions.map((action) => (
            <Button
              key={action}
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void act(action)}
            >
              {action === "resume" ? <Play /> : action === "retry" ? <RotateCw /> : null}
              {action === "resume" ? "继续" : action === "retry" ? "重试" : "改用内置重试"}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}

/** 任务面板的内容：规划、各步骤的进行中任务、失败的任务 */
export function TaskPanel({ onEpisode }: { onEpisode: (step: DramaStep, no: number) => void }) {
  const { drama, jobs } = useWorkspace();
  const groups = taskGroups(jobs);
  const failed = failedJobs(jobs);
  const active = userJobs(jobs).filter(isActiveJob);
  const planning = planningRow(drama, jobs) ? 1 : 0;
  const [cancelling, setCancelling] = useState(false);

  const cancelAll = async () => {
    setCancelling(true);
    const results = await Promise.allSettled(active.map((job) => cancelJob(drama.id, job.id)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        useDramaJobsStore.getState().applyJob(drama.id, result.value);
      }
    }
    if (results.some((result) => result.status === "rejected")) {
      toast.error("有任务没能取消，请稍后再试");
    }
    setCancelling(false);
  };

  return (
    <div aria-label="任务" data-slot="task-panel" className="grid gap-0.5">
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[13px]">
        <b className="font-semibold">任务</b>
        <span className="text-muted-foreground text-xs tabular-nums">
          {active.length + planning + failed.length}
        </span>
        {active.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground ml-auto"
            disabled={cancelling}
            onClick={() => void cancelAll()}
          >
            全部取消
          </Button>
        )}
      </div>
      <PlanningRows />
      {groups.map((group) => (
        <TaskGroupRows key={group.step} group={group} onEpisode={onEpisode} />
      ))}
      {failed.map((job) => (
        <FailedRow key={job.id} job={job} />
      ))}
    </div>
  );
}

/**
 * 顶栏的任务胶囊（放在保存状态旁边）：研读、规划、写剧本、拆解、分镜、合成这些短剧任务都收在这里，
 * 不管在哪一页都看得到。一个任务写名称和进度，多个写「N 个任务」和平均进度，有失败加红点；全部结束后收起。
 * 点开是任务面板：同一步骤合成一组（批量分镜一集一个任务），可展开看每集、点集号跳过去、单独取消；
 * 自动规划的暂停 / 继续、失败的原因 / 重试 / 任务 ID 也在面板里。
 * 单张资产图、片段视频的生成在各自卡片上显示，不进这里。
 */
export function TaskPill({ onGo }: { onGo: (stage: WorkspaceStage, ep?: number) => void }) {
  const { drama, jobs } = useWorkspace();
  const [open, setOpen] = useState(false);
  const now = useNow(drama.phase === "running", PLANNING_TICK);
  const summary = taskSummary(jobs, planningRow(drama, jobs, now));
  if (!summary) return null;

  const onEpisode = (step: DramaStep, no: number) => {
    setOpen(false);
    onGo(jobStage(step), no);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="task-pill"
            className="bg-chrome ring-chrome-border hover:bg-chrome-hover data-popup-open:bg-chrome-hover focus-visible:ring-ring/50 ml-2 inline-flex h-8 max-w-72 min-w-0 shrink-0 items-center gap-2 rounded-full pr-3 pl-2 text-[13px] whitespace-nowrap ring-1 backdrop-blur-xl backdrop-saturate-150 transition-colors outline-none focus-visible:ring-2"
          />
        }
      >
        {summary.progress !== null ? (
          <ProgressRing progress={summary.progress} />
        ) : summary.label ? (
          <Pause aria-hidden className="text-muted-foreground size-3.5" />
        ) : null}
        {summary.label && <span className="min-w-0 truncate">{summary.label}</span>}
        {summary.progress !== null && (
          <span className="text-muted-foreground tabular-nums">{summary.progress}%</span>
        )}
        {summary.failed > 0 && (
          <span className="text-destructive inline-flex items-center gap-1.5">
            {summary.label && <span className="text-muted-foreground">·</span>}
            <span className="bg-destructive size-1.5 rounded-full" />
            {summary.failed} 个失败
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="bg-chrome ring-chrome-border max-h-[min(440px,70vh)] w-96 max-w-[calc(100vw-24px)] gap-0 overflow-y-auto rounded-2xl p-1.5 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        <TaskPanel onEpisode={onEpisode} />
      </PopoverContent>
    </Popover>
  );
}
