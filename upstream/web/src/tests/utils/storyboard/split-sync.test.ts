import { afterEach, describe, expect, test } from "bun:test";

import type { StoryboardSplitJob } from "@/api/storyboard/type";
import {
  handleStoryboardSplitEvent,
  isSplitSettled,
  markSplitSettled,
  reconcileStoryboardSplit,
  setSplitSink,
  type SplitSink,
} from "@/utils/storyboard/split-sync";

/** 拆分镜任务的接收端登记：WebSocket 回调在 React 之外，靠它把推送和对账交给当前打开的画布 */

const job = (canvasId: string): StoryboardSplitJob => ({
  id: "j1",
  canvas_id: canvasId,
  node_id: "sb",
  status: "running",
  model: "m",
  credits: 0,
});

function makeSink(canvasId: string) {
  const applied: StoryboardSplitJob[] = [];
  let reconciled = 0;
  const sink: SplitSink = {
    canvasId,
    apply: (j) => applied.push(j),
    reconcile: async () => void (reconciled += 1),
  };
  return { sink, applied, reconciled: () => reconciled };
}

afterEach(() => setSplitSink(null));

describe("拆分镜接收端", () => {
  test("推送属于当前画布才交给接收端，别的画布的丢弃", () => {
    const a = makeSink("c1");
    setSplitSink(a.sink);
    handleStoryboardSplitEvent(job("c1"));
    handleStoryboardSplitEvent(job("c2"));
    expect(a.applied.map((j) => j.canvas_id)).toEqual(["c1"]);
  });

  test("没有打开的画布时推送和对账都不报错", async () => {
    expect(() => handleStoryboardSplitEvent(job("c1"))).not.toThrow();
    await reconcileStoryboardSplit();
  });

  test("对账交给接收端", async () => {
    const a = makeSink("c1");
    setSplitSink(a.sink);
    await reconcileStoryboardSplit();
    expect(a.reconciled()).toBe(1);
  });

  test("注销只注销自己登记的那个：换画布时旧画布的卸载不会清掉新画布的登记", () => {
    const oldCanvas = makeSink("c1");
    const newCanvas = makeSink("c2");
    setSplitSink(oldCanvas.sink);
    setSplitSink(newCanvas.sink);
    setSplitSink(null, oldCanvas.sink);
    handleStoryboardSplitEvent(job("c2"));
    expect(newCanvas.applied).toHaveLength(1);
  });

  test("已处理的终态按任务 id 记下", () => {
    expect(isSplitSettled("settled-x")).toBe(false);
    markSplitSettled("settled-x");
    expect(isSplitSettled("settled-x")).toBe(true);
  });
});
