import type { LinkedNode } from "./shot-image";

/** 视频格该显示什么（设计 §6.6）：状态点加文字，加一个动作 */
export type ShotVideoState =
  | { kind: "none" }
  | { kind: "idle" }
  | { kind: "running"; progress: number | null }
  | { kind: "done"; src: string }
  | { kind: "failed"; message: string };

/**
 * 一行的视频格状态：实时读关联的视频节点，不在行上另存一份。
 * 节点已被删或根本没建是 none；节点建好但还没生成（视频不自动开始，用户要到节点上确认模型和参数）是 idle。
 * @param videoNodeId 行上记的视频节点 id
 * @param linked 这个节点的情况
 */
export function shotVideoState(
  videoNodeId: string | undefined,
  linked: LinkedNode | undefined,
): ShotVideoState {
  if (!videoNodeId || !linked?.exists) return { kind: "none" };
  const v = linked.view;
  switch (v.phase) {
    case "queued":
    case "finalizing":
      return { kind: "running", progress: null };
    case "running":
      return { kind: "running", progress: v.progress };
    case "done":
      return { kind: "done", src: v.src };
    case "failed":
      return { kind: "failed", message: v.message };
    // 本地传视频进来的节点没有生成任务，当作还没生成
    default:
      return { kind: "idle" };
  }
}
