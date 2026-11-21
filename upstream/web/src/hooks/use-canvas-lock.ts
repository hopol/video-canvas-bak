import { useCallback, useEffect, useRef, useState } from "react";

import {
  canvasLockName,
  watchCanvasLock,
  type CanvasLockHandle,
  type LockLike,
} from "@/utils/canvas/canvas-lock";
import {
  openTakeoverChannel,
  takeoverChannelName,
  type TakeoverChannel,
  type TakeoverMessage,
} from "@/utils/canvas/canvas-takeover";
import { getCurrentUserId } from "@/utils/storage/user-id";

/** 抢不到锁后多久才提示「已在另一个标签页打开」（毫秒）：给刚离开画布的标签页留出释放锁的时间 */
const WAITING_GRACE_MS = 600;

/** 请求接管后等对方「有没有反应」的时间（毫秒）：对方连回声都没有，就当页签被冻结了 */
const TAKEOVER_WAIT_MS = 1800;

/** 对方回了「正在存盘」之后最多再等多久（毫秒）：后台页签被节流，存盘可能要好一会儿 */
const YIELD_WAIT_MS = 15000;

/** checking：还没问出结果；held：可以编辑；waiting：别的标签页在编辑，本页只读 */
export type CanvasLockStatus = "checking" | "held" | "waiting";

/** 接管请求的进度：idle 可以点；asking 已经发出、在等对方存盘；no-response 对方没响应，再点就是强夺 */
export type TakeoverState = "idle" | "asking" | "no-response";

export type CanvasLock = {
  status: CanvasLockStatus;
  takeoverState: TakeoverState;
  /** 请求接管编辑权：先请对方存盘让位，对方没响应时再点一次就是强夺 */
  takeover: () => void;
};

/**
 * 同一张画布只允许一个标签页编辑。认不出当前用户时没有草稿，不需要锁，直接放行。
 * 状态按锁名记录：换画布时旧结果自动失效，回到 checking，不需要在 effect 里同步重置。
 *
 * 等待方不是被拦住，而是以只读预览挂载；点「接管」时才走两段式让位（见 canvas-takeover）。
 * onYield 是持有方被要求让位时先做的事：把改动存盘。存不上也让位，但内容还在本地草稿里。
 */
export function useCanvasLock(
  canvasId: string | undefined,
  options: { onYield?: () => Promise<unknown> | unknown } = {},
): CanvasLock {
  const userId = getCurrentUserId();
  const name = userId && canvasId ? canvasLockName(userId, canvasId) : null;
  const [result, setResult] = useState<{ name: string; state: "held" | "waiting" } | null>(null);
  const [takeoverState, setTakeoverState] = useState<TakeoverState>("idle");
  const handleRef = useRef<CanvasLockHandle | null>(null);
  const channelRef = useRef<TakeoverChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 每个标签页一个身份：自己发的广播不会再听一遍（BroadcastChannel 本来也不回声，这里是双保险） */
  const [from] = useState(() => Math.random().toString(36).slice(2));
  const onYieldRef = useRef(options.onYield);
  useEffect(() => {
    onYieldRef.current = options.onYield;
  }, [options.onYield]);

  useEffect(() => {
    if (!name) return;
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    const handle = watchCanvasLock({
      name,
      locks: locks as unknown as LockLike | undefined,
      waitingDelayMs: WAITING_GRACE_MS,
      onChange: (state) => {
        setResult({ name, state });
        // 拿到锁了：接管流程结束
        if (state === "held") {
          clearTimeout(timerRef.current);
          setTakeoverState("idle");
        }
      },
    });
    handleRef.current = handle;

    const channel = openTakeoverChannel({
      name: takeoverChannelName(name),
      onMessage: (message: TakeoverMessage) => {
        if (message.from === from) return;
        if (message.type === "release-request") {
          if (!handle.holds) return;
          // 先把改动存盘再让位；存不上也照让，内容还在本地草稿里，接管方拿到的是云端版本
          // 存盘可能要一会儿（后台页签被节流），先回一条 saving 告诉对方「我收到了，在存」
          channel?.post({ type: "saving", from });
          void (async () => {
            try {
              await onYieldRef.current?.();
            } finally {
              handle.release();
              channel?.post({ type: "released", from });
            }
          })();
          return;
        }
        if (message.type === "saving") {
          // 对方在存盘了：别按「没响应」算，给足时间；真卡死了还有这个兜底。
          // 已经拿到锁了就不理这条（迟到的旧广播），免得过一会儿莫名其妙变成「强制接管」
          if (handle.holds) return;
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setTakeoverState("no-response"), YIELD_WAIT_MS);
          return;
        }
        if (message.type === "released") {
          // 对方已经让位：锁马上会排到本页，先把这个计时器撤掉，免得半路跳出「强制接管」
          clearTimeout(timerRef.current);
          return;
        }
        if (message.type === "taken") {
          // 对方强夺了编辑权：本页必须降级只读，否则两边都以为自己在写
          if (handle.holds) handle.release();
        }
      },
    });
    channelRef.current = channel;

    return () => {
      clearTimeout(timerRef.current);
      channel?.close();
      channelRef.current = null;
      handle.stop();
      handleRef.current = null;
    };
  }, [from, name]);

  const takeover = useCallback(() => {
    const handle = handleRef.current;
    // 已经能编辑、或者还没问出锁的结果：没有什么可接管的
    if (!handle || handle.holds) return;
    if (takeoverState === "no-response") {
      // 第二次点：对方没响应，强夺。对方收到 taken 会自己转成只读
      handle.steal();
      channelRef.current?.post({ type: "taken", from });
      setTakeoverState("idle");
      return;
    }
    channelRef.current?.post({ type: "release-request", from });
    setTakeoverState("asking");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTakeoverState("no-response"), TAKEOVER_WAIT_MS);
  }, [from, takeoverState]);

  if (!name) return { status: "held", takeoverState: "idle", takeover };
  const status = result?.name === name ? result.state : "checking";
  return { status, takeoverState, takeover };
}
