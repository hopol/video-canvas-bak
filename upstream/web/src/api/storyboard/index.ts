import service from "@/utils/requests/service";

import type { StoryboardSplitJob, StoryboardSplitRequest } from "./type";

/**
 * 提交「从剧本拆分镜」：后端建任务后立刻返回 pending 快照，模型在后台跑，结果走 WebSocket 推送。
 * 错误由调用方自己处理，不弹默认 toast
 */
export const splitStoryboard = (canvasId: string, body: StoryboardSplitRequest) =>
  service.post<StoryboardSplitJob>(`/canvas/${canvasId}/storyboard/split`, body, {
    silent: true,
  });

/** 按 id 读任务快照（刷新页面、断线重连后对账）；不存在时 404 / 30017 */
export const getStoryboardSplitJob = (canvasId: string, jobId: string) =>
  service.get<StoryboardSplitJob>(`/canvas/${canvasId}/storyboard/split/${jobId}`, undefined, {
    silent: true,
  });

/** 查这个节点进行中的任务，没有时返回 null（弹窗打开、页面刷新时恢复运行状态） */
export const getActiveStoryboardSplit = (canvasId: string, nodeId: string) =>
  service.get<StoryboardSplitJob | null>(
    `/canvas/${canvasId}/storyboard/split/active`,
    { node_id: nodeId },
    { silent: true },
  );
