/** 虚拟网格的列规格 */
export interface GridColumnSpec {
  /** 每列最小宽度（px） */
  minCell: number;
  /** 列间距（px） */
  gap: number;
  /** 最少列数，窄屏时卡片宁可变窄也不少于它 */
  minColumns: number;
}

/**
 * 按容器宽度算一行放几张，等价于 CSS 的 `repeat(auto-fill, minmax(minCell, 1fr))`，再加一个列数下限。
 * 虚拟列表要自己分行，所以不能交给 CSS 网格去排。
 * @param width 容器宽度；还没量到（0、负数、NaN）时按最少列数
 * @param spec 列规格
 */
export function gridColumns(width: number, { minCell, gap, minColumns }: GridColumnSpec): number {
  if (!(width > 0)) return minColumns;
  return Math.max(minColumns, Math.floor((width + gap) / (minCell + gap)));
}
