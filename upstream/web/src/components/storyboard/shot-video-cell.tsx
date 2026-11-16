import { Crosshair, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLinkedNodeView } from "@/hooks/use-linked-node-view";
import { cn } from "@/lib/utils";
import type { StoryboardShot } from "@/types";
import { shotVideoState } from "@/utils/storyboard/shot-video";

/** 状态点加文字：颜色沿用节点标题行状态的 token（设计 §6.6） */
function StatusDot({ className }: { className: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

/**
 * 视频格（设计 §6.6）：宽 120px，只放状态和一个动作，不放预览。状态实时读关联的视频节点：
 * 没建 → 「生成视频」；建好还没生成 → 「未生成 · 去生成」（视频贵，不自动开始，到节点上确认模型和参数再点）；
 * 生成中带进度；已完成点文字去视频节点上看（弹窗里再叠一层灯箱会抢焦点，视频节点自己就有播放控件）；
 * 失败给原因和「去处理」。
 * 视频图标和添加节点菜单里的一致，本表所有地方都不用 ✦。
 * @param onGenerate 建视频节点
 * @param onLocate 关掉弹窗，把画布飞到视频节点
 */
export function ShotVideoCell({
  shot,
  onGenerate,
  onLocate,
}: {
  shot: StoryboardShot;
  onGenerate: () => void;
  onLocate: (nodeId: string) => void;
}) {
  const state = shotVideoState(shot.videoNodeId, useLinkedNodeView(shot.videoNodeId));
  const nodeId = shot.videoNodeId;
  const locate = nodeId ? () => onLocate(nodeId) : undefined;

  return (
    <div className="group/video flex h-9 min-w-0 items-center gap-1.5 px-1 text-xs">
      {state.kind === "none" && (
        <Button
          variant="ghost"
          size="sm"
          className="nodrag text-muted-foreground"
          onClick={onGenerate}
        >
          <Video />
          生成视频
        </Button>
      )}
      {state.kind === "idle" && (
        <>
          <StatusDot className="bg-muted-foreground" />
          <span className="text-muted-foreground">未生成 ·</span>
          <button
            type="button"
            onClick={locate}
            className="nodrag text-foreground cursor-pointer underline-offset-2 hover:underline"
          >
            去生成
          </button>
        </>
      )}
      {state.kind === "running" && (
        <>
          <StatusDot className="bg-status-running animate-pulse" />
          <span className="text-status-running tabular-nums">
            生成中{state.progress !== null ? ` ${state.progress}%` : ""}
          </span>
        </>
      )}
      {state.kind === "done" && (
        <>
          <StatusDot className="bg-status-success" />
          <button
            type="button"
            onClick={locate}
            className="nodrag text-status-success cursor-pointer underline-offset-2 hover:underline"
          >
            已完成
          </button>
        </>
      )}
      {state.kind === "failed" && (
        <span title={state.message} className="flex items-center gap-1.5">
          <StatusDot className="bg-destructive" />
          <span className="text-destructive">失败 ·</span>
          <button
            type="button"
            onClick={locate}
            className="nodrag text-foreground cursor-pointer underline-offset-2 hover:underline"
          >
            去处理
          </button>
        </span>
      )}
      {locate && (state.kind === "running" || state.kind === "done") && (
        <button
          type="button"
          title="在画布中定位"
          aria-label="在画布中定位"
          onClick={locate}
          className="nodrag text-muted-foreground hover:text-foreground ml-auto opacity-0 group-focus-within/video:opacity-100 group-hover/video:opacity-100"
        >
          <Crosshair className="size-3.5" />
        </button>
      )}
    </div>
  );
}
