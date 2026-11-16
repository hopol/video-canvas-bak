import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  isSplitRunning,
  readSplitModel,
  splitDisabledReason,
  useStoryboardSplit,
} from "@/store/storyboard-split";

/** bun 的测试环境没有 localStorage，放一个最小的内存实现 */
const memory = new Map<string, string>();
beforeAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
});
afterAll(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

beforeEach(() => {
  memory.clear();
  useStoryboardSplit.setState({ states: {}, overwrite: null, highlights: {}, model: "" });
});

describe("分镜表拆分运行时状态", () => {
  test("默认 idle；start → running；done 后清空状态并标记新行高亮", () => {
    const s = useStoryboardSplit.getState();
    expect(s.stateOf("sb1")).toEqual({ phase: "idle" });
    s.start("sb1", "append");
    expect(useStoryboardSplit.getState().stateOf("sb1")).toEqual({
      phase: "running",
      mode: "append",
    });
    useStoryboardSplit.getState().done("sb1", ["a", "b"]);
    const after = useStoryboardSplit.getState();
    expect(after.stateOf("sb1")).toEqual({ phase: "idle" });
    expect(after.highlights["sb1"]).toEqual(new Set(["a", "b"]));
    expect(isSplitRunning(after.stateOf("sb1"))).toBe(false);
  });

  test("failed 保留模式，dismiss 清掉横幅", () => {
    const s = useStoryboardSplit.getState();
    s.start("sb1", "replace");
    s.fail("sb1", "超时");
    expect(useStoryboardSplit.getState().stateOf("sb1")).toEqual({
      phase: "failed",
      reason: "超时",
      mode: "replace",
    });
    useStoryboardSplit.getState().dismiss("sb1");
    expect(useStoryboardSplit.getState().stateOf("sb1")).toEqual({ phase: "idle" });
  });

  test("各节点状态独立，不互相串", () => {
    const s = useStoryboardSplit.getState();
    s.start("sb1", "append");
    s.fail("sb2", "x");
    const after = useStoryboardSplit.getState();
    expect(after.stateOf("sb1").phase).toBe("running");
    expect(after.stateOf("sb2").phase).toBe("failed");
  });

  test("覆盖意图：askOverwrite 打开、closeOverwrite 关闭", () => {
    const s = useStoryboardSplit.getState();
    s.askOverwrite("sb1", 6);
    expect(useStoryboardSplit.getState().overwrite).toEqual({ nodeId: "sb1", existingCount: 6 });
    useStoryboardSplit.getState().closeOverwrite();
    expect(useStoryboardSplit.getState().overwrite).toBeNull();
  });
});

describe("拆分按钮禁用原因", () => {
  test("按优先级：没连剧本 > 剧本空 > 正在拆", () => {
    expect(splitDisabledReason(false, false, "idle")).toBe("请先连接剧本节点");
    expect(splitDisabledReason(true, true, "idle")).toBe("剧本节点还没有内容");
    expect(splitDisabledReason(true, false, "running")).toBe("正在拆分镜");
    expect(splitDisabledReason(true, false, "idle")).toBe("");
    expect(splitDisabledReason(true, false, "failed")).toBe("");
  });
});

describe("拆分镜模型选择", () => {
  test("默认空串（跟随后台第一个）；选了之后三个入口共用，并记在本机", () => {
    expect(useStoryboardSplit.getState().model).toBe("");
    useStoryboardSplit.getState().setModel("agent-b");
    expect(useStoryboardSplit.getState().model).toBe("agent-b");
    expect(readSplitModel()).toBe("agent-b");
    useStoryboardSplit.getState().setModel("");
    expect(readSplitModel()).toBe("");
  });
});
