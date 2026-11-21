import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OfficialView } from "@/pages/assets/official-view";

describe("资产页「音色库」的筛选条", () => {
  const html = renderToStaticMarkup(<OfficialView />);

  test("语言、人群和「生成历史」一样是下拉胶囊，不再平铺选项按钮", () => {
    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('aria-label="人群"');
    // 平铺的选项按钮带 aria-pressed；下拉里的选项要点开才渲染
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("男孩");
  });

  test("右侧保留搜索框", () => {
    expect(html).toContain("搜索音色名称");
  });

  test("工具条下面不放说明文字和条数，卡片网格紧跟在工具条后面", () => {
    expect(html).not.toContain("点卡片试听");
    expect(html).not.toContain("参考音频");
    expect(html).not.toContain("加载中…");
    expect(html).not.toContain("aria-live");
    expect(html).toContain('data-slot="official-voice-grid"');
  });
});
