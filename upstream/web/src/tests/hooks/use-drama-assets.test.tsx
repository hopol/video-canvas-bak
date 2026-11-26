import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { useEffect } from "react";

import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { useDramaAssets as HookType } from "@/hooks/use-drama-assets";
import type { publishCanvasPatch as PublishType } from "@/utils/agent/patch-bus";
import { trackPendingSave } from "@/utils/canvas/pending-save";

/** 片场读短剧画布：后端改了画布（故事板出图、写节点）推 canvas.patch 时重读，故事板跟着更新 */

let reads = 0;
let boardSrc: string | null = null;
// bun 的 mock.module 对整个测试进程生效：带上真模块的其他导出，只换 getCanvas，别的测试文件不受影响
const realCanvasApi = { ...(await import("@/api/canvas")) };
mock.module("@/api/canvas", () => ({
  ...realCanvasApi,
  getCanvas: async () => {
    reads += 1;
    return {
      graph: {
        nodes: [
          {
            id: "b1",
            type: "canvas",
            data: {
              kind: "image",
              src: boardSrc,
              assetId: boardSrc ? "31" : undefined,
              status: boardSrc ? "done" : "running",
              drama: { episodes: [1], board: { segmentId: "s1", sourceHash: "h1" } },
            },
          },
        ],
        edges: [],
      },
    };
  },
}));

let dom: DomEnv;
let useDramaAssets: typeof HookType;
let publishCanvasPatch: typeof PublishType;
beforeAll(async () => {
  dom = await installDom();
  useDramaAssets = (await import("@/hooks/use-drama-assets")).useDramaAssets;
  publishCanvasPatch = (await import("@/utils/agent/patch-bus")).publishCanvasPatch;
});
afterAll(() => dom.restore());

const patch = (canvasId: string) =>
  ({ canvas_id: canvasId, revision_before: 1, revision_after: 2, changes: [] }) as never;

describe("useDramaAssets：后端改画布时重读", () => {
  test("本画布的 canvas.patch 触发重读，故事板换成新状态；别的画布不理", async () => {
    function Probe() {
      const { boards } = useDramaAssets("c1");
      const board = boards.get("s1");
      return (
        <span data-testid="state">{board ? `${board.status}:${board.src ?? ""}` : "none"}</span>
      );
    }
    const m = await dom.mount(<Probe />);
    await dom.flush();
    const state = () => m.container.querySelector("[data-testid=state]")?.textContent;
    expect(state()).toBe("running:");
    const before = reads;
    publishCanvasPatch(patch("other"));
    await dom.flush();
    expect(reads).toBe(before);
    boardSrc = "https://cdn/31.png";
    await dom.act(async () => publishCanvasPatch(patch("c1")));
    await dom.flush();
    expect(reads).toBe(before + 1);
    expect(state()).toBe("done:https://cdn/31.png");
    await m.unmount();
  });
});

describe("useDramaAssets：片场里的画布编辑器存盘后直接用存下的画布", () => {
  test("applyGraph 换上存下的故事板节点（在画布里点了生成 → 生成中），不再读一次画布", async () => {
    boardSrc = "https://cdn/31.png";
    const handle: { apply?: (nodes: never[]) => void } = {};
    function Probe() {
      const { boards, applyGraph } = useDramaAssets("c2");
      useEffect(() => {
        handle.apply = applyGraph as never;
      }, [applyGraph]);
      const board = boards.get("s1");
      return (
        <span data-testid="state">{board ? `${board.status}:${board.taskId ?? ""}` : "none"}</span>
      );
    }
    const m = await dom.mount(<Probe />);
    await dom.flush();
    const state = () => m.container.querySelector("[data-testid=state]")?.textContent;
    expect(state()).toBe("done:");
    const before = reads;
    await dom.act(async () =>
      handle.apply?.([
        {
          id: "b1",
          type: "canvas",
          data: {
            kind: "image",
            src: "https://cdn/31.png",
            assetId: "31",
            status: "running",
            taskId: "t9",
            drama: { episodes: [1], board: { segmentId: "s1", sourceHash: "h1" } },
          },
        },
      ] as never[]),
    );
    expect(state()).toBe("running:t9");
    expect(reads).toBe(before);
    await m.unmount();
  });
});

describe("useDramaAssets：别处的画布刚卸载、补存还没落地", () => {
  test("先等补存落地再读画布（资产管理里点了生成，马上切到片场）", async () => {
    boardSrc = "https://cdn/31.png";
    let finish!: (ok: boolean) => void;
    trackPendingSave("c3", new Promise<boolean>((resolve) => (finish = resolve)));
    const before = reads;
    function Probe() {
      useDramaAssets("c3");
      return null;
    }
    const m = await dom.mount(<Probe />);
    await dom.flush();
    expect(reads).toBe(before);
    await dom.act(async () => finish(true));
    await dom.flush();
    expect(reads).toBe(before + 1);
    await m.unmount();
  });
});
