import { describe, expect, test } from "bun:test";

import type { StoryboardShot } from "@/types";
import { pickDefaultModel } from "@/utils/canvas/default-model";
import { shotImagePrompt } from "@/utils/storyboard/prompt";
import { firstImageFile, takeShotImageFile } from "@/utils/storyboard/upload";
import {
  duplicateShot,
  linkShot,
  normalizeStoryboard,
  pruneShotLinks,
  removeShotImage,
} from "@/utils/storyboard/shots";

const shot = (id: string, patch: Partial<StoryboardShot> = {}): StoryboardShot => ({
  id,
  scene: `画面${id}`,
  shot: "中景",
  camera: "固定",
  action: "",
  dialogue: "",
  duration: 3,
  ...patch,
});
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("分镜图提示词模板（PRD 6.5）", () => {
  test("{景别}，{运镜}。{画面描述}。{动作/走位}", () => {
    expect(
      shotImagePrompt(
        shot("a", { scene: "月夜瓜地", shot: "远景", camera: "摇", action: "少年猫腰前行" }),
      ),
    ).toBe("远景，摇。月夜瓜地。少年猫腰前行。");
  });

  test("没写动作就不留空句；景别、运镜缺哪个就省哪个；句末的句号不重复", () => {
    expect(shotImagePrompt(shot("a", { scene: "开门。", shot: "特写", camera: "推" }))).toBe(
      "特写，推。开门。",
    );
    expect(shotImagePrompt(shot("a", { shot: "", camera: "固定", scene: "走廊" }))).toBe(
      "固定。走廊。",
    );
    expect(shotImagePrompt(shot("a", { shot: "", camera: "", scene: "走廊", action: "" }))).toBe(
      "走廊。",
    );
  });

  test("对白不进分镜图提示词", () => {
    expect(shotImagePrompt(shot("a", { dialogue: "你好" }))).not.toContain("你好");
  });
});

describe("行关联的图片 / 视频节点和手传分镜图", () => {
  test("linkShot 记下关联节点；pruneShotLinks 把已经不在画布上的节点解除关联，不动别的字段（AC8）", () => {
    const board = { shots: [shot("a"), shot("b")] };
    const linked = linkShot(board, "a", { imageNodeId: "img1" });
    expect(linked.shots[0].imageNodeId).toBe("img1");
    expect(linked.shots[1]).toBe(board.shots[1]);
    const withVideo = linkShot(linked, "a", { videoNodeId: "vid1" });
    expect(withVideo.shots[0]).toMatchObject({ imageNodeId: "img1", videoNodeId: "vid1" });
    // 图片节点被删了、视频节点还在
    const pruned = pruneShotLinks(withVideo, (id) => id === "vid1");
    expect(pruned.shots[0].imageNodeId).toBeUndefined();
    expect(pruned.shots[0].videoNodeId).toBe("vid1");
    expect(pruned.shots[0].scene).toBe("画面a");
    // 都还在：原样返回，调用方据此判断要不要写回
    expect(pruneShotLinks(withVideo, () => true)).toBe(withVideo);
  });

  test("手传一张图会解除和图片节点的关联（二选一，AC9）", () => {
    const board = linkShot({ shots: [shot("a")] }, "a", { imageNodeId: "img1" });
    const uploaded = linkShot(board, "a", { image: { assetId: "9", src: "/files/9.png" } });
    expect(uploaded.shots[0].imageNodeId).toBeUndefined();
    expect(uploaded.shots[0].image).toEqual({ assetId: "9", src: "/files/9.png" });
    // 反过来：重新用节点出图，也清掉手传的图
    const regen = linkShot(uploaded, "a", { imageNodeId: "img2" });
    expect(regen.shots[0].image).toBeUndefined();
    expect(regen.shots[0].imageNodeId).toBe("img2");
  });

  test("复制镜头：关联的图片 / 视频节点不复制，手传的图可以带过去", () => {
    const board = {
      shots: [
        shot("a", {
          imageNodeId: "img1",
          videoNodeId: "vid1",
          image: { assetId: "9", src: "/files/9.png" },
        }),
      ],
    };
    const copy = duplicateShot(board, "a", ids()).shots[1];
    expect(copy.imageNodeId).toBeUndefined();
    expect(copy.videoNodeId).toBeUndefined();
    expect(copy.image).toEqual({ assetId: "9", src: "/files/9.png" });
  });

  test("读档规整保留合法的关联字段，丢掉类型不对的", () => {
    const next = normalizeStoryboard(
      {
        shots: [
          {
            ...shot("a"),
            imageNodeId: "img1",
            videoNodeId: "vid1",
            image: { assetId: "9", src: "/f/9.png" },
          },
          { ...shot("b"), imageNodeId: 5, videoNodeId: "", image: { assetId: "", src: "x" } },
          { ...shot("c"), image: "坏数据" },
        ],
      },
      ids(),
    );
    expect(next.shots[0]).toMatchObject({
      imageNodeId: "img1",
      videoNodeId: "vid1",
      image: { assetId: "9", src: "/f/9.png" },
    });
    expect(next.shots[1].imageNodeId).toBeUndefined();
    expect(next.shots[1].videoNodeId).toBeUndefined();
    expect(next.shots[1].image).toBeUndefined();
    expect(next.shots[2].image).toBeUndefined();
  });
});

describe("新建分镜图节点的默认模型", () => {
  const models = [{ key: "i1" }, { key: "i2" }];
  test("设置里的默认模型还在清单里就用它；不在或没设置就不指定，让节点自己取第一个", () => {
    expect(pickDefaultModel("i2", models)).toBe("i2");
    expect(pickDefaultModel("gone", models)).toBeUndefined();
    expect(pickDefaultModel(undefined, models)).toBeUndefined();
    expect(pickDefaultModel("i1", [])).toBeUndefined();
  });
});

describe("分镜图上传的文件检查", () => {
  const file = (name: string, type: string, size = 1024) =>
    new File([new Uint8Array(size)], name, { type });

  test("图片可以传；别的种类给分镜图专属的提示", () => {
    expect(takeShotImageFile(file("a.png", "image/png"))).toEqual({ ok: true });
    expect(takeShotImageFile(file("a.mp4", "video/mp4"))).toEqual({
      ok: false,
      reason: "分镜图只能上传图片",
    });
    expect(takeShotImageFile(file("a.mp3", "audio/mpeg"))).toEqual({
      ok: false,
      reason: "分镜图只能上传图片",
    });
    expect(takeShotImageFile(file("a.txt", "text/plain"))).toEqual({
      ok: false,
      reason: "分镜图只能上传图片",
    });
  });

  test("超过大小上限：说明上限", () => {
    const big = file("a.png", "image/png", 200 * 1024 * 1024);
    const res = takeShotImageFile(big);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/超过 \d+MB/);
  });

  test("拖进来的一批文件里取第一张图片，别的忽略；一张图片都没有就是 null", () => {
    const list = [
      file("a.txt", "text/plain"),
      file("b.png", "image/png"),
      file("c.png", "image/png"),
    ];
    expect(firstImageFile(list)?.name).toBe("b.png");
    expect(firstImageFile([file("a.txt", "text/plain")])).toBeNull();
    expect(firstImageFile([])).toBeNull();
  });
});

describe("旧数据里手传的分镜图", () => {
  test("移除手传的图：回到空", () => {
    const board = linkShot({ shots: [shot("a")] }, "a", {
      image: { assetId: "9", src: "/f/9.png" },
    });
    expect(removeShotImage(board, "a").shots[0].image).toBeUndefined();
  });
});
