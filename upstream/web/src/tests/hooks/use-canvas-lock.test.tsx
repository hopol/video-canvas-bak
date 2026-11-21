import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { useEffect } from "react";

import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { CanvasLock as LockType, useCanvasLock as HookType } from "@/hooks/use-canvas-lock";
import type { LockLike } from "@/utils/canvas/canvas-lock";

/**
 * 两个标签页抢同一张画布：这里一个进程里挂两个 useCanvasLock（模拟两个页签）。
 * 锁走假的 LockManager（同一个实例给两个"页签"共用），接管协议走真的 BroadcastChannel
 * ——同文档里两个实例本来就互相收得到，和真浏览器两个页签的语义一致。
 */

let dom: DomEnv;
let useCanvasLock: typeof HookType;

/** 留一点余量：hook 里等锁 600ms、等对方存盘 1800ms */
const LOCK_GRACE = 700;
const TAKEOVER_WAIT = 2000;

beforeAll(async () => {
  dom = await installDom();
  const mod = await import("@/hooks/use-canvas-lock");
  useCanvasLock = mod.useCanvasLock;
  // 认不出登录账号就没有锁：给个只有 user_id 的假令牌
  const payload = Buffer.from(JSON.stringify({ user_id: 7 })).toString("base64");
  localStorage.setItem("video_design_token", `h.${payload}.s`);
});
afterAll(() => dom.restore());

/** 每个用例换一套锁，免得上一个用例占着名字 */
function createLocks(): LockLike & { holds: (name: string) => boolean } {
  const holders = new Map<string, symbol>();
  const queue: {
    name: string;
    cb: (lock: unknown) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }[] = [];

  const start = (
    name: string,
    cb: (lock: unknown) => Promise<unknown>,
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void,
  ) => {
    const token = Symbol(name);
    holders.set(name, token);
    cb({ name })
      .then(resolve, reject)
      .finally(() => {
        // 被强夺过的话名字已经换主人了，别再动它
        if (holders.get(name) !== token) return;
        holders.delete(name);
        const index = queue.findIndex((item) => item.name === name);
        if (index < 0) return;
        const [next] = queue.splice(index, 1);
        start(name, next.cb, next.resolve, next.reject);
      });
  };

  return {
    request(name, options, callback) {
      return new Promise<unknown>((resolve, reject) => {
        if (options.steal) {
          // 强夺：直接把名字换给新请求方，老持有方的回调不会被打断（真实实现也是这样）
          start(name, callback, resolve, reject);
          return;
        }
        if (options.ifAvailable) {
          if (holders.has(name)) {
            void callback(null).then(resolve, reject);
            return;
          }
          start(name, callback, resolve, reject);
          return;
        }
        if (!holders.has(name)) {
          start(name, callback, resolve, reject);
          return;
        }
        const item = { name, cb: callback, resolve, reject };
        queue.push(item);
        options.signal?.addEventListener("abort", () => {
          const index = queue.indexOf(item);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
    holds: (name) => holders.has(name),
  };
}

/** 装好 fake locks 后挂一个"页签"，返回随时能读到最新状态的探针 */
async function openTab(options: { onYield?: () => Promise<unknown> | unknown } = {}) {
  const seam: { lock: LockType | null } = { lock: null };
  const mounted = await dom.mount(
    <Tab onYield={options.onYield} onLock={(lock) => (seam.lock = lock)} />,
  );
  return {
    get lock() {
      if (!seam.lock) throw new Error("还没挂上");
      return seam.lock;
    },
    unmount: mounted.unmount,
  };
}

function Tab({
  onYield,
  onLock,
}: {
  onYield?: () => Promise<unknown> | unknown;
  onLock: (lock: LockType) => void;
}) {
  const lock = useCanvasLock("c1", { onYield });
  useEffect(() => {
    onLock(lock);
  });
  return <span data-status={lock.status} data-takeover={lock.takeoverState} />;
}

/**
 * 让位请求全丢的假 BroadcastChannel：模拟「请了对方，对方没反应」。
 * 别的消息（taken）照常送——对方醒来还是要能降级只读。
 */
const silentOpened: SilentChannel[] = [];
class SilentChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    silentOpened.push(this);
  }
  postMessage(data: { type?: string }) {
    if (data?.type === "release-request") return;
    for (const peer of silentOpened) {
      if (peer === this || peer.closed) continue;
      peer.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
  }
}
const silentChannels = () => SilentChannel;

describe("useCanvasLock：只读预览与接管", () => {
  const name = () => `canvas:${7}:c1`;
  test("第二个页签先进只读预览，不是被整页拦住", async () => {
    const locks = createLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const first = await openTab();
    await dom.flush(20);
    expect(first.lock.status).toBe("held");

    const second = await openTab();
    await dom.flush(LOCK_GRACE);
    // 等待方拿到 waiting：页面按只读挂载，不是空白拦截页
    expect(second.lock.status).toBe("waiting");
    expect(locks.holds(name())).toBe(true);

    await second.unmount();
    await first.unmount();
    await dom.flush(20);
  });

  test("点接管：先让对方存盘，存完才把编辑权交出去，两边不会同时以为自己在写", async () => {
    const locks = createLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const events: string[] = [];
    let finishSave: () => void = () => {};
    const first = await openTab({
      onYield: () => {
        events.push("开始存盘");
        return new Promise<void>((resolve) => {
          finishSave = () => {
            events.push("存盘完成");
            resolve();
          };
        });
      },
    });
    await dom.flush(20);
    const second = await openTab();
    await dom.flush(LOCK_GRACE);
    expect(second.lock.status).toBe("waiting");

    await dom.act(async () => second.lock.takeover());
    await dom.flush(50);
    // 对方还在存盘：这一瞬间谁都不该拿到两把锁
    expect(events).toEqual(["开始存盘"]);
    expect(second.lock.takeoverState).toBe("asking");
    expect(first.lock.status).toBe("held");
    expect(second.lock.status).toBe("waiting");

    await dom.act(async () => finishSave());
    await dom.flush(50);
    expect(events).toEqual(["开始存盘", "存盘完成"]);
    // 让位完成：接管方转可编辑，原持有方转只读
    expect(second.lock.status).toBe("held");
    expect(second.lock.takeoverState).toBe("idle");
    expect(first.lock.status).toBe("waiting");
    expect(locks.holds(name())).toBe(true);

    await second.unmount();
    await first.unmount();
    await dom.flush(20);
  });

  test("对方回了「正在存盘」就不算没响应：存得慢也照样等，不会半路跳成强制接管", async () => {
    const locks = createLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const first = await openTab({ onYield: () => new Promise<void>(() => {}) });
    await dom.flush(20);
    const second = await openTab();
    await dom.flush(LOCK_GRACE);

    await dom.act(async () => second.lock.takeover());
    // 后台页签存盘本来就慢：过了冷静期也还在等，不该催用户强夺
    await dom.flush(TAKEOVER_WAIT);
    expect(second.lock.takeoverState).toBe("asking");
    expect(first.lock.status).toBe("held");
    expect(second.lock.status).toBe("waiting");

    await second.unmount();
    await first.unmount();
    await dom.flush(20);
  });

  test("对方彻底没回声：等一会儿变强制接管，强夺之后对方必须降级只读", async () => {
    const locks = createLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    // 让位请求全部丢掉：模拟对方页签停在断点上、消息到了也不处理
    const realChannel = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = silentChannels() as unknown as typeof BroadcastChannel;
    try {
      const first = await openTab({ onYield: () => new Promise<void>(() => {}) });
      await dom.flush(20);
      const second = await openTab();
      await dom.flush(LOCK_GRACE);
      expect(second.lock.status).toBe("waiting");

      await dom.act(async () => second.lock.takeover());
      await dom.flush(TAKEOVER_WAIT);
      // 连「正在存盘」都没回：不硬闯，先把按钮换成「强制接管」
      expect(second.lock.takeoverState).toBe("no-response");
      expect(first.lock.status).toBe("held");

      await dom.act(async () => second.lock.takeover());
      await dom.flush(50);
      expect(second.lock.status).toBe("held");
      expect(locks.holds(name())).toBe(true);
      // 关键：被抢的一方收到 taken 立刻转只读，不然两边都在写
      expect(first.lock.status).toBe("waiting");

      await second.unmount();
      await first.unmount();
      await dom.flush(20);
    } finally {
      globalThis.BroadcastChannel = realChannel;
    }
  });

  test("已经能编辑的页签点接管：什么都不发生，不会把自己踢成只读", async () => {
    const locks = createLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const only = await openTab();
    await dom.flush(20);
    expect(only.lock.status).toBe("held");
    await dom.act(async () => only.lock.takeover());
    await dom.flush(50);
    expect(only.lock.status).toBe("held");
    expect(only.lock.takeoverState).toBe("idle");
    await only.unmount();
    await dom.flush(20);
  });
});
