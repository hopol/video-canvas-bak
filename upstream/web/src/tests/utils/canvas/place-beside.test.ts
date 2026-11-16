import { describe, expect, test } from "bun:test";

import type { CanvasNode, FlowNode } from "@/types";
import { placeBeside, placeInColumn } from "@/utils/canvas/place-beside";

import { makeData } from "../tasks/fixtures";

const node = (id: string, x: number, y: number, w = 576, h = 324): CanvasNode => ({
  id,
  type: "canvas",
  position: { x, y },
  measured: { width: w, height: h },
  data: makeData({ kind: "video", label: id }),
});

const source = node("src", 100, 200);

describe("placeBeside 把新节点摆到源节点右侧", () => {
  test("右侧 80px 外、垂直居中", () => {
    const pos = placeBeside({
      source,
      nodes: [source] as FlowNode[],
      size: { width: 576, height: 324 },
    });
    expect(pos).toEqual({ x: 100 + 576 + 80, y: 200 });
  });

  test("新节点比源节点矮时按它自己的高度居中", () => {
    const pos = placeBeside({
      source,
      nodes: [source] as FlowNode[],
      size: { width: 324, height: 180 },
    });
    expect(pos.y).toBeCloseTo(200 + 324 / 2 - 180 / 2);
  });

  test("右侧被占就向下错开一个新节点高度加间隔，直到不撞", () => {
    const blocker = node("b", 756, 200);
    const pos = placeBeside({
      source,
      nodes: [source, blocker] as FlowNode[],
      size: { width: 576, height: 324 },
    });
    expect(pos.x).toBe(756);
    expect(pos.y).toBe(200 + 324 + 40);
  });

  test("连续被占也能一直往下找，不会卡住", () => {
    const blockers = [0, 1, 2].map((i) => node(`b${i}`, 756, 200 + i * 364));
    const pos = placeBeside({
      source,
      nodes: [source, ...blockers] as FlowNode[],
      size: { width: 576, height: 324 },
    });
    expect(pos.y).toBe(200 + 3 * 364);
  });
});

describe("placeInColumn 把按镜号衍生的节点竖排在源节点右侧", () => {
  const size = { width: 576, height: 324 };

  test("第 0 格和源节点顶对齐，右侧 80px；之后每格往下一个节点高度加间隔", () => {
    const nodes = [source] as FlowNode[];
    expect(placeInColumn({ source, nodes, size, slot: 0 })).toEqual({ x: 100 + 576 + 80, y: 200 });
    expect(placeInColumn({ source, nodes, size, slot: 1 })).toEqual({
      x: 100 + 576 + 80,
      y: 200 + 324 + 40,
    });
    expect(placeInColumn({ source, nodes, size, slot: 3 }).y).toBe(200 + 3 * (324 + 40));
  });

  test("目标格已被别的节点占着：继续往下找到不撞的位置，不重叠", () => {
    const blocker = node("b", 756, 200 + 324 + 40);
    const pos = placeInColumn({ source, nodes: [source, blocker] as FlowNode[], size, slot: 1 });
    expect(pos.x).toBe(756);
    expect(pos.y).toBeGreaterThanOrEqual(blocker.position.y + 324 + 40);
  });

  test("按顺序一格格放，已经放好的节点会让后面的避开它们（互不重叠）", () => {
    const placed: CanvasNode[] = [];
    for (let slot = 0; slot < 4; slot++) {
      const pos = placeInColumn({ source, nodes: [source, ...placed] as FlowNode[], size, slot });
      placed.push(node(`i${slot}`, pos.x, pos.y));
    }
    const ys = placed.map((n) => n.position.y);
    expect(new Set(ys).size).toBe(4);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(324 + 40);
  });
});
