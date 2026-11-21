import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import AssetsPage from "@/pages/assets";

const html = renderToStaticMarkup(
  <MemoryRouter initialEntries={["/assets?tab=official"]}>
    <AssetsPage />
  </MemoryRouter>,
);

describe("资产页头部", () => {
  test("标题上方的留白收紧：桌面端 20px，不再是 40px", () => {
    expect(html).toContain("md:pt-5");
    expect(html).not.toContain("md:pt-10");
  });

  test("范围页签用大一档的 track 外观", () => {
    expect(html).toContain('aria-label="资产范围"');
    expect(html).toContain("h-8!");
    expect(html).toContain("text-[14px]");
  });
});
