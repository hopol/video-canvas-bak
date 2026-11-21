import { describe, expect, test } from "bun:test";

import { gridColumns } from "@/utils/assets/grid-columns";

const SPEC = { minCell: 116, gap: 12, minColumns: 3 };

describe("gridColumns：按容器宽度算虚拟网格一行放几张", () => {
  test("宽屏按每列最小 116px、间距 12px 尽量多放（1012px 恰好放 8 列，差 1px 就是 7 列）", () => {
    expect(gridColumns(1012, SPEC)).toBe(8);
    expect(gridColumns(1011, SPEC)).toBe(7);
  });

  test("刚好放得下 N 列时取 N，差 1px 就少一列", () => {
    // 4 列需要 4×116 + 3×12 = 500
    expect(gridColumns(500, SPEC)).toBe(4);
    expect(gridColumns(499, SPEC)).toBe(3);
  });

  test("窄屏不少于 3 列，卡片跟着变窄", () => {
    expect(gridColumns(328, SPEC)).toBe(3);
    expect(gridColumns(100, SPEC)).toBe(3);
  });

  test("还没量到宽度（0、负数、NaN）时按最少列数", () => {
    expect(gridColumns(0, SPEC)).toBe(3);
    expect(gridColumns(-1, SPEC)).toBe(3);
    expect(gridColumns(Number.NaN, SPEC)).toBe(3);
  });
});
