import { describe, expect, test } from "bun:test";

import type { Capabilities, ParamField } from "@/api/model/type";
import type { StoryboardShot } from "@/types";
import {
  actualDurationHint,
  buildVideoNodeSeed,
  pickVideoDuration,
  shotVideoPrompt,
  videoImageRole,
} from "@/utils/storyboard/video";

const shot = (patch: Partial<StoryboardShot> = {}): StoryboardShot => ({
  id: "a",
  scene: "月夜瓜地",
  shot: "远景",
  camera: "摇",
  action: "少年猫腰前行",
  dialogue: "",
  duration: 3,
  ...patch,
});

const enumField = (...options: number[]): ParamField => ({
  type: "enum",
  label: "时长",
  open: true,
  options,
  default: options[0],
});
const numberField = (min: number, max: number, step = 1): ParamField => ({
  type: "number",
  label: "时长",
  open: true,
  min,
  max,
  step,
  default: min,
});

describe("视频时长取模型支持的最接近值（PRD 6.6）", () => {
  test("枚举：取最接近的可选值，一样近取小的（少花积分）", () => {
    const f = enumField(5, 10);
    expect(pickVideoDuration(4, f)).toBe(5);
    expect(pickVideoDuration(7, f)).toBe(5);
    expect(pickVideoDuration(8, f)).toBe(10);
    expect(pickVideoDuration(7.5, f)).toBe(5);
    expect(pickVideoDuration(60, f)).toBe(10);
    expect(pickVideoDuration(1, f)).toBe(5);
  });

  test("枚举的选项写成字符串也认", () => {
    expect(
      pickVideoDuration(9, { type: "enum", label: "时长", open: true, options: ["5", "10"] }),
    ).toBe(10);
  });

  test("数字范围：四舍五入到整数后夹进 min–max，并按步长对齐", () => {
    expect(pickVideoDuration(2.4, numberField(3, 15))).toBe(3);
    expect(pickVideoDuration(20, numberField(3, 15))).toBe(15);
    expect(pickVideoDuration(7.6, numberField(3, 15))).toBe(8);
    // 步长 5：从 min 起 5、10、15
    expect(pickVideoDuration(7, numberField(5, 15, 5))).toBe(5);
    expect(pickVideoDuration(8, numberField(5, 15, 5))).toBe(10);
  });

  test("没有时长参数（模型没声明）：直接用这一行的时长，取整，至少 1 秒", () => {
    expect(pickVideoDuration(4.4, undefined)).toBe(4);
    expect(pickVideoDuration(0.2, undefined)).toBe(1);
  });

  test("枚举没有选项、数字缺范围：当作没声明", () => {
    expect(pickVideoDuration(6, { type: "enum", label: "时长", open: true, options: [] })).toBe(6);
    expect(pickVideoDuration(6, { type: "number", label: "时长", open: true })).toBe(6);
  });
});

describe("行上的「实际 Ns」提示（设计 §6.7）", () => {
  test("实际时长和行时长不一样才提示；一样不提示", () => {
    expect(actualDurationHint(4, 5, enumField(5, 10))).toEqual({
      actual: 5,
      title: "所选视频模型只支持 5s / 10s",
    });
    expect(actualDurationHint(5, 5, enumField(5, 10))).toBeNull();
  });

  test("行时长带小数：和节点时长按取整后的值比，4.6 对 5 不提示（取整后就是 5）", () => {
    expect(actualDurationHint(4.6, 5, undefined)).toBeNull();
    expect(actualDurationHint(4.4, 5, undefined)?.actual).toBe(5);
  });

  test("数字范围的模型：说明支持的范围", () => {
    expect(actualDurationHint(30, 15, numberField(3, 15))?.title).toBe("所选视频模型只支持 3–15s");
  });

  test("没有节点（还没建视频节点）或节点没有时长：不提示", () => {
    expect(actualDurationHint(4, undefined, enumField(5, 10))).toBeNull();
  });
});

describe("视频提示词：出图那套模板再加对白（PRD 6.6）", () => {
  test("没有对白：和分镜图提示词一样", () => {
    expect(shotVideoPrompt(shot())).toBe("远景，摇。月夜瓜地。少年猫腰前行。");
  });

  test("有对白：接在最后，句号收尾", () => {
    expect(shotVideoPrompt(shot({ dialogue: "OS：那猹却将身一扭" }))).toBe(
      "远景，摇。月夜瓜地。少年猫腰前行。对白：OS：那猹却将身一扭。",
    );
    expect(shotVideoPrompt(shot({ action: "", dialogue: "你好。" }))).toBe(
      "远景，摇。月夜瓜地。对白：你好。",
    );
  });

  test("对白全是空白不加", () => {
    expect(shotVideoPrompt(shot({ dialogue: "  \n " }))).toBe("远景，摇。月夜瓜地。少年猫腰前行。");
  });
});

const caps = (ops: Capabilities["ops"], image: boolean): Capabilities => ({
  ops,
  refs: {
    image: { on: image, max: 4, max_mb: 10 },
    video: { on: false, max: 0, max_mb: 0 },
    audio: { on: false, max: 0, max_mb: 0 },
  },
  prompt: { max_length: 1000 },
});

describe("分镜图当首帧还是参考图（按模型能力）", () => {
  test("这一行没有分镜图：只写提示词", () => {
    expect(videoImageRole(caps(["t2v", "i2v", "omni"], true), false)).toBeNull();
  });

  test("支持图生视频：连首帧，生成方式用 i2v", () => {
    expect(videoImageRole(caps(["t2v", "i2v"], true), true)).toEqual({
      role: "first-frame",
      op: "i2v",
    });
    // 都支持时首帧优先：分镜图就是这一镜的第一个画面
    expect(videoImageRole(caps(["i2v", "omni"], true), true)).toEqual({
      role: "first-frame",
      op: "i2v",
    });
  });

  test("只支持全能参考：连参考图，生成方式用 omni", () => {
    expect(videoImageRole(caps(["t2v", "omni"], true), true)).toEqual({
      role: "reference",
      op: "omni",
    });
  });

  test("都不支持（只有文生视频，或图片参考没开）：只写提示词", () => {
    expect(videoImageRole(caps(["t2v"], true), true)).toBeNull();
    expect(videoImageRole(caps(["i2v", "omni"], false), true)).toBeNull();
    expect(videoImageRole(undefined, true)).toBeNull();
  });
});

describe("视频节点建出来是什么样（buildVideoNodeSeed）", () => {
  const videoCaps = (
    ops: Capabilities["ops"],
    duration?: ParamField,
    image = true,
  ): Capabilities => ({
    ...caps(ops, image),
    params: duration ? { duration } : undefined,
  });

  test("提示词、时长都按这一行定；没有分镜图只写提示词，不带 op 以外的参考", () => {
    const seed = buildVideoNodeSeed({
      shot: shot({ duration: 4, dialogue: "你好" }),
      caps: videoCaps(["t2v", "i2v"], enumField(5, 10)),
      image: null,
    });
    expect(seed.prompt).toBe("远景，摇。月夜瓜地。少年猫腰前行。对白：你好。");
    expect(seed.params).toEqual({ prompt: seed.prompt, duration: 5 });
    expect(seed.linkImageNodeId).toBeNull();
    expect(seed.params.images).toBeUndefined();
  });

  test("有关联图片节点且已生成、模型支持图生视频：从图片节点连线进来当首帧，op 是 i2v", () => {
    const seed = buildVideoNodeSeed({
      shot: shot({ imageNodeId: "i1" }),
      caps: videoCaps(["t2v", "i2v"], enumField(5, 10)),
      image: { kind: "node", nodeId: "i1" },
    });
    expect(seed.linkImageNodeId).toBe("i1");
    expect(seed.params.op).toBe("i2v");
    expect(seed.params.images).toBeUndefined();
  });

  test("只支持全能参考：op 是 omni（图仍是连线进来的参考图）", () => {
    const seed = buildVideoNodeSeed({
      shot: shot({ imageNodeId: "i1" }),
      caps: videoCaps(["t2v", "omni"]),
      image: { kind: "node", nodeId: "i1" },
    });
    expect(seed.linkImageNodeId).toBe("i1");
    expect(seed.params.op).toBe("omni");
  });

  test("手传的分镜图没有图片节点：写进视频节点的手动参考素材（params.images 加 paramAssets）", () => {
    const seed = buildVideoNodeSeed({
      shot: shot({ image: { assetId: "9", src: "/files/9.png" } }),
      caps: videoCaps(["i2v"]),
      image: { kind: "asset", assetId: "9", src: "/files/9.png" },
    });
    expect(seed.linkImageNodeId).toBeNull();
    expect(seed.params.images).toEqual(["9"]);
    expect(seed.params.op).toBe("i2v");
    expect(seed.paramAssets).toEqual({ "9": { url: "/files/9.png", mediaType: "image" } });
  });

  test("模型不收图片参考或两种方式都不支持：有分镜图也只写提示词", () => {
    for (const c of [videoCaps(["t2v"]), videoCaps(["i2v"], undefined, false), undefined]) {
      const seed = buildVideoNodeSeed({
        shot: shot({ imageNodeId: "i1" }),
        caps: c,
        image: { kind: "node", nodeId: "i1" },
      });
      expect(seed.linkImageNodeId).toBeNull();
      expect(seed.params.images).toBeUndefined();
      expect(seed.params.op).toBeUndefined();
    }
  });

  test("模型没有时长参数：不写 duration，让节点用模型默认", () => {
    const seed = buildVideoNodeSeed({ shot: shot(), caps: videoCaps(["t2v"]), image: null });
    expect(seed.params.duration).toBeUndefined();
  });
});
