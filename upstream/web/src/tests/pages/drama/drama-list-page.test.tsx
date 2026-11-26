import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { MemoryRouter } from "react-router";

import type DramaListPageType from "@/pages/drama/index";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

/** 短剧首页「我的短剧」标题旁不放「共享给我」入口（共享的短剧在作品页看） */

mock.module("@/hooks/use-drama-list", () => ({
  useDramaList: () => ({
    items: [],
    total: 0,
    loading: false,
    failed: false,
    deletingId: null,
    reload: () => {},
    remove: () => {},
  }),
}));

let dom: DomEnv;
let DramaListPage: typeof DramaListPageType;
beforeAll(async () => {
  dom = await installDom();
  DramaListPage = (await import("@/pages/drama/index")).default;
}, 60_000);
afterAll(() => dom?.restore());

describe("短剧首页", () => {
  test("「我的短剧」旁没有「共享给我」按钮", async () => {
    const { unmount } = await dom.mount(
      <MemoryRouter>
        <DramaListPage />
      </MemoryRouter>,
    );
    const body = dom.win.document.body;
    expect(body.textContent).toContain("我的短剧");
    expect(body.textContent).not.toContain("共享给我");
    expect(body.querySelector('a[href="/canvases?scope=shared-drama"]')).toBeNull();
    await unmount();
  });
});
