import { describe, expect, test } from "bun:test";

import { isBlankCanvas } from "@/utils/canvas/blank-canvas";

/** 只用到 closest / contains，拿假对象代替真实 DOM */
const target = (hit: string | null) =>
  ({ closest: (selector: string) => (hit && selector.includes(hit) ? {} : null) }) as never;
const root = (inside: boolean) => ({ contains: () => inside }) as never;

describe("isBlankCanvas：双击 / 按下是不是落在画布空白处", () => {
  test("画布里的空白处算", () => {
    expect(isBlankCanvas(target(null), root(true))).toBe(true);
  });

  test("落在节点、连线、面板上不算", () => {
    expect(isBlankCanvas(target(".react-flow__node"), root(true))).toBe(false);
    expect(isBlankCanvas(target(".react-flow__edge"), root(true))).toBe(false);
  });

  test("节点里弹出的弹框（portal 到画布外）上的事件会经 React 冒泡上来，不算空白", () => {
    expect(isBlankCanvas(target(null), root(false))).toBe(false);
  });
});
