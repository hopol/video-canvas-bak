import { describe, expect, test } from "bun:test";

import {
  openTakeoverChannel,
  takeoverChannelName,
  type BroadcastLike,
  type TakeoverMessage,
} from "@/utils/canvas/canvas-takeover";

/** 最小 BroadcastChannel：同名的其它频道能收到，自己收不到（和浏览器一致），关掉之后不再收 */
function fakeBus() {
  const opened: { channel: BroadcastLike; name: string; closed: boolean }[] = [];
  const create = (name: string) => {
    const entry = {
      name,
      closed: false,
      channel: {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage(data: unknown) {
          for (const other of opened) {
            if (other === entry || other.closed || other.name !== name) continue;
            other.channel.onmessage?.({ data } as MessageEvent);
          }
        },
        close() {
          entry.closed = true;
        },
      } as BroadcastLike,
    };
    opened.push(entry);
    return entry.channel;
  };
  return { create, opened };
}

describe("takeoverChannelName", () => {
  test("按锁名派生，不同画布不串台", () => {
    expect(takeoverChannelName("canvas:7:c1")).toBe("canvas:7:c1:takeover");
    expect(takeoverChannelName("canvas:7:c1")).not.toBe(takeoverChannelName("canvas:7:c2"));
  });
});

describe("openTakeoverChannel", () => {
  test("广播能送到另一头", () => {
    const bus = fakeBus();
    const got: TakeoverMessage[] = [];
    openTakeoverChannel({ name: "n", create: bus.create, onMessage: (m) => got.push(m) });
    const holder = openTakeoverChannel({ name: "n", create: bus.create, onMessage: () => {} });
    holder?.post({ type: "release-request", from: "a" });
    expect(got).toEqual([{ type: "release-request", from: "a" }]);
  });

  test("自己发的自己收不到：免得把让位请求当成别人发的", () => {
    const bus = fakeBus();
    const got: TakeoverMessage[] = [];
    const channel = openTakeoverChannel({
      name: "n",
      create: bus.create,
      onMessage: (m) => got.push(m),
    });
    channel?.post({ type: "release-request", from: "a" });
    expect(got).toEqual([]);
  });

  test("关掉之后不再收，也不再发出去", () => {
    const bus = fakeBus();
    const got: TakeoverMessage[] = [];
    const a = openTakeoverChannel({ name: "n", create: bus.create, onMessage: (m) => got.push(m) });
    const b = openTakeoverChannel({ name: "n", create: bus.create, onMessage: () => {} });
    a?.close();
    b?.post({ type: "taken", from: "b" });
    expect(got).toEqual([]);
  });

  test("形状不对的消息直接丢掉，不往下传", () => {
    const bus = fakeBus();
    const got: TakeoverMessage[] = [];
    openTakeoverChannel({ name: "n", create: bus.create, onMessage: (m) => got.push(m) });
    const self = bus.opened[0].channel;
    self.onmessage?.({ data: { type: 1 } } as MessageEvent);
    self.onmessage?.({ data: null } as MessageEvent);
    self.onmessage?.({ data: { type: "released" } } as MessageEvent);
    self.onmessage?.({ data: { type: "released", from: 7 } } as MessageEvent);
    expect(got).toEqual([]);
  });

  test("浏览器没有 BroadcastChannel：不接管，返回 null", () => {
    expect(openTakeoverChannel({ name: "n", create: () => null, onMessage: () => {} })).toBeNull();
  });
});
