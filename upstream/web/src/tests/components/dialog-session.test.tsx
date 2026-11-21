import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";

import { DialogSession } from "@/components/dialog-session";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { holdExitAnimations, installDom, type DomEnv } from "@/tests/helpers/dom";

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
});
afterAll(() => dom.restore());

/** 弹窗里的内容：自己有状态，用来看关闭 / 重开时状态有没有被重置 */
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-testid="count" onClick={() => setCount((n) => n + 1)}>
      计数 {count}
    </button>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="toggle" onClick={() => setOpen((v) => !v)}>
        开关
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>测试</DialogTitle>
          <DialogSession open={open}>
            <Counter />
          </DialogSession>
        </DialogContent>
      </Dialog>
    </>
  );
}

const q = (id: string) => dom.win.document.querySelector(`[data-testid="${id}"]`);

describe("DialogSession：弹窗内容关闭时留到动画播完，每次打开从头开始", () => {
  test("关闭途中内容还在（退出动画有东西可放），不会一下子空掉", async () => {
    const release = holdExitAnimations(dom);
    const { unmount } = await dom.mount(<Harness />);
    await dom.click(q("toggle"));
    await dom.click(q("count"));
    expect(q("count")?.textContent).toBe("计数 1");

    await dom.click(q("toggle"));
    expect(q("count")?.textContent).toBe("计数 1");

    // 动画还没播完就重新打开：也是新的一次，状态从头开始
    await dom.click(q("toggle"));
    expect(q("count")?.textContent).toBe("计数 0");
    release();
    await unmount();
  });

  test("关掉再打开，内容的状态从头开始", async () => {
    const { unmount } = await dom.mount(<Harness />);
    await dom.click(q("toggle"));
    await dom.click(q("count"));
    await dom.click(q("toggle"));
    await dom.flush();
    await dom.click(q("toggle"));
    expect(q("count")?.textContent).toBe("计数 0");
    await unmount();
  });
});

/** 列出 src 下的 .tsx（跳过测试和 shadcn 生成的 ui） */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "tests" || name === "ui" ? [] : sources(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("弹窗写法守卫", () => {
  test("弹窗里不写 {open && <内容/>}：关闭时内容被直接卸载，退出动画放不出来，改用 DialogSession", () => {
    const gated = /\{\s*open\s*&&\s*[<(]/;
    const offenders = sources(join(import.meta.dir, "../..")).filter((path) => {
      const text = readFileSync(path, "utf8");
      // 整个弹窗外壳被 open 包住
      if (/\{\s*open\s*&&\s*\(?\s*<(Dialog|Sheet|AlertDialog)Content\b/.test(text)) return true;
      // 外壳里的正文被 open 包住
      const contents =
        text.match(/<(Dialog|Sheet|AlertDialog)Content\b[\s\S]*?<\/\1Content>/g) ?? [];
      return contents.some((content) => gated.test(content));
    });
    expect(offenders.map((path) => path.split("/src/")[1])).toEqual([]);
  });
});
