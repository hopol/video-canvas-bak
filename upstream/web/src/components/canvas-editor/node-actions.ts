import { useEffect, useRef } from "react";

/**
 * 节点对外暴露的动作。生成任务的提交逻辑（模型、参数、上游连线……）活在节点组件的 hook 里，
 * 编辑器之外的页面（如短剧资产列表的「批量生成」）拿不到，所以节点挂载时把「提交」登记到这里，卸载时撤销。
 */
export type NodeActions = {
  /** 此刻不能提交的原因；可以提交返回 null */
  blockedReason: () => string | null;
  /**
   * 提交生成：成功返回 null，失败返回原因（同时节点自己也会就地提示）。
   * 不能靠事后读节点数据判断成败：画布节点是受控状态，提交刚结束时 status 还没同步过来。
   */
  submit: () => Promise<string | null>;
  /** 换成另一个模型（参数按新模型的能力迁移，新模型不支持的直接丢掉，不弹确认）；批量生成前统一换模型用 */
  setModel?: (key: string) => void;
  /** 音色（只有角色卡有） */
  voice?: {
    /** 此刻不能生成音色的原因（没写音色描述、音色正在生成……）；可以返回 null */
    blockedReason: () => string | null;
    /** 生成形象，出图后用新主图接着生成音色：语义同 submit，成功返回 null，否则返回原因 */
    submitAfterImage: () => Promise<string | null>;
  };
};

const registry = new Map<string, NodeActions>();
/** 每个节点登记时给的原始读取函数（registry 里是包过一层的） */
const readers = new Map<string, () => NodeActions | null>();

/** 节点此刻还提供不了动作（没登记，或读到的动作为空）时给的原因 */
const NOT_READY = "节点还没准备好";
/** 节点没有音色动作（不是角色卡） */
const NO_VOICE = "这个节点不能生成音色";

/**
 * 登记一个节点的动作。每次触发都现读 read()，所以节点重新渲染后拿到的永远是最新状态。
 * @param id 节点 ID
 * @param read 读取该节点当前的动作；返回 null 表示此刻不提供
 * @returns 撤销登记
 */
export function registerNodeActions(id: string, read: () => NodeActions | null): () => void {
  readers.set(id, read);
  registry.set(id, {
    // blockedReason 返回 null 表示「可以提交」，不能和「读不到动作」混为一谈，所以这里不能用 ??
    blockedReason: () => {
      const actions = read();
      return actions ? actions.blockedReason() : NOT_READY;
    },
    submit: () => read()?.submit() ?? Promise.resolve(NOT_READY),
    // 音色动作同样现读；节点此刻读不到动作时按没准备好处理
    voice: {
      blockedReason: () => {
        const actions = read();
        if (!actions) return NOT_READY;
        return actions.voice ? actions.voice.blockedReason() : NO_VOICE;
      },
      submitAfterImage: () => read()?.voice?.submitAfterImage() ?? Promise.resolve(NO_VOICE),
    },
  });
  return () => {
    registry.delete(id);
    readers.delete(id);
  };
}

/**
 * 在节点组件里登记动作（读的永远是最新一次渲染的闭包）。
 * @param id 节点 ID
 * @param actions 动作；传 null 表示这个节点此刻不提供（如还没读到角色卡）
 */
export function useRegisterNodeActions(id: string, actions: NodeActions | null) {
  const latest = useRef(actions);
  // 每次渲染后把最新的闭包放进去；登记的动作读它，永远拿到最新状态
  useEffect(() => {
    latest.current = actions;
  });
  const available = actions !== null;
  useEffect(() => {
    if (!available) return;
    return registerNodeActions(id, () => latest.current);
  }, [id, available]);
}

/**
 * 把一个节点换成另一个模型。
 * @returns 节点接手了返回 true；没登记、或不提供换模型时返回 false
 */
export function setModelById(id: string, key: string): boolean {
  // registry 里包过一层，要现读节点自己的动作才知道它支不支持换模型
  const own = readers.get(id)?.();
  if (!own?.setModel) return false;
  own.setModel(key);
  return true;
}

/** 节点是否登记了生成动作 */
export const hasNodeActions = (id: string): boolean => registry.has(id);

/**
 * 触发一个节点的生成：不能提交、或提交失败（积分不足等）时返回原因，提交成功返回 null。
 */
export async function submitNodeById(id: string): Promise<string | null> {
  const actions = registry.get(id);
  if (!actions) return NOT_READY;
  const blocked = actions.blockedReason();
  if (blocked) return blocked;
  return actions.submit();
}

/** 这些原因说明节点只是还没准备好（刚建好没挂载、模型清单还在加载），等一等就能提交；其余是真正的拒绝 */
const TRANSIENT_REASONS = new Set([NOT_READY, "正在加载模型清单"]);

/**
 * 刚建出来的节点要立刻开始生成：节点要等挂载才会登记动作、模型清单可能还在加载，
 * 这里每隔一会儿重试，直到能提交；真正的拒绝（积分不足、暂无可用模型……）不等，原因直接交回。
 * 等不到就返回「节点还没准备好」，调用方让用户到节点上手动点生成。
 * @returns 提交成功为 null，否则是原因
 */
export async function submitNodeWhenReady(
  id: string,
  { timeoutMs = 5000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reason = await submitNodeById(id);
    if (reason === null || !TRANSIENT_REASONS.has(reason)) return reason;
    if (Date.now() >= deadline) return reason;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 「生成（含音色）」：生成形象，出图后用新主图接着生成音色。
 * 音色此刻不能生成（不是角色卡、没写音色描述……）时照常生成形象，音色那一项给原因。
 * @returns 形象、音色各自没能提交的原因；null 表示已提交（音色是已排上，出图后才真正提交）
 */
export async function submitWithVoiceById(
  id: string,
): Promise<{ image: string | null; voice: string | null }> {
  const actions = registry.get(id);
  if (!actions) return { image: NOT_READY, voice: NOT_READY };
  const blocked = actions.blockedReason();
  if (blocked) return { image: blocked, voice: blocked };
  const voiceBlocked = actions.voice ? actions.voice.blockedReason() : NO_VOICE;
  if (voiceBlocked || !actions.voice) return { image: await actions.submit(), voice: voiceBlocked };
  const failed = await actions.voice.submitAfterImage();
  return { image: failed, voice: failed };
}
