/**
 * 接管协议的约定：Web Locks 只能「抢」不能「商量」，被抢的一方也收不到任何信号
 * （锁被 steal 后回调照旧在跑），所以让位这件事必须另开一条广播通道。
 *
 * 两段式：
 * 1. 等待方广播 release-request → 持有方先回 saving（表示收到了）、把改动存盘、释放锁，再广播 released
 * 2. 持有方没响应（标签页被冻结、调试断点）时，等待方再广播 taken 并强夺
 *
 * 收到 taken 的一方必须降级成只读：否则两边都以为自己在写，比直接拦住更危险。
 */
export type TakeoverMessage =
  /** 等待方请求持有方让位 */
  | { type: "release-request"; from: string }
  /** 持有方收到了让位请求、正在存盘（存盘慢时先回一条，让等待方别急着判对方死了） */
  | { type: "saving"; from: string }
  /** 持有方已经存盘并释放了锁 */
  | { type: "released"; from: string }
  /** 已经强夺了锁（对方没响应），收到的一方要降级为只读 */
  | { type: "taken"; from: string };

/** 频道名按锁名派生：同一张画布才互相看得见 */
export const takeoverChannelName = (lockName: string) => `${lockName}:takeover`;

export type BroadcastLike = {
  postMessage: (message: unknown) => void;
  close: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

export type TakeoverChannel = { post: (message: TakeoverMessage) => void; close: () => void };

/** 浏览器自带实现；没有 BroadcastChannel（很老的浏览器）就不做接管，只能等对方关闭后自动接管 */
export const browserTakeoverChannel = (name: string): BroadcastLike | null =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name);

/**
 * 打开接管频道。create 可注入，测试里换成假的。
 * 通道拿不到（浏览器不支持）时返回 null，调用方按「只能等对方关闭」处理。
 */
export function openTakeoverChannel({
  name,
  create = browserTakeoverChannel,
  onMessage,
}: {
  name: string;
  create?: (name: string) => BroadcastLike | null;
  onMessage: (message: TakeoverMessage) => void;
}): TakeoverChannel | null {
  const channel = create(name);
  if (!channel) return null;
  channel.onmessage = (event) => {
    const message = event.data as TakeoverMessage | null;
    if (message && typeof message.type === "string" && typeof message.from === "string") {
      onMessage(message);
    }
  };
  return {
    post: (message) => channel.postMessage(message),
    close: () => {
      channel.onmessage = null;
      channel.close();
    },
  };
}
