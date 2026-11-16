import { useStore } from "@xyflow/react";

import { useRemoteModels } from "@/hooks/use-models";
import type { CanvasNodeData, StoryboardShot } from "@/types";
import { actualDurationHint } from "@/utils/storyboard/video";

/** 视频节点的时长和模型：只订阅这两项，节点别的变化不重渲染这一行 */
function useVideoNodeDuration(nodeId: string | undefined) {
  const model = useStore((state) => {
    const d = nodeId
      ? (state.nodeLookup.get(nodeId)?.internals.userNode.data as CanvasNodeData | undefined)
      : undefined;
    return d?.kind === "video" ? (d.model ?? "") : undefined;
  });
  const seconds = useStore((state) => {
    const d = nodeId
      ? (state.nodeLookup.get(nodeId)?.internals.userNode.data as CanvasNodeData | undefined)
      : undefined;
    const raw = d?.kind === "video" ? d.params?.duration : undefined;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : undefined;
  });
  return { model, seconds };
}

/**
 * 时长格下面的黄色「实际 Ns」（设计 §6.7）：只有已建视频节点、而且节点当前时长和这一行的时长不一样才出现；
 * 视频模型只支持部分时长时视频节点取了最接近值，行里改时长也不回写已建好的节点，所以按「节点当前时长」和「行时长」对比。
 * 悬停说明模型支持哪些时长。
 */
export function DurationHint({ shot }: { shot: StoryboardShot }) {
  const { model, seconds } = useVideoNodeDuration(shot.videoNodeId);
  const { models } = useRemoteModels("video", model !== undefined);
  const field = (models.find((m) => m.key === model) ?? models[0])?.capabilities?.params?.duration;
  const hint = actualDurationHint(shot.duration, seconds, field);
  if (!hint) return null;
  return (
    <span title={hint.title} className="text-status-warning px-2 text-right text-xs tabular-nums">
      实际 {hint.actual}s
    </span>
  );
}
