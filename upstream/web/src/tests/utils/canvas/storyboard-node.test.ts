import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ADD_NODE_MENU, DOWNSTREAM_KINDS, NODE_META } from "@/constants/canvas";
import { NODE_TOOLBAR } from "@/constants/node-toolbar";
import { DEFAULT_NODE_SIZE } from "@/utils/canvas/placement";
import { DEFAULT_NODE_ASPECT, nodeFrameSize } from "@/utils/canvas/node-frame";
import { STORYBOARD_FRAME } from "@/utils/storyboard/card-frame";
import type { CanvasNode, NodeKind } from "@/types";
import {
  deserializeGraph,
  deserializeNode,
  serializeGraph,
} from "@/utils/canvas/canvas-persistence";
import { canLinkNodes } from "@/utils/canvas/link-rule";
import { toolbarGate } from "@/utils/canvas/node-toolbar-state";

const viewport = { x: 0, y: 0, zoom: 1 };

const shots = [
  {
    id: "a",
    scene: "推门进屋",
    shot: "全景" as const,
    camera: "推" as const,
    action: "从门口走到窗边",
    dialogue: "OS：又是雨天。",
    duration: 4.5,
  },
  {
    id: "b",
    scene: "看向窗外",
    shot: "特写" as const,
    camera: "固定" as const,
    action: "",
    dialogue: "",
    duration: 2,
  },
];

const storyboard = (data: Partial<CanvasNode["data"]> = {}): CanvasNode => ({
  id: "sb1",
  type: "canvas",
  position: { x: 0, y: 0 },
  data: { kind: "storyboard", label: "分镜表", storyboard: { shots }, ...data },
});

describe("分镜表节点注册", () => {
  test("添加节点菜单里有「分镜表」", () => {
    expect(NODE_META.get("storyboard")?.label).toBe("分镜表");
    expect(ADD_NODE_MENU.some((item) => item.kind === "storyboard")).toBe(true);
  });

  test("只有文本节点能连进分镜表，音频、图片、视频、导演台、角色卡都不行", () => {
    const to = { kind: "storyboard" as const };
    expect(canLinkNodes({ kind: "script" }, to)).toBe(true);
    for (const kind of [
      "audio",
      "image",
      "video",
      "director",
      "character",
      "storyboard",
    ] as NodeKind[]) {
      expect(canLinkNodes({ kind }, to)).toBe(false);
    }
  });

  test("分镜表右边有出口：能连到图片、视频节点，连不到音频、文本、导演台、角色卡和自己", () => {
    expect(DOWNSTREAM_KINDS.storyboard).toEqual(["image", "video"]);
    const from = { kind: "storyboard" as const };
    expect(canLinkNodes(from, { kind: "image" })).toBe(true);
    expect(canLinkNodes(from, { kind: "video" })).toBe(true);
    for (const kind of ["audio", "script", "director", "character", "storyboard"] as NodeKind[]) {
      expect(canLinkNodes(from, { kind })).toBe(false);
    }
  });

  test("连到只收部分素材的模型上也能连：连线只表示来源，不占用模型的参考素材能力", () => {
    // 文本模型 / 不收参考图的视频模型：普通上游会因「模型不收这种素材」被拒，分镜表不受影响
    expect(canLinkNodes({ kind: "storyboard" }, { kind: "video", model: "no-such-model" })).toBe(
      true,
    );
  });

  test("选中分镜表走公共功能区：显示、按钮可点，配置里只有「编辑分镜」", () => {
    expect(toolbarGate(storyboard().data)).toEqual({ visible: true, actionsDisabled: false });
    expect(toolbarGate(storyboard({ storyboard: { shots: [] } }).data).visible).toBe(true);
    expect(NODE_TOOLBAR.storyboard.actions.map((a) => [a.id, a.label])).toEqual([
      ["edit-storyboard", "编辑分镜"],
    ]);
    expect(NODE_TOOLBAR.storyboard.tail).toEqual([]);
  });

  test("节点卡片和 16:9 的图片节点一样大，也等于新建、排版用的默认尺寸", () => {
    expect(STORYBOARD_FRAME).toEqual(nodeFrameSize(DEFAULT_NODE_ASPECT));
    expect(STORYBOARD_FRAME).toEqual({
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    });
    const src = readFileSync(
      new URL("../../../components/canvas-editor/storyboard-node.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain("STORYBOARD_FRAME");
    expect(src).not.toMatch(/width=\{\s*\d+\s*\}|CARD_WIDTH/);
  });

  test("节点功能栏里没有拆分镜按钮：拆分镜只在弹窗标题栏和空状态", () => {
    const src = readFileSync(
      new URL("../../../components/canvas-editor/storyboard-node.tsx", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("kindExtra");
    expect(src).not.toContain("<SplitControls");
    expect(NODE_TOOLBAR.storyboard.actions).toHaveLength(1);
  });

  test("分镜表节点不再自己摆功能区：功能区只由公共 NodeOverlays 摆放", () => {
    const src = readFileSync(
      new URL("../../../components/canvas-editor/storyboard-node.tsx", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("NodeToolbar");
    expect(src).toContain("<NodeOverlays");
  });
});

describe("分镜表节点存档", () => {
  test("镜头原样存下、读回", () => {
    const graph = serializeGraph([storyboard()], [], viewport);
    expect(graph.nodes[0].data).toMatchObject({ kind: "storyboard", storyboard: { shots } });
    const restored = deserializeGraph(JSON.parse(JSON.stringify(graph))).nodes[0] as CanvasNode;
    expect(restored.data.storyboard).toEqual({ shots });
  });

  test("读档时规整：坏数据读成空表，越界时长修正", () => {
    const raw = JSON.parse(JSON.stringify(serializeGraph([storyboard()], [], viewport)));
    raw.nodes[0].data.storyboard = { shots: [{ ...shots[0], duration: 0 }] };
    expect((deserializeGraph(raw).nodes[0] as CanvasNode).data.storyboard?.shots[0].duration).toBe(
      1,
    );
    raw.nodes[0].data.storyboard = "坏数据";
    expect((deserializeGraph(raw).nodes[0] as CanvasNode).data.storyboard).toEqual({ shots: [] });
  });

  test("没有 storyboard 字段的分镜表节点读回时补空表；单节点读取同样规整", () => {
    const raw = JSON.parse(
      JSON.stringify(serializeGraph([storyboard({ storyboard: undefined })], [], viewport)),
    );
    expect((deserializeGraph(raw).nodes[0] as CanvasNode).data.storyboard).toEqual({ shots: [] });
    expect((deserializeNode(raw.nodes[0]) as CanvasNode).data.storyboard).toEqual({ shots: [] });
  });

  test("别的种类的节点不带 storyboard", () => {
    const image: CanvasNode = {
      id: "i1",
      type: "canvas",
      position: { x: 0, y: 0 },
      data: { kind: "image", label: "图片" },
    };
    const restored = deserializeGraph(serializeGraph([image], [], viewport)).nodes[0] as CanvasNode;
    expect(restored.data.storyboard).toBeUndefined();
  });
});
