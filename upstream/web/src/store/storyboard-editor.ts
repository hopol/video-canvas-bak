import { create } from "zustand";

type StoryboardEditorState = {
  /** 正在编辑的分镜表节点 id；null 表示没打开 */
  nodeId: string | null;
  /** 打开时要聚焦画面描述的那一行（空状态点「添加镜头」进来时是新加的第 1 行） */
  focusShotId: string | null;
  /** 打开某个分镜表节点的编辑弹窗 */
  open: (nodeId: string, focusShotId?: string) => void;
  /** 关闭编辑弹窗 */
  close: () => void;
};

/**
 * 画布编辑器 → 分镜表节点的「打开编辑」请求。双击由编辑器统一处理，
 * 编辑弹窗挂在节点自己身上，节点订阅这里看是不是在叫自己，同一时刻只开一个。
 */
export const useStoryboardEditor = create<StoryboardEditorState>((set) => ({
  nodeId: null,
  focusShotId: null,
  open: (nodeId, focusShotId) => set({ nodeId, focusShotId: focusShotId ?? null }),
  close: () => set({ nodeId: null, focusShotId: null }),
}));
