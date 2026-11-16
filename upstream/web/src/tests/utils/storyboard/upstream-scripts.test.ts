import { describe, expect, test } from "bun:test";

import type { CanvasEdge, CanvasNode } from "@/types";
import { upstreamScripts } from "@/utils/storyboard/upstream-scripts";

const node = (id: string, kind: CanvasNode["data"]["kind"], text?: string): CanvasNode => ({
  id,
  type: "canvas",
  position: { x: 0, y: 0 },
  data: { kind, label: id, ...(text !== undefined ? { text } : {}) } as CanvasNode["data"],
});

const edge = (id: string, source: string, target: string = "sb"): CanvasEdge => ({
  id,
  source,
  target,
});

describe("分镜表上游剧本拼接", () => {
  test("没连剧本时返回空：script 空、count 0、hasScript false", () => {
    expect(upstreamScripts("sb", [node("sb", "storyboard")], [])).toEqual({
      script: "",
      count: 0,
      hasScript: false,
    });
  });

  test("连了多个剧本节点：按连线先后（edges 数组顺序，和连线 id 无关）拼接正文，去首尾空白，段之间空行分隔", () => {
    const nodes = [
      node("sb", "storyboard"),
      node("s1", "script", "  第一段  "),
      node("s2", "script", "第二段"),
      node("s3", "script", "第三段"),
    ];
    // xyflow 的 addEdge 生成的 id 是 xy-edge__源-目标，字典序和连线先后无关：先连 s2，再连 s3，最后连 s1
    const edges = [
      edge("xy-edge__s2-sb", "s2"),
      edge("xy-edge__s3-sb", "s3"),
      edge("xy-edge__s1-sb", "s1"),
    ];
    const got = upstreamScripts("sb", nodes, edges);
    expect(got.script).toBe("第二段\n\n第三段\n\n第一段");
    expect(got.count).toBe(3);
    expect(got.hasScript).toBe(true);
  });

  test("跳过非剧本节点和空剧本：hasScript 看是否连了剧本，count 只算有内容的", () => {
    const nodes = [
      node("sb", "storyboard"),
      node("s1", "script"),
      node("s2", "script", "  "),
      node("i1", "image"),
      node("s3", "script", "有内容"),
    ];
    const edges = [edge("e1", "s1"), edge("e2", "s2"), edge("e3", "i1"), edge("e4", "s3")];
    const got = upstreamScripts("sb", nodes, edges);
    expect(got.script).toBe("有内容");
    expect(got.count).toBe(1);
    expect(got.hasScript).toBe(true);
  });

  test("源节点被删了只剩连线：不参与拼接", () => {
    const nodes = [node("sb", "storyboard")];
    expect(upstreamScripts("sb", nodes, [edge("e1", "gone")])).toEqual({
      script: "",
      count: 0,
      hasScript: false,
    });
  });
});
