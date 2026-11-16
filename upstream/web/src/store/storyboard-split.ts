import { create } from "zustand";

/** 没有状态时的空闲值：订阅用的选择器每次必须返回同一个引用，否则 zustand 会认为状态一直在变而死循环 */
export const IDLE: SplitState = { phase: "idle" };

/** 拆分镜模型选择存在本机的键：不进画布数据，免得进撤销栈和导出文件 */
const MODEL_KEY = "storyboard-split-model";

/** 读本机记的模型；读不到都当没选过（空串 = 跟随后台第一个） */
export function readSplitModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSplitModel(model: string) {
  try {
    if (model) localStorage.setItem(MODEL_KEY, model);
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // 存不下（隐私模式、配额）就只在本次会话里生效
  }
}

/** 节点级运行时状态（设计 §6.3、§6.4）：拆分中、失败横幅、覆盖确认，都不进节点数据，刷新后不恢复 */
export type SplitState =
  /** 空闲，没有在跑也没有未处理的失败 */
  | { phase: "idle" }
  /** 正在调模型 */
  | { phase: "running"; mode: "replace" | "append" }
  /** 两次都不合格，或上游报错；重试或关掉横幅前一直显示 */
  | { phase: "failed"; reason: string; mode: "replace" | "append" };

/** 覆盖 / 追加 / 取消弹窗的意图：没弹窗时是 null */
export type OverwriteIntent = { nodeId: string; existingCount: number } | null;

type Store = {
  /** 按分镜表节点 id 存：同一节点只有一个状态 */
  states: Record<string, SplitState>;
  /** 要求打开覆盖确认的节点；null 表示没弹 */
  overwrite: OverwriteIntent;
  /** 节点刚拆进来的镜头 id：高亮停留后清空（设计 §6.4 新行高亮） */
  highlights: Record<string, Set<string>>;
  /** 选的 Agent 模型 key，三个入口共用；空串 = 跟随后台第一个 */
  model: string;
  /** 换模型并记在本机 */
  setModel: (model: string) => void;

  /** 读某个节点的状态，缺省是 idle */
  stateOf: (nodeId: string) => SplitState;
  /** 开始调模型 */
  start: (nodeId: string, mode: "replace" | "append") => void;
  /** 收到不合格 / 上游失败，交给横幅显示；横幅里点「关闭」后置回 idle */
  fail: (nodeId: string, reason: string) => void;
  /** 清掉这节点的失败横幅 */
  dismiss: (nodeId: string) => void;
  /** 成功：清状态，标记新镜头为「刚进来」 */
  done: (nodeId: string, newShotIds: string[]) => void;
  /** 清掉某节点的高亮（动画播完或节点卸载时调用） */
  clearHighlights: (nodeId: string) => void;
  /** 请求打开覆盖弹窗 */
  askOverwrite: (nodeId: string, existingCount: number) => void;
  /** 关掉覆盖弹窗 */
  closeOverwrite: () => void;
};

/** 所有分镜表节点的拆分状态，一个 store，按 id 分片存，不乱串 */
export const useStoryboardSplit = create<Store>((set, get) => ({
  states: {},
  overwrite: null,
  highlights: {},
  model: readSplitModel(),
  setModel: (model) => {
    writeSplitModel(model);
    set({ model });
  },

  stateOf: (nodeId) => get().states[nodeId] ?? IDLE,
  start: (nodeId, mode) =>
    set((s) => ({ states: { ...s.states, [nodeId]: { phase: "running", mode } } })),
  fail: (nodeId, reason) =>
    set((s) => {
      const prev = s.states[nodeId];
      const mode = prev?.phase === "running" ? prev.mode : "append";
      return { states: { ...s.states, [nodeId]: { phase: "failed", reason, mode } } };
    }),
  dismiss: (nodeId) =>
    set((s) => {
      const { [nodeId]: _removed, ...rest } = s.states;
      return { states: rest };
    }),
  done: (nodeId, newShotIds) =>
    set((s) => {
      const { [nodeId]: _removed, ...rest } = s.states;
      return {
        states: rest,
        highlights: { ...s.highlights, [nodeId]: new Set(newShotIds) },
      };
    }),
  clearHighlights: (nodeId) =>
    set((s) => {
      const { [nodeId]: _removed, ...rest } = s.highlights;
      return { highlights: rest };
    }),
  askOverwrite: (nodeId, existingCount) => set({ overwrite: { nodeId, existingCount } }),
  closeOverwrite: () => set({ overwrite: null }),
}));

/** 要不要显示拆分进度：进行中为 true */
export const isSplitRunning = (state: SplitState) => state.phase === "running";

/** 禁用拆分按钮的原因；能拆时返回空串 */
export function splitDisabledReason(
  hasScript: boolean,
  scriptEmpty: boolean,
  phase: SplitState["phase"],
): string {
  if (!hasScript) return "请先连接剧本节点";
  if (scriptEmpty) return "剧本节点还没有内容";
  if (phase === "running") return "正在拆分镜";
  return "";
}
