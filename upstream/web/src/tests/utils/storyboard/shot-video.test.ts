import { describe, expect, test } from "bun:test";

import { shotVideoState } from "@/utils/storyboard/shot-video";
import type { VideoNodeView } from "@/utils/tasks/node-view";

const view = (v: VideoNodeView) => ({ exists: true as const, view: v });

describe("视频格的状态（设计 §6.6 的四种）", () => {
  test("没建视频节点：未建，显示「生成视频」按钮", () => {
    expect(shotVideoState(undefined, undefined)).toEqual({ kind: "none" });
  });

  test("关联的视频节点已经被删：回到未建（实时恢复，不用重开弹窗）", () => {
    expect(shotVideoState("v1", { exists: false })).toEqual({ kind: "none" });
  });

  test("节点建好、还没生成（视频不自动开始）：未生成，能去节点上确认参数再生成", () => {
    expect(shotVideoState("v1", view({ phase: "idle" }))).toEqual({ kind: "idle" });
  });

  test("排队中和生成中都显示生成中，带进度；即将完成没有进度", () => {
    expect(shotVideoState("v1", view({ phase: "queued" }))).toEqual({
      kind: "running",
      progress: null,
    });
    expect(shotVideoState("v1", view({ phase: "running", elapsedMs: 5000, progress: 42 }))).toEqual(
      { kind: "running", progress: 42 },
    );
    expect(shotVideoState("v1", view({ phase: "finalizing" }))).toEqual({
      kind: "running",
      progress: null,
    });
  });

  test("已完成：带视频地址，点了能播放", () => {
    expect(shotVideoState("v1", view({ phase: "done", src: "/f/v.mp4" }))).toEqual({
      kind: "done",
      src: "/f/v.mp4",
    });
  });

  test("失败：带原因，去处理", () => {
    expect(
      shotVideoState(
        "v1",
        view({ phase: "failed", message: "模型超时", refunded: true, taskRef: null }),
      ),
    ).toEqual({ kind: "failed", message: "模型超时" });
  });

  test("上传中的视频节点（本地传视频进来）按未生成处理", () => {
    expect(shotVideoState("v1", view({ phase: "uploading", progress: 10 }))).toEqual({
      kind: "idle",
    });
  });
});
