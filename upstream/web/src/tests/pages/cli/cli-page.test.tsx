import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import CLIPage from "@/pages/cli";

const html = renderToStaticMarkup(
  <MemoryRouter>
    <CLIPage />
  </MemoryRouter>,
);

describe("/cli 页", () => {
  test("安装区给出三个平台的一键脚本命令和「复制命令给 Agent」", () => {
    expect(html).toContain("/api/v1/cli/install.sh | sh");
    expect(html).toContain("/api/v1/cli/install.ps1 | iex");
    expect(html).toContain("-ExecutionPolicy Bypass");
    expect(html).toContain("复制命令给 Agent");
  });

  test("手动安装（从 GitHub Release）与卸载仍然给出，不再指向 npm 仓库", () => {
    expect(html).toContain(
      "npm i -g https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.tgz",
    );
    expect(html).toContain("npm uninstall -g video-canvas-cli");
    expect(html).not.toContain("video-canvas-cli@latest");
    expect(html).not.toContain("发布在 npm");
  });

  test("技能用 vc skill install 装，不再让人手抄 cp 命令", () => {
    expect(html).toContain("vc skill install");
    expect(html).not.toContain("npm root -g");
  });

  test("不再引用后端已删除的安装包接口", () => {
    for (const gone of ["cli/download", "cli/release"]) {
      expect(html).not.toContain(gone);
    }
  });

  test("没有后端接口的合成命令不展示", () => {
    expect(html).not.toContain("canvas compose");
    expect(html).not.toContain("compose-status");
  });
});
