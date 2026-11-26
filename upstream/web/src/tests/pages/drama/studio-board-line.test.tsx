import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { BoardLinePreview as BoardLinePreviewType } from "@/pages/drama/studio/prompt-pane";
import type { Studio, StudioContext as StudioContextType } from "@/pages/drama/studio/use-studio";

/**
 * 提示词框顶部的故事板说明：带入故事板时，把生成时加在提示词最前面的那行原样亮出来，
 * 灰色、不可编辑，默认收成一行；没带入（关掉 / 模型不收 / 没有故事板）就不显示。
 */

let dom: DomEnv;
let BoardLinePreview: typeof BoardLinePreviewType;
let StudioContext: typeof StudioContextType;
beforeAll(async () => {
  dom = await installDom();
  BoardLinePreview = (await import("@/pages/drama/studio/prompt-pane")).BoardLinePreview;
  StudioContext = (await import("@/pages/drama/studio/use-studio")).StudioContext;
});
afterAll(() => dom.restore());

const LINE = "图片1是本段的分镜宫格图，按从左到右、从上到下的编号顺序……";

const mount = (boardLine: string | null) =>
  dom.mount(
    <StudioContext.Provider
      value={{ plan: boardLine === null ? null : { boardLine } } as unknown as Studio}
    >
      <BoardLinePreview />
    </StudioContext.Provider>,
  );

describe("片场：故事板说明预览", () => {
  test("带入故事板：显示生成时加在最前面的说明原文，点一下展开 / 收起", async () => {
    const m = await mount(LINE);
    const box = m.container.querySelector("[aria-label='故事板说明']") as HTMLButtonElement;
    expect(box).toBeTruthy();
    expect(box.textContent).toContain(LINE);
    expect(box.getAttribute("aria-expanded")).toBe("false");
    // 收起时只露一行
    expect(box.querySelector(".line-clamp-1")).toBeTruthy();
    await dom.click(box);
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.querySelector(".line-clamp-1")).toBeNull();
    await m.unmount();
  });

  test("没带入故事板或还没算出计划：不显示", async () => {
    for (const value of ["", null]) {
      const m = await mount(value);
      expect(m.container.querySelector("[aria-label='故事板说明']")).toBeNull();
      await m.unmount();
    }
  });
});
