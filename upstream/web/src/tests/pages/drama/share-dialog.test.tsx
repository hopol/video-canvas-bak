import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { dramaSharing } from "@/api/drama/share";
import type { DialogHost as DialogHostType } from "@/components/dialog-host";
import type { DramaShareDialog as DramaShareDialogType } from "@/pages/drama/share-dialog";
import type { openDialog as OpenDialogType } from "@/store/dialog";
import type { MemoryRouter as MemoryRouterType } from "react-router";

import { holdExitAnimations, installDom, type DomEnv } from "@/tests/helpers/dom";

/** 短剧共享弹窗：从 openDialog 打开，关闭时播完退出动画再移除，外观是清透弹层 */

let dom: DomEnv;
let DramaShareDialog: typeof DramaShareDialogType;
let DialogHost: typeof DialogHostType;
let openDialog: typeof OpenDialogType;
let MemoryRouter: typeof MemoryRouterType;
beforeAll(async () => {
  dom = await installDom();
  DramaShareDialog = (await import("@/pages/drama/share-dialog")).DramaShareDialog;
  DialogHost = (await import("@/components/dialog-host")).DialogHost;
  openDialog = (await import("@/store/dialog")).openDialog;
  MemoryRouter = (await import("react-router")).MemoryRouter;
}, 60_000);
afterAll(() => dom?.restore());

const byText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

describe("短剧共享弹窗", () => {
  test("关闭时内容不先卸载：退出动画期间弹窗里仍是原来的内容", async () => {
    const members = spyOn(dramaSharing, "members").mockResolvedValue([]);
    const release = holdExitAnimations(dom);
    try {
      const m = await dom.mount(
        <MemoryRouter>
          <DialogHost />
        </MemoryRouter>,
      );
      await dom.act(async () => {
        openDialog(DramaShareDialog, { id: "d1", title: "剧", transferred: () => {} });
      });
      await dom.flush();
      const body = dom.win.document.body;
      const popup = () => body.querySelector('[data-slot="dialog-content"]');
      expect(popup()?.className).toContain("backdrop-blur-2xl");
      await dom.click(byText(body, "取消"));
      expect(popup()?.hasAttribute("data-ending-style")).toBe(true);
      expect(popup()?.textContent).toContain("共享《剧》");
      await m.unmount();
    } finally {
      release();
      members.mockRestore();
    }
  });
});
