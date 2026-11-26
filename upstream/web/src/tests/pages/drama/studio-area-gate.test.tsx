import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import type { EpisodeSummary } from "@/api/drama/type";
import type { StudioArea as StudioAreaType } from "@/pages/drama/workspace/studio-area";
import type { DramaWorkspace } from "@/pages/drama/workspace/use-workspace";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

/**
 * 片场的「还没拆解」引导：「去拆解」直接打开拆解弹窗（和总览、剧本、资产管理一致），
 * 不是跳到剧本页；剧本还没写好时才去剧本页。
 */

mock.module("@/hooks/use-drama-video-model", () => ({
  useDramaVideoModel: () => ({
    models: [],
    status: "ready",
    model: undefined,
    setModel: () => {},
    storyboard: { maxSeconds: 15 },
  }),
}));

let dom: DomEnv;
let StudioArea: typeof StudioAreaType;
let Context: typeof import("@/pages/drama/workspace/context").DramaWorkspaceContext;
beforeAll(async () => {
  dom = await installDom();
  StudioArea = (await import("@/pages/drama/workspace/studio-area")).StudioArea;
  Context = (await import("@/pages/drama/workspace/context")).DramaWorkspaceContext;
  // 片场模块连带 Tiptap 编辑器等，首次导入较慢
}, 60_000);
afterAll(() => dom?.restore());

const episode = (patch: Partial<EpisodeSummary>) =>
  ({
    no: 1,
    title: "初见",
    locked: false,
    scriptStatus: "ready",
    storyboardStatus: "empty",
    ...patch,
  }) as EpisodeSummary;

async function renderGate(ep: EpisodeSummary) {
  const went: Array<[string, number | undefined]> = [];
  let opened = 0;
  const view = await dom.mount(
    <Context.Provider
      value={
        {
          drama: { id: "d1", videoModel: "", episodes: [ep] },
          jobs: [],
          refresh: async () => {},
        } as unknown as DramaWorkspace
      }
    >
      <StudioArea
        ep={1}
        onGo={(stage, no) => went.push([stage, no])}
        onBreakdownOpen={() => (opened += 1)}
      />
    </Context.Provider>,
  );
  const button = [...view.container.querySelectorAll("button")].find((b) =>
    /去拆解|去写剧本/.test(b.textContent ?? ""),
  );
  await dom.click(button);
  await view.unmount();
  return { went, opened, label: button?.textContent };
}

describe("片场：还没拆解资产时的引导", () => {
  test("剧本已写好：「去拆解」打开拆解弹窗，不跳页", async () => {
    const { went, opened, label } = await renderGate(episode({ scriptStatus: "ready" }));
    expect(label).toContain("去拆解");
    expect(opened).toBe(1);
    expect(went).toEqual([]);
  });

  test("剧本还没写好：「去写剧本」跳到这一集的剧本页", async () => {
    const { went, opened, label } = await renderGate(episode({ scriptStatus: "empty" }));
    expect(label).toContain("去写剧本");
    expect(opened).toBe(0);
    expect(went).toEqual([["script", 1]]);
  });
});

describe("片场：还没有分镜时可以批量生成脚本", () => {
  test("已拆解没分镜：右上角工具条里有「批量生成脚本」，点开选集弹窗并预选当前集", async () => {
    const view = await dom.mount(
      <Context.Provider
        value={
          {
            drama: {
              id: "d1",
              videoModel: "",
              episodes: [episode({ locked: true, segmentCount: 0, doneSegmentCount: 0 })],
            },
            jobs: [],
            refresh: async () => {},
          } as unknown as DramaWorkspace
        }
      >
        <StudioArea ep={1} onGo={() => {}} onBreakdownOpen={() => {}} />
      </Context.Provider>,
    );
    const batch = [...view.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "批量生成脚本",
    );
    expect(batch).toBeDefined();
    await dom.click(batch);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("批量生成分镜脚本");
    expect(
      dialog?.querySelector('[data-slot="episode-grid"] button[aria-pressed="true"]'),
    ).not.toBeNull();
    await view.unmount();
  });
});

describe("片场：这一集正在拆解时", () => {
  test("片场锁住：不给「去拆解」、不显示进度，只给「去资产管理」看进度", async () => {
    const went: Array<[string, number | undefined]> = [];
    const view = await dom.mount(
      <Context.Provider
        value={
          {
            drama: { id: "d1", videoModel: "", episodes: [episode({ scriptStatus: "ready" })] },
            jobs: [
              {
                id: "b1",
                step: "breakdown",
                episodes: [1, 2],
                status: "running",
                progress: 30,
                lane: "user",
                createdAt: "2026-11-16T10:00:00Z",
              },
            ],
            refresh: async () => {},
          } as unknown as DramaWorkspace
        }
      >
        <StudioArea
          ep={1}
          onGo={(stage, no) => went.push([stage, no])}
          onBreakdownOpen={() => {}}
        />
      </Context.Provider>,
    );
    const text = view.container.textContent ?? "";
    expect(text).toContain("第 1 集的资产还在拆解");
    expect(text).not.toContain("30%");
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    expect(text).not.toContain("取消");
    expect(text).not.toContain("去拆解");
    const go = [...view.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("去资产管理"),
    );
    await dom.click(go);
    expect(went).toEqual([["assets", 1]]);
    // 空状态的工具条里同样有「批量生成脚本」，位置和片场顶栏一致
    expect(text).toContain("批量生成脚本");
    await view.unmount();
  });
});
