import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const docs = readFileSync(join(import.meta.dir, "../../content/cli-docs.md"), "utf8");

describe("CLI 文档与现状一致", () => {
  test("安装讲后端下发的一键脚本与手动安装，技能用 vc skill install", () => {
    expect(docs).toContain("/api/v1/cli/install.sh | sh");
    expect(docs).toContain("/api/v1/cli/install.ps1 | iex");
    expect(docs).toContain(
      "npm i -g https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.tgz",
    );
    expect(docs).not.toContain("video-canvas-cli@latest");
    expect(docs).toContain("vc skill install");
  });

  test("不再指向后端已删除的安装包接口与旧安装变量", () => {
    for (const gone of [
      "/api/v1/cli/download",
      "/cli/download",
      "/cli/release",
      "VC_PREFIX",
      "npm root -g",
    ]) {
      expect(docs).not.toContain(gone);
    }
  });

  test("后端还没有合成接口，文档里不能出现 compose 命令", () => {
    expect(docs).not.toMatch(/canvas compose/);
    expect(docs).not.toContain("compose-status");
    expect(docs).not.toContain("compose-cancel");
  });

  test("logout 只清本地凭据，并说明服务端登录态怎么失效", () => {
    expect(docs).toContain("只清本地凭据");
    expect(docs).toContain("改密码");
  });

  test("说明令牌绑定登录站点，以及授权页要输入用户码", () => {
    expect(docs).toContain("绑定登录时的站点");
    expect(docs).toContain("必须手动输入终端里显示的用户码");
  });
});
