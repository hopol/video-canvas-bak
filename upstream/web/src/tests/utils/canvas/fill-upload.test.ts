import { describe, expect, test } from "bun:test";

import type { CanvasNodeData } from "@/types";
import {
  canFillNode,
  canReplaceImage,
  fillAccept,
  fillAssetPatch,
  fillStartPatch,
  planFileDrop,
  replaceImagePatch,
  takeFillFile,
} from "@/utils/canvas/fill-upload";

const data = (patch: Partial<CanvasNodeData>): CanvasNodeData =>
  ({ kind: "image", label: "图片", ...patch }) as CanvasNodeData;

const file = (type: string, size = 10) =>
  new File([new Uint8Array(size)], "a.bin", { type }) as File;

describe("canFillNode：只有空节点能往里上传", () => {
  test.each(["image", "video", "audio", "character"] as const)("空的 %s 节点可以上传", (kind) => {
    expect(canFillNode(data({ kind }))).toBe(true);
  });

  test("生成失败、还没有素材的节点也算空节点", () => {
    expect(canFillNode(data({ status: "error", error: "额度不足", taskId: "9" }))).toBe(true);
  });

  test("已经有素材、有生成历史或正在生成的都不行", () => {
    expect(canFillNode(data({ src: "https://cdn/a.png", status: "done" }))).toBe(false);
    expect(canFillNode(data({ assetId: "a1" }))).toBe(false);
    expect(canFillNode(data({ outputs: [{ id: "o1", src: "https://cdn/a.png" }] as never }))).toBe(
      false,
    );
    expect(canFillNode(data({ status: "running", taskId: "1" }))).toBe(false);
    // 角色卡上传期间只有进度、没有 running，也不能再传一次
    expect(canFillNode(data({ kind: "character", uploadProgress: 20 }))).toBe(false);
  });

  test("文本、分镜表、导演台不收文件", () => {
    expect(canFillNode(data({ kind: "script" }))).toBe(false);
    expect(canFillNode(data({ kind: "storyboard" }))).toBe(false);
    expect(canFillNode(data({ kind: "director" }))).toBe(false);
  });
});

describe("takeFillFile：文件种类要和节点对上", () => {
  test("图片节点收图片，角色卡收图片，视频 / 音频节点各收各的", () => {
    expect(takeFillFile("image", file("image/png"))).toEqual({ mediaType: "image" });
    expect(takeFillFile("character", file("image/jpeg"))).toEqual({ mediaType: "image" });
    expect(takeFillFile("video", file("video/mp4"))).toEqual({ mediaType: "video" });
    expect(takeFillFile("audio", file("audio/mpeg"))).toEqual({ mediaType: "audio" });
  });

  test("种类对不上时给一句能直接看的原因", () => {
    expect(takeFillFile("image", file("video/mp4"))).toEqual({ error: "这个节点只收图片" });
    expect(takeFillFile("character", file("audio/mpeg"))).toEqual({ error: "这个节点只收图片" });
    expect(takeFillFile("audio", file("image/png"))).toEqual({ error: "这个节点只收音频" });
  });

  test("超过大小上限的沿用画布上传的提示", () => {
    const out = takeFillFile("image", file("image/png", 21 * 1024 * 1024));
    expect("error" in out && out.error).toContain("20MB");
  });

  test("文件框只列节点收的种类", () => {
    expect(fillAccept("character")).toBe("image/*");
    expect(fillAccept("image")).toBe("image/*");
    expect(fillAccept("video")).toBe("video/*");
    expect(fillAccept("audio")).toBe("audio/*");
  });
});

describe("fillStartPatch / fillAssetPatch：媒体节点变成上传节点", () => {
  test("开始上传：标成上传素材，清掉失败的生成残留，进度从 0 开始", () => {
    expect(fillStartPatch(new File(["x"], "茶馆.png", { type: "image/png" }), "image")).toEqual({
      uploaded: true,
      fileName: "茶馆.png",
      mediaType: "image",
      status: "running",
      uploadProgress: 0,
      error: null,
      taskId: undefined,
      pendingTaskIds: undefined,
    });
  });

  test("从素材库选：直接是完成的上传素材，不再上传", () => {
    expect(
      fillAssetPatch({
        id: "a1",
        url: "https://cdn/a.png",
        kind: "image",
        fileName: "a.png",
      } as never),
    ).toEqual({
      uploaded: true,
      src: "https://cdn/a.png",
      assetId: "a1",
      mediaType: "image",
      fileName: "a.png",
      status: "done",
      error: null,
      taskId: undefined,
      pendingTaskIds: undefined,
    });
  });
});

describe("canReplaceImage：已有主图的图片节点能从资产库换图", () => {
  const done = { src: "https://cdn/a.png", assetId: "a1", status: "done" } as const;

  test("有已存下来的主图、没在生成的图片节点可以换", () => {
    expect(canReplaceImage(data(done))).toBe(true);
    expect(canReplaceImage(data({ ...done, uploaded: true }))).toBe(true);
  });

  test("空节点走「素材库」填充，不走换图", () => {
    expect(canReplaceImage(data({}))).toBe(false);
  });

  test("生成中、上传中、本地 blob 还没传完的不能换", () => {
    expect(canReplaceImage(data({ ...done, status: "running" }))).toBe(false);
    expect(canReplaceImage(data({ ...done, pendingTaskIds: ["2"] }))).toBe(false);
    expect(canReplaceImage(data({ ...done, uploadProgress: 30 }))).toBe(false);
    expect(canReplaceImage(data({ src: "blob:http://x/1", status: "done" }))).toBe(false);
  });

  test("只有图片节点：视频、音频、角色卡、文本都不收", () => {
    for (const kind of ["video", "audio", "character", "script", "storyboard"] as const) {
      expect(canReplaceImage(data({ ...done, kind }))).toBe(false);
    }
  });
});

describe("replaceImagePatch：换成资产库里的图", () => {
  const asset = {
    id: "a2",
    url: "https://cdn/b.png",
    kind: "image",
    fileName: "b.png",
    width: 800,
    height: 400,
  } as never;

  test("新图成为当前主图，旧图留在历史里", () => {
    const patch = replaceImagePatch(
      data({ src: "https://cdn/a.png", assetId: "a1", status: "done", model: "m1" }),
      asset,
      1000,
    );
    expect(patch).toMatchObject({
      src: "https://cdn/b.png",
      assetId: "a2",
      mediaType: "image",
      activeOutputId: "a2",
      mediaAspect: 2,
      status: "done",
      error: null,
    });
    expect(patch.outputs?.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(patch.outputs?.[1]).toMatchObject({
      assetId: "a2",
      src: "https://cdn/b.png",
      createdAt: 1000,
    });
  });

  test("生成的节点换图后仍是生成节点（不标 uploaded），生成面板和提示词不丢", () => {
    const patch = replaceImagePatch(
      data({ src: "https://cdn/a.png", assetId: "a1", status: "done", taskId: "7" }),
      asset,
      1,
    );
    expect("uploaded" in patch).toBe(false);
    expect("prompt" in patch).toBe(false);
  });

  test("上传的节点同步文件名，下载名不再是旧图的", () => {
    const patch = replaceImagePatch(
      data({
        src: "https://cdn/a.png",
        assetId: "a1",
        status: "done",
        uploaded: true,
        fileName: "a.png",
      }),
      asset,
      1,
    );
    expect(patch.fileName).toBe("b.png");
  });

  test("素材没有宽高时不写 mediaAspect；换成已在历史里的同一张只切过去", () => {
    const noSize = replaceImagePatch(
      data({ src: "https://cdn/a.png", assetId: "a1", status: "done" }),
      { id: "a2", url: "https://cdn/b.png", kind: "image", width: null, height: null } as never,
      1,
    );
    expect("mediaAspect" in noSize).toBe(false);
    const again = replaceImagePatch(
      data({
        src: "https://cdn/b.png",
        assetId: "a2",
        status: "done",
        outputs: [
          { id: "a1", src: "https://cdn/a.png", mediaType: "image", assetId: "a1", createdAt: 1 },
          { id: "a2", src: "https://cdn/b.png", mediaType: "image", assetId: "a2", createdAt: 2 },
        ],
      }),
      asset,
      3,
    );
    expect(again.outputs).toHaveLength(2);
  });
});

describe("planFileDrop：文件拖到哪里", () => {
  const files = (n: number) => Array.from({ length: n }, () => file("image/png"));

  test("一个文件拖到空节点上：放进这个节点", () => {
    expect(planFileDrop(files(1), { id: "n1", data: data({}) })).toEqual({
      mode: "fill",
      id: "n1",
    });
  });

  test("拖到空白处、拖到有素材的节点上、或一次拖了好几个：都按新建节点处理", () => {
    expect(planFileDrop(files(1), null)).toEqual({ mode: "create" });
    expect(planFileDrop(files(1), { id: "n1", data: data({ src: "https://cdn/a.png" }) })).toEqual({
      mode: "create",
    });
    expect(planFileDrop(files(2), { id: "n1", data: data({}) })).toEqual({ mode: "create" });
  });
});
