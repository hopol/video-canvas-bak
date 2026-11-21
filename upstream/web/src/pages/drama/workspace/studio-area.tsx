import { Clapperboard, Lock, ScrollText, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDramaVideoModel } from "@/hooks/use-drama-video-model";
import { episodeCardView } from "@/utils/drama/episode-cards";
import type { DramaJob } from "@/api/drama/type";
import { activeStoryboardJob, isActiveJob, jobConflictReason } from "@/utils/drama/jobs";
import type { WorkspaceStage } from "@/utils/drama/stages";

import { StudioView } from "../studio/view";
import { useWorkspace } from "./context";
import { JobProgressBar, useCancelJob } from "./job-bar";
import { StoryboardBatchButton } from "./storyboard-batch-dialog";
import { StoryboardButton, useStoryboardStart } from "./storyboard-start";

/** 前置工序没做完时的引导：一个图标、一句话、一个按钮 */
function Gate({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  /** 标题下的说明；不给就不显示 */
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="bg-muted text-muted-foreground grid size-16 place-items-center rounded-[20px] [&_svg]:size-7">
        {icon}
      </span>
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {text && <p className="text-muted-foreground max-w-[44ch] text-[13px]">{text}</p>}
      {children}
    </div>
  );
}

/**
 * 分镜生成中的就地进度：进度条、百分比（排队时写「排队中」）和取消，和任务面板里的单条任务同一个样子。
 * 任务列表还没拉到（刚刷新）时只占位，不显示假进度。
 */
function InlineProgress({ job }: { job: DramaJob | undefined }) {
  const { busy, cancel } = useCancelJob(job);
  if (!job) return null;
  return (
    <div role="status" className="mt-2 grid w-64 gap-2">
      <JobProgressBar progress={job.progress} />
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className="tabular-nums">
          {job.status === "queued" ? "排队中" : `${job.progress}%`}
        </span>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void cancel()}>
          取消
        </Button>
      </div>
    </div>
  );
}

/**
 * 片场：当前集的片段制作。
 * 还没拆解资产 → 引导去拆解（直接打开拆解弹窗，剧本没写好才去剧本页）；还没有分镜脚本 → 引导生成（带积分估价），也可选多集批量生成；分镜生成中 → 等待；
 * 分镜就绪 → 进入片场（资产库 / 播放器 / 检查器 / 时间线）。
 */
/**
 * 片场空状态（还没拆解 / 分镜生成中 / 还没有分镜）的外框：顶上一条和片场顶栏同高的工具条，
 * 右上角放「批量生成脚本」，和已有分镜时片场顶栏里的位置一致。
 */
function GateFrame({
  current,
  maxSeconds,
  children,
}: {
  current: number;
  maxSeconds: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex h-12 shrink-0 items-center justify-end gap-2 border-b px-4">
        <StoryboardBatchButton current={current} maxSeconds={maxSeconds} />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function StudioArea({
  ep,
  onGo,
  onBreakdownOpen,
}: {
  ep: number;
  onGo: (stage: WorkspaceStage, ep?: number) => void;
  /** 打开拆解弹窗（和总览、剧本、资产管理共用同一个） */
  onBreakdownOpen: () => void;
}) {
  const { drama, jobs, refresh } = useWorkspace();
  const video = useDramaVideoModel(drama.id, drama.videoModel);
  const starter = useStoryboardStart(video.maxSeconds);
  const episode = drama.episodes.find((item) => item.no === ep) ?? drama.episodes[0];

  if (!episode) {
    return (
      <Gate
        icon={<Clapperboard />}
        title="还没有分集"
        text="研读完成后分集会出现在左侧，也可以在剧本页手动新增一集。"
      />
    );
  }

  const { action } = episodeCardView(episode, {
    busyReason: jobConflictReason(jobs, "storyboard", [episode.no]),
  });

  if (action.kind === "enter") {
    // 换一集整块重来，不让上一集的选中片段、草稿残留
    return (
      <StudioView
        key={`${drama.id}:${episode.no}`}
        drama={drama}
        no={episode.no}
        refresh={refresh}
      />
    );
  }

  /** 空状态都套上带「批量生成脚本」的工具条 */
  const frame = (node: React.ReactNode) => (
    <GateFrame current={episode.no} maxSeconds={video.maxSeconds}>
      {node}
    </GateFrame>
  );

  if (action.kind === "breakdown") {
    // 这一集已经在拆解：片场仍锁着，不给「去拆解」（免得重复提交），也不在这里放进度（拆解是资产管理的事），
    // 只引导去资产管理看进度
    const breaking = jobs.some(
      (job) => job.step === "breakdown" && isActiveJob(job) && job.episodes.includes(episode.no),
    );
    if (breaking) {
      return frame(
        <Gate
          icon={<Lock />}
          title={`第 ${episode.no} 集的资产还在拆解`}
          text="拆解完成后才能生成分镜。"
        >
          <Button variant="outline" onClick={() => onGo("assets", episode.no)}>
            <Users />
            去资产管理
          </Button>
        </Gate>,
      );
    }
    const hasScript = episode.scriptStatus === "ready";
    return frame(
      <Gate
        icon={<Lock />}
        title={`先拆解第 ${episode.no} 集的资产`}
        text={`分镜需要知道这一集出场的角色、场景和道具。${hasScript ? "拆解后这一集的剧本会锁定。" : "这一集的剧本也还没写好。"}`}
      >
        <Button onClick={hasScript ? onBreakdownOpen : () => onGo("script", episode.no)}>
          <ScrollText />
          {hasScript ? "去拆解" : "去写剧本"}
        </Button>
      </Gate>,
    );
  }

  if (action.kind === "generating") {
    return frame(
      <Gate
        icon={<Clapperboard className="animate-pulse motion-reduce:animate-none" />}
        title={`正在生成第 ${episode.no} 集的分镜脚本…`}
      >
        <InlineProgress job={activeStoryboardJob(jobs, episode.no)} />
      </Gate>,
    );
  }

  return frame(
    <Gate icon={<Clapperboard />} title={`第 ${episode.no} 集还没有分镜`}>
      <StoryboardButton
        episode={episode}
        label={action.label}
        disabledReason={action.disabledReason}
        maxSeconds={video.maxSeconds}
        busy={starter.pending === episode.no}
        onStart={() => void starter.start(episode)}
      />
    </Gate>,
  );
}
