import type { StoryboardSplitJob } from "@/api/storyboard/type";

/**
 * 拆分镜任务的结果入口。WebSocket 回调在 React 之外，写回节点要用画布里的 ReactFlow，
 * 所以由当前打开的画布登记一个「接收端」（同 setMarketingNavigator 的做法）：
 * - 推送到了：画布对得上就交给接收端，对不上（用户在别的页面）就丢掉，
 *   结果留在后端，下次打开这张画布时按本机记着的任务 id 补查；
 * - 重连、回到前台：让接收端按节点补查一遍。
 */
export interface SplitSink {
  canvasId: string;
  /** 把一份任务快照落到界面和节点上 */
  apply: (job: StoryboardSplitJob) => void;
  /** 按节点补查任务状态，查到的交给 apply */
  reconcile: () => Promise<void>;
}

let sink: SplitSink | null = null;

/** 登记 / 注销当前画布的接收端；卸载时传 null（只注销自己登记的那个） */
export function setSplitSink(next: SplitSink | null, owner?: SplitSink) {
  if (next === null && owner && sink !== owner) return;
  sink = next;
}

/** 已经处理完终态的任务 id：推送和补查可能各送来一次，同一个结果只写一次 */
const settled = new Set<string>();

/** 这个任务的终态是否已处理过 */
export const isSplitSettled = (jobId: string) => settled.has(jobId);

/** 标记任务的终态已处理 */
export const markSplitSettled = (jobId: string) => void settled.add(jobId);

/** 收到 `storyboard.split` 推送 */
export function handleStoryboardSplitEvent(job: StoryboardSplitJob) {
  if (sink && sink.canvasId === job.canvas_id) sink.apply(job);
}

/** 连接重建、页面回到前台时对账：没有打开的画布就什么都不做 */
export async function reconcileStoryboardSplit() {
  await sink?.reconcile();
}
