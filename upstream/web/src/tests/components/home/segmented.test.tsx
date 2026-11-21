import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Segmented } from "@/components/home/segmented";

const options = [
  { value: "a", label: "生成历史" },
  { value: "b", label: "音色库" },
];

const render = (size?: "sm" | "md") =>
  renderToStaticMarkup(
    <Segmented variant="track" size={size} value="a" onChange={() => {}} options={options} />,
  );

describe("分段控件 track 外观", () => {
  test("默认档不变（个人中心在用）：按钮 h-7、字 13px", () => {
    const html = render();
    expect(html).toContain("h-7!");
    expect(html).toContain("text-[13px]");
    expect(html).not.toContain("h-8!");
  });

  test("md 档比默认大一点：按钮 h-8、字 14px、左右留白 16px，轨道内边距不变", () => {
    const html = render("md");
    expect(html).toContain("h-8!");
    expect(html).toContain("text-[14px]");
    expect(html).toContain("px-4");
    expect(html).toContain("p-[3px]");
    expect(html).not.toContain("h-7!");
  });
});
