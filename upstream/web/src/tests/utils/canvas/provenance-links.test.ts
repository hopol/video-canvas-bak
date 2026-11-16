import { describe, expect, test } from "bun:test";

import type { CanvasNode } from "@/types";
import { withoutProvenanceSources } from "@/utils/canvas/provenance-links";

const node = (id: string, kind: CanvasNode["data"]["kind"]): CanvasNode => ({
  id,
  type: "canvas",
  position: { x: 0, y: 0 },
  data: { kind, label: id },
});

describe("withoutProvenanceSources：只表示来源的上游不参与生成", () => {
  const connections = [
    { source: "t", edgeId: "e1" },
    { source: "sb", edgeId: "e2" },
    { source: "i", edgeId: "e3" },
  ];
  const nodes = [node("t", "script"), node("sb", "storyboard"), node("i", "image")];

  test("分镜表连进来的线和节点都被去掉，别的原样保留且顺序不变", () => {
    const out = withoutProvenanceSources(connections, nodes);
    expect(out.connections.map((c) => c.source)).toEqual(["t", "i"]);
    expect(out.nodes.map((n) => n.id)).toEqual(["t", "i"]);
  });

  test("没有分镜表时原样返回同一个引用，调用方的 memo 不会被打破", () => {
    const plain = connections.filter((c) => c.source !== "sb");
    const plainNodes = nodes.filter((n) => n.id !== "sb");
    const out = withoutProvenanceSources(plain, plainNodes);
    expect(out.connections).toBe(plain);
    expect(out.nodes).toBe(plainNodes);
  });
});
