import { describe, expect, test } from "bun:test";

import type { StoryboardShot } from "@/types";
import {
  addShot,
  applyOrder,
  clampDuration,
  duplicateShot,
  emptyStoryboard,
  commitDuration,
  formatDuration,
  formatShotNumber,
  insertShot,
  moveShot,
  normalizeStoryboard,
  removeShot,
  shotNumbers,
  stepDuration,
  storyboardCardView,
  totalDuration,
  updateShot,
} from "@/utils/storyboard/shots";

const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};

const shot = (id: string, patch: Partial<StoryboardShot> = {}): StoryboardShot => ({
  id,
  scene: `画面${id}`,
  shot: "",
  camera: "",
  action: "",
  dialogue: "",
  duration: 3,
  ...patch,
});

const board = (...list: StoryboardShot[]) => ({ shots: list });

describe("新建与增删", () => {
  test("新建的分镜表没有镜头", () => {
    expect(emptyStoryboard()).toEqual({ shots: [] });
  });

  test("末尾新增一行：默认中景、固定、3 秒，文本为空", () => {
    const next = addShot(board(shot("a")), ids());
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1"]);
    expect(next.shots[1]).toEqual({
      id: "s1",
      scene: "",
      shot: "中景",
      camera: "固定",
      action: "",
      dialogue: "",
      duration: 3,
    });
  });

  test("在某行上方、下方插入", () => {
    const start = board(shot("a"), shot("b"));
    expect(insertShot(start, "b", "before", ids()).shots.map((s) => s.id)).toEqual([
      "a",
      "s1",
      "b",
    ]);
    expect(insertShot(start, "a", "after", ids()).shots.map((s) => s.id)).toEqual(["a", "s1", "b"]);
  });

  test("插入的参照行不存在时加到末尾", () => {
    expect(insertShot(board(shot("a")), "x", "before", ids()).shots.map((s) => s.id)).toEqual([
      "a",
      "s1",
    ]);
  });

  test("复制一行：内容相同、换新 id、紧跟在原行后面", () => {
    const next = duplicateShot(
      board(shot("a", { shot: "特写", duration: 4.5 }), shot("b")),
      "a",
      ids(),
    );
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1", "b"]);
    expect(next.shots[1]).toEqual({ ...shot("a", { shot: "特写", duration: 4.5 }), id: "s1" });
  });

  test("删除一行，找不到时原样返回", () => {
    const start = board(shot("a"), shot("b"));
    expect(removeShot(start, "a").shots.map((s) => s.id)).toEqual(["b"]);
    expect(removeShot(start, "x")).toBe(start);
  });

  test("改一行的字段，时长越界时修正到边界", () => {
    const start = board(shot("a"), shot("b"));
    const next = updateShot(start, "b", { camera: "推", duration: 99 });
    expect(next.shots[1]).toMatchObject({ camera: "推", duration: 60 });
    expect(next.shots[0]).toBe(start.shots[0]);
  });
});

describe("拖拽排序与镜号", () => {
  test("把第 1 行拖到第 3 行的位置", () => {
    const next = moveShot(board(shot("a"), shot("b"), shot("c")), "a", 2);
    expect(next.shots.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("目标位置越界时夹到两端", () => {
    const start = board(shot("a"), shot("b"), shot("c"));
    expect(moveShot(start, "c", -5).shots.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(moveShot(start, "a", 99).shots.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("拖拽松手按拖出的顺序重排，行内容取最新的", () => {
    const start = board(shot("a"), shot("b", { scene: "新" }), shot("c"));
    const next = applyOrder(start, ["c", "a", "b"]);
    expect(next.shots.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(next.shots[2].scene).toBe("新");
  });

  test("拖拽期间新加的行放到末尾；顺序没变时原样返回", () => {
    const start = board(shot("a"), shot("b"), shot("n"));
    expect(applyOrder(start, ["b", "a"]).shots.map((s) => s.id)).toEqual(["b", "a", "n"]);
    expect(applyOrder(start, ["a", "b", "n"])).toBe(start);
  });

  test("镜号按行序从 1 连续编号，增删排序后重排", () => {
    let next = board(shot("a"), shot("b"), shot("c"));
    next = removeShot(next, "b");
    next = addShot(next, ids());
    next = moveShot(next, "s1", 0);
    expect(shotNumbers(next)).toEqual({ s1: 1, a: 2, c: 3 });
  });
});

describe("时长", () => {
  test("时长限制在 1–60 秒、保留 1 位小数，非数字取默认值", () => {
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(61)).toBe(60);
    expect(clampDuration(2.46)).toBe(2.5);
    expect(clampDuration(Number.NaN)).toBe(3);
    expect(clampDuration("5" as unknown)).toBe(3);
  });

  test("总时长实时累加，没有浮点误差", () => {
    expect(
      totalDuration(board(shot("a", { duration: 0.1 * 3 }), shot("b", { duration: 2.7 }))),
    ).toBe(3);
    expect(totalDuration(board(shot("a", { duration: 1.1 }), shot("b", { duration: 2.2 })))).toBe(
      3.3,
    );
    expect(totalDuration(emptyStoryboard())).toBe(0);
  });

  test("总时长显示成 mm:ss，按整秒四舍五入", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3.3)).toBe("00:03");
    expect(formatDuration(84.5)).toBe("01:25");
    expect(formatDuration(3600)).toBe("60:00");
  });
});

describe("读档规整", () => {
  test("结构不对时读成空表", () => {
    expect(normalizeStoryboard(undefined, ids())).toEqual({ shots: [] });
    expect(normalizeStoryboard({ shots: "x" }, ids())).toEqual({ shots: [] });
  });

  test("不认识的景别、运镜清空，时长修正，缺字段补默认，缺 id 补新 id", () => {
    const raw = {
      shots: [
        { id: "a", scene: "开门", shot: "超大特写", camera: "推", duration: 120, extra: 1 },
        { scene: 5, dialogue: "你好", duration: "x" },
        "坏数据",
      ],
    };
    expect(normalizeStoryboard(raw, ids())).toEqual({
      shots: [
        {
          id: "a",
          scene: "开门",
          shot: "",
          camera: "推",
          action: "",
          dialogue: "",
          duration: 60,
        },
        { id: "s1", scene: "", shot: "", camera: "", action: "", dialogue: "你好", duration: 3 },
      ],
    });
  });

  test("重复的 id 换成新的，镜号不会错位", () => {
    const next = normalizeStoryboard({ shots: [shot("a"), shot("a")] }, ids());
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1"]);
  });
});

describe("时长输入框", () => {
  test("失焦提交：范围内原样，越界修正并标记，小数保留 1 位", () => {
    expect(commitDuration("4.5", 3)).toEqual({ value: 4.5, corrected: false });
    expect(commitDuration(" 0.2 ", 3)).toEqual({ value: 1, corrected: true });
    expect(commitDuration("75", 3)).toEqual({ value: 60, corrected: true });
    expect(commitDuration("2.46", 3)).toEqual({ value: 2.5, corrected: true });
  });

  test("空或非数字恢复原值，不算修正", () => {
    expect(commitDuration("", 4)).toEqual({ value: 4, corrected: false });
    expect(commitDuration("abc", 4)).toEqual({ value: 4, corrected: false });
  });

  test("上下键每次 ±0.5 秒，不越界", () => {
    expect(stepDuration(3, 1)).toBe(3.5);
    expect(stepDuration(1.2, -1)).toBe(1);
    expect(stepDuration(59.8, 1)).toBe(60);
  });
});

describe("节点卡片", () => {
  test("镜号补成两位", () => {
    expect(formatShotNumber(1)).toBe("01");
    expect(formatShotNumber(12)).toBe("12");
    expect(formatShotNumber(120)).toBe("120");
  });

  test("缩略图取前 5 镜、多出来的计数；摘要取前 5 镜、剩下的计数", () => {
    const list = Array.from({ length: 8 }, (_, i) => shot(`r${i}`));
    const view = storyboardCardView(board(...list));
    expect(view.thumbs.map((t) => t.number)).toEqual([1, 2, 3, 4, 5]);
    expect(view.thumbs[0].shot).toBe(list[0]);
    expect(view.moreThumbs).toBe(3);
    expect(view.summary.map((t) => t.number)).toEqual([1, 2, 3, 4, 5]);
    expect(view.moreSummary).toBe(3);
  });

  test("镜头少时不出溢出计数", () => {
    const view = storyboardCardView(board(shot("a"), shot("b")));
    expect(view.thumbs).toHaveLength(2);
    expect(view.moreThumbs).toBe(0);
    expect(view.summary).toHaveLength(2);
    expect(view.moreSummary).toBe(0);
  });
});
