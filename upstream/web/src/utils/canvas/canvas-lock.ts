/** 只用到 Web Locks 的这几个选项，方便测试里换成假实现 */
export type LockLike = {
  request: (
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};

export type CanvasLockState = "held" | "waiting";

/** 锁名按用户和画布区分：不同画布、不同账号互不影响 */
export const canvasLockName = (userId: string, canvasId: string) => `canvas:${userId}:${canvasId}`;

export type CanvasLockHandle = {
  /** 停止监听并释放锁 */
  stop: () => void;
  /** 此刻是否真的占着编辑权 */
  readonly holds: boolean;
  /**
   * 主动让出编辑权：释放锁并转为 waiting，排队方（刚请求接管的那个标签页）会立刻拿到。
   * 让出之后不再自动排队——什么时候要回来由用户点「接管」决定，不然另一边刚打开就被抢回去。
   */
  release: () => void;
  /**
   * 强夺编辑权：放弃排队后以 steal 拿锁。
   * 浏览器不支持 steal 时按「拿到」处理，和没有 Web Locks 时的口径一致（不拦着用户）。
   */
  steal: () => void;
};

/**
 * 同一张画布同一时刻只让一个标签页编辑，免得两个标签页互相覆盖本地草稿：
 * - 拿到锁：held，可以编辑
 * - 已被另一个标签页占用：waiting，调用方按只读预览挂载，同时排队等锁
 * - 占用的标签页关闭（锁自动释放）：排队的自动接管，变成 held
 * - 用户点「接管」：见 release / steal
 * 浏览器不支持 Web Locks 或请求出错时不拦着用户，直接当作 held。返回句柄：停止、让位、强夺。
 * waitingDelayMs：抢不到锁后先等这么久再通知 waiting。刚离开画布的标签页释放锁是异步的，
 * 马上在新标签页打开同一张画布会短暂抢不到，宽限期内锁空出来就直接 held，不让只读态一闪而过。
 */
export function watchCanvasLock({
  name,
  locks,
  onChange,
  waitingDelayMs = 0,
}: {
  name: string;
  locks: LockLike | undefined;
  onChange: (state: CanvasLockState) => void;
  waitingDelayMs?: number;
}): CanvasLockHandle {
  let stopped = false;
  let holds = false;
  let waitingTimer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | null = null;
  const controller = new AbortController();

  const notify = (state: CanvasLockState) => {
    if (!stopped) onChange(state);
  };
  /** 通知 waiting：有宽限就等宽限过了还在等才通知 */
  const notifyWaiting = () => {
    if (waitingDelayMs <= 0) notify("waiting");
    else waitingTimer = setTimeout(() => notify("waiting"), waitingDelayMs);
  };
  /** 拿到锁后一直占着，直到停止或让位 */
  const hold = () =>
    new Promise<void>((resolve) => {
      release = resolve;
      if (stopped) resolve();
    });
  const acquire = (fromQueue: boolean) => {
    return async (lock: unknown) => {
      if (!lock) return;
      if (fromQueue) clearTimeout(waitingTimer);
      holds = true;
      notify("held");
      await hold();
      holds = false;
    };
  };

  if (!locks) {
    // 没有 Web Locks：当作拿到了。让位仍然有效（把状态推回 waiting），只是没有锁可放
    holds = true;
    notify("held");
    return {
      stop: () => {
        stopped = true;
        holds = false;
      },
      get holds() {
        return holds;
      },
      release: () => {
        holds = false;
        notify("waiting");
      },
      steal: () => {
        if (stopped) return;
        holds = true;
        notify("held");
      },
    };
  }

  locks
    .request(name, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await acquire(false)(lock);
        return;
      }
      notifyWaiting();
      // 排队等占用的标签页关闭
      await locks
        .request(name, { signal: controller.signal }, acquire(true))
        .catch(() => undefined);
    })
    .catch(() => {
      // 请求本身失败（浏览器不支持、被策略拦下）：不拦着用户
      holds = true;
      notify("held");
    });

  return {
    stop: () => {
      stopped = true;
      clearTimeout(waitingTimer);
      controller.abort();
      release?.();
      release = null;
      holds = false;
    },
    get holds() {
      return holds;
    },
    release: () => {
      clearTimeout(waitingTimer);
      const done = release;
      release = null;
      holds = false;
      done?.();
      notify("waiting");
    },
    steal: () => {
      if (stopped || holds) return;
      clearTimeout(waitingTimer);
      // 放弃排队，不然会和 steal 抢出两把锁
      controller.abort();
      void locks.request(name, { steal: true }, acquire(true)).catch(() => {
        holds = true;
        notify("held");
      });
    },
  };
}
