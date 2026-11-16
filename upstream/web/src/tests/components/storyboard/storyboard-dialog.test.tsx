import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { useEffect } from "react";

import type { CanvasNode, StoryboardShot } from "@/types";
import type * as ShotsModule from "@/utils/storyboard/shots";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

/**
 * 分镜表编辑弹窗：用 jsdom 挂载真实组件，节点数据放在 ReactFlowProvider 里，
 * 检查改单元格、时长修正、行菜单增删和 50 镜时只重渲染被改的那一行（AC5、AC6、AC13）。
 */

let dom: DomEnv;
let shotsModule: typeof ShotsModule;
let Harness: (props: { shots: StoryboardShot[] }) => React.ReactElement;
/** 测试里读节点最新的镜头 */
let latest: () => StoryboardShot[];

beforeAll(async () => {
  dom = await installDom();
  const { ReactFlowProvider, useNodes, useStoreApi } = await import("@xyflow/react");
  const { StoryboardDialog } = await import("@/components/storyboard/storyboard-dialog");
  shotsModule = await import("@/utils/storyboard/shots");
  // Body 每次提交后把节点最新的镜头放进来，测试里读它
  const seen: { shots: StoryboardShot[] } = { shots: [] };
  latest = () => seen.shots;

  function Body() {
    // 只有 Provider 没有 <ReactFlow> 时，store 默认不收节点改动；按画布里非受控的方式打开
    const store = useStoreApi<CanvasNode>();
    if (!store.getState().hasDefaultNodes) store.setState({ hasDefaultNodes: true });
    const node = useNodes<CanvasNode>()[0];
    const board = node.data.storyboard ?? { shots: [] };
    useEffect(() => {
      seen.shots = board.shots;
    });
    return (
      <StoryboardDialog
        id={node.id}
        label={node.data.label}
        board={board}
        open
        focusShotId={null}
        onOpenChange={() => {}}
      />
    );
  }
  Harness = ({ shots }) => (
    <ReactFlowProvider
      initialNodes={[
        {
          id: "sb1",
          type: "canvas",
          position: { x: 0, y: 0 },
          data: { kind: "storyboard", label: "分镜表", storyboard: { shots } },
        },
      ]}
    >
      <Body />
    </ReactFlowProvider>
  );
});
afterAll(() => dom.restore());

const makeShots = (n: number): StoryboardShot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    scene: `画面${i + 1}`,
    shot: "中景",
    camera: "固定",
    action: "",
    dialogue: "",
    duration: 3,
  }));

const body = () => dom.win.document.body;
const all = (selector: string) => Array.from(body().querySelectorAll<HTMLElement>(selector));
const byLabel = (label: string) => body().querySelector<HTMLElement>(`[aria-label="${label}"]`);
const buttonByText = (text: string) =>
  all("button").find((b) => b.textContent?.trim() === text) ?? null;
const blur = (el: HTMLElement | null) =>
  dom.act(async () => {
    el?.dispatchEvent(new dom.win.FocusEvent("focusout", { bubbles: true }));
    el?.dispatchEvent(new dom.win.FocusEvent("blur"));
  });

describe("分镜表编辑弹窗", () => {
  test("50 镜：表头统计、镜号从 01 连续到 50", async () => {
    const m = await dom.mount(<Harness shots={makeShots(50)} />);
    await dom.flush();
    expect(body().textContent).toContain("50 镜 · 02:30");
    expect(all('[aria-label$="的画面描述"]')).toHaveLength(50);
    expect(byLabel("第 50 镜的画面描述")).not.toBeNull();
    await m.unmount();
  });

  test("50 镜时改一格只重渲染那一行，别的行跳过（AC13）", async () => {
    const m = await dom.mount(<Harness shots={makeShots(50)} />);
    await dom.flush();
    // 每渲染一行调一次 formatShotNumber，拿它数行的渲染次数
    const spy = spyOn(shotsModule, "formatShotNumber");
    const cell = byLabel("第 3 镜的画面描述");
    await dom.type(cell, "新的画面");
    await blur(cell);
    await dom.flush();
    expect(latest()[2].scene).toBe("新的画面");
    expect(latest()[0]).toEqual(makeShots(1)[0]);
    // 只有第 3 镜重渲染：恰好 1 次（为 0 说明计数没生效，大于 1 说明别的行没跳过）
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
    await m.unmount();
  });

  test("打字时不写节点，失焦才写回", async () => {
    const m = await dom.mount(<Harness shots={makeShots(2)} />);
    await dom.flush();
    const cell = byLabel("第 1 镜的对白");
    await dom.type(cell, "你好");
    expect(latest()[0].dialogue).toBe("");
    await blur(cell);
    expect(latest()[0].dialogue).toBe("你好");
    await m.unmount();
  });

  test("时长越界失焦后修正到 60 并闪黄框；非数字恢复原值（AC5）", async () => {
    const m = await dom.mount(<Harness shots={makeShots(2)} />);
    await dom.flush();
    const input = all('input[aria-label="时长（秒）"]')[0] as HTMLInputElement;
    await dom.type(input, "75");
    await blur(input);
    expect(latest()[0].duration).toBe(60);
    expect(input.value).toBe("60");
    expect(input.parentElement?.className).toContain("ring-amber-500/60");
    await dom.flush(350);
    expect(input.parentElement?.className).not.toContain("ring-amber-500/60");

    await dom.type(input, "abc");
    await blur(input);
    expect(input.value).toBe("60");
    expect(latest()[0].duration).toBe(60);
    expect(body().textContent).toContain("2 镜 · 01:03");
    await m.unmount();
  });

  test("景别、运镜是下拉，不能自由输入（AC5）", async () => {
    const m = await dom.mount(<Harness shots={makeShots(1)} />);
    await dom.flush();
    for (const label of ["景别", "运镜"]) {
      const trigger = all(`[aria-label="${label}"]`)[0];
      expect(trigger.tagName).not.toBe("INPUT");
      expect(trigger.tagName).not.toBe("TEXTAREA");
    }
    expect(all('[aria-label="景别"]')[0].textContent).toContain("中景");
    expect(all('[aria-label="运镜"]')[0].textContent).toContain("固定");
    await m.unmount();
  });

  test("添加镜头：末尾加一行，镜号接着排、总时长跟着变（AC6）", async () => {
    const m = await dom.mount(<Harness shots={makeShots(2)} />);
    await dom.flush();
    await dom.click(buttonByText("添加镜头"));
    await dom.flush();
    expect(latest()).toHaveLength(3);
    expect(latest()[2]).toMatchObject({ shot: "中景", camera: "固定", duration: 3 });
    expect(byLabel("第 3 镜的画面描述")).not.toBeNull();
    expect(body().textContent).toContain("3 镜 · 00:09");
    await m.unmount();
  });

  test("行菜单删除要二次确认，删后镜号重排（AC6）", async () => {
    const m = await dom.mount(<Harness shots={makeShots(3)} />);
    await dom.flush();
    await dom.click(byLabel("第 2 镜的操作"));
    await dom.flush();
    await dom.click(buttonByText("删除镜头"));
    await dom.flush();
    expect(body().textContent).toContain("删除第 2 镜？");
    expect(latest()).toHaveLength(3);
    await dom.click(buttonByText("删除"));
    await dom.flush();
    expect(latest().map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(byLabel("第 3 镜的画面描述")).toBeNull();
    expect((byLabel("第 2 镜的画面描述") as HTMLTextAreaElement).value).toBe("画面3");
    await m.unmount();
  });

  test("行菜单插入、复制", async () => {
    const m = await dom.mount(<Harness shots={makeShots(2)} />);
    await dom.flush();
    await dom.click(byLabel("第 1 镜的操作"));
    await dom.flush();
    await dom.click(buttonByText("复制镜头"));
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["画面1", "画面1", "画面2"]);
    await dom.click(byLabel("第 3 镜的操作"));
    await dom.flush();
    await dom.click(buttonByText("在上方插入"));
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["画面1", "画面1", "", "画面2"]);
    await m.unmount();
  });

  test("没有镜头时显示空状态，点添加镜头加第 1 行", async () => {
    const m = await dom.mount(<Harness shots={[]} />);
    await dom.flush();
    expect(body().textContent).toContain("还没有镜头");
    await dom.click(buttonByText("添加镜头"));
    await dom.flush();
    expect(latest()).toHaveLength(1);
    expect(byLabel("第 1 镜的画面描述")).not.toBeNull();
    await m.unmount();
  });
});
