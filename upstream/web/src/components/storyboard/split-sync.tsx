import { useStoryboardSplitSync } from "@/hooks/use-storyboard-split";

/**
 * 画布里的拆分镜任务接收端：不渲染内容，只在这张画布打开期间登记接收 WebSocket 推送，
 * 并在画布加载、节点增减时按节点补查任务状态。必须放在 ReactFlowProvider 和 CanvasIdContext 里面。
 */
export function StoryboardSplitSync() {
  useStoryboardSplitSync();
  return null;
}
