import { describe, expect, test } from "bun:test";

import { ANIMATED_EDGE_OPTIONS } from "@/constants/canvas";
import type { FlowNode } from "@/types";
import { agentPatchMerge, deserializeNode } from "@/utils/canvas/canvas-persistence";
import { applyChanges, type GraphChange } from "@/utils/canvas/graph-changes";

// 用的就是 use-agent-canvas-sync 合并补丁时的那一份选项，不在测试里另拼
const merge = { guard: true, ...agentPatchMerge };

const createGroup = (id: string): GraphChange => ({
  kind: "node",
  op: "create",
  id,
  after: {
    id,
    type: "group",
    position: { x: 3880, y: 382 },
    width: 1368,
    height: 444,
    "data.label": "镜01",
  },
});
const createMember = (id: string, parentId: string, x: number): GraphChange => ({
  kind: "node",
  op: "create",
  id,
  after: {
    id,
    type: "canvas",
    parentId,
    position: { x, y: 72 },
    "data.kind": "image",
    "data.label": id,
  },
});

const byId = (nodes: FlowNode[], id: string) => nodes.find((n) => n.id === id) as FlowNode;

describe("Agent 补丁新建的节点保留所属组", () => {
  test("同一个补丁里新建组和成员：成员仍挂在组下，组排在成员前，组内坐标不变", () => {
    const patch = [createMember("m1", "g1", 48), createMember("m2", "g1", 588), createGroup("g1")];
    const { nodes } = applyChanges({ nodes: [], edges: [] }, patch, merge);

    expect(byId(nodes, "m1").parentId).toBe("g1");
    expect(byId(nodes, "m2").parentId).toBe("g1");
    expect(byId(nodes, "m2").position).toEqual({ x: 588, y: 72 });
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf("g1")).toBeLessThan(ids.indexOf("m1"));
    expect(ids.indexOf("g1")).toBeLessThan(ids.indexOf("m2"));
  });

  test("补丁只往已有的组里加成员：成员保留 parentId", () => {
    const local = applyChanges({ nodes: [], edges: [] }, [createGroup("g1")], merge);
    const { nodes } = applyChanges(local, [createMember("m1", "g1", 48)], merge);

    expect(byId(nodes, "m1").parentId).toBe("g1");
  });

  test("成员指向确实不存在的组：整批规整时仍会清掉 parentId", () => {
    const { nodes } = applyChanges(
      { nodes: [], edges: [] },
      [createMember("m1", "ghost", 48)],
      merge,
    );

    expect(byId(nodes, "m1").parentId).toBeUndefined();
  });

  test("补丁新建的连线带上画布统一的动画样式", () => {
    const patch: GraphChange[] = [
      createGroup("g1"),
      createMember("m1", "g1", 48),
      createMember("m2", "g1", 588),
      { kind: "edge", op: "create", id: "e1", after: { id: "e1", source: "m1", target: "m2" } },
    ];
    const { edges } = applyChanges({ nodes: [], edges: [] }, patch, merge);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "m1", target: "m2", ...ANIMATED_EDGE_OPTIONS });
  });
});

describe("deserializeNode：单个节点的读档修整", () => {
  test("不看有没有组：指向别处的 parentId 原样保留，留给整批规整去判断", () => {
    const node = deserializeNode({
      id: "a",
      type: "canvas",
      parentId: "g",
      position: { x: 1, y: 2 },
      data: { kind: "image", label: "A" },
    } as never);

    expect(node.parentId).toBe("g");
  });

  test("没有 taskId 的 running 读成 idle", () => {
    const node = deserializeNode({
      id: "a",
      type: "canvas",
      position: { x: 0, y: 0 },
      data: { kind: "image", label: "A", status: "running" },
    } as never);

    expect((node.data as { status?: string }).status).toBe("idle");
  });
});

describe("Agent 补丁写分镜表", () => {
  const shot = (id: string, scene: string) => ({
    id,
    scene,
    shot: "中景",
    camera: "固定",
    action: "",
    dialogue: "",
    duration: 3,
  });

  test("补丁新建的分镜表带着镜头，读进来时照样规整", () => {
    const patch: GraphChange[] = [
      {
        kind: "node",
        op: "create",
        id: "sb",
        after: {
          id: "sb",
          type: "canvas",
          position: { x: 0, y: 0 },
          "data.kind": "storyboard",
          "data.label": "分镜表",
          "data.storyboard": { shots: [shot("a", "推门"), { ...shot("b", "看窗"), duration: 99 }] },
        },
      },
    ];
    const { nodes } = applyChanges({ nodes: [], edges: [] }, patch, merge);
    const shots = byId(nodes, "sb").data.storyboard?.shots ?? [];
    expect(shots.map((s) => s.scene)).toEqual(["推门", "看窗"]);
    expect(shots[1].duration).toBe(60);
  });

  test("补丁改已有分镜表的镜头：整份 storyboard 换成新的", () => {
    const local = applyChanges(
      { nodes: [], edges: [] },
      [
        {
          kind: "node",
          op: "create",
          id: "sb",
          after: {
            id: "sb",
            type: "canvas",
            position: { x: 0, y: 0 },
            "data.kind": "storyboard",
            "data.label": "分镜表",
            "data.storyboard": { shots: [shot("a", "推门"), shot("b", "看窗")] },
          },
        },
      ],
      merge,
    );
    const before = byId(local.nodes, "sb").data.storyboard;
    const next = { shots: [shot("b", "看窗"), { ...shot("a", "推门"), shot: "特写" }] };
    const { nodes } = applyChanges(
      local,
      [
        {
          kind: "node",
          op: "update",
          id: "sb",
          before: { "data.storyboard": before },
          after: { "data.storyboard": next },
        },
      ],
      merge,
    );
    expect(byId(nodes, "sb").data.storyboard).toEqual(next);
  });
});
