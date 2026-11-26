import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli, tempConfig } from "./helpers/site.ts";

const mkdir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vc-ts-"));

test("trace：不执行当前目录下的 scripts/agent-trace，找不到时报错并说明怎么指定", async () => {
  const cwd = mkdir();
  const marker = path.join(cwd, "PWNED");
  fs.mkdirSync(path.join(cwd, "scripts", "agent-trace"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "scripts", "agent-trace", "agent-trace.mjs"),
    `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "x");`,
  );
  const res = await runCli(["trace", "show", "run1"], { XDG_CONFIG_HOME: tempConfig() }, { cwd });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /找不到 agent-trace/);
  assert.match(res.stderr, /--script/);
  assert.equal(fs.existsSync(marker), false, "当前目录里的脚本不能被执行");
});

test("trace --script：显式指定才执行，先提示风险，并透传参数（不含本 CLI 的选项）", async () => {
  const dir = mkdir();
  const script = path.join(dir, "trace.mjs");
  fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));");
  const res = await runCli(
    [
      "trace",
      "pull",
      "--since",
      "7d",
      "--script",
      script,
      "--json",
      "--base",
      "http://127.0.0.1:1",
    ],
    { XDG_CONFIG_HOME: tempConfig() },
  );
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /会以你的权限运行/);
  assert.match(res.stderr, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(JSON.parse(res.stdout.trim()), ["pull", "--since", "7d"]);
});

test("skill path：第一行是随包技能目录，并指向 vc skill install", async () => {
  const res = await runCli(["skill", "path"], { XDG_CONFIG_HOME: tempConfig() });
  assert.equal(res.code, 0, res.stderr);
  const dir = res.stdout.split("\n")[0]?.trim() as string;
  assert.ok(path.isAbsolute(dir), `第一行应是技能目录的绝对路径：${dir}`);
  assert.ok(fs.existsSync(path.join(dir, "SKILL.md")), "目录里要有 SKILL.md");
  assert.match(res.stdout, /vc skill install/);
});

test("skill path --json：给脚本 path 与各平台的拷贝命令", async () => {
  const res = await runCli(["skill", "path", "--json"], { XDG_CONFIG_HOME: tempConfig() });
  assert.equal(res.code, 0, res.stderr);
  const body = JSON.parse(res.stdout.trim()) as {
    ok: boolean;
    data: { path: string; install: { unix: string; windows: string } };
  };
  assert.equal(body.ok, true);
  assert.ok(fs.existsSync(path.join(body.data.path, "SKILL.md")));
  assert.match(body.data.install.unix, /cp -R/);
  assert.match(body.data.install.windows, /Copy-Item/);
});

test("skill install：默认装进 Claude Code，已有 ~/.codex 时也装进 Codex", async () => {
  const home = mkdir();
  fs.mkdirSync(path.join(home, ".codex"));
  const res = await runCli(["skill", "install"], { HOME: home, XDG_CONFIG_HOME: tempConfig() });
  assert.equal(res.code, 0, res.stderr);
  for (const root of [".claude", ".codex"]) {
    const skillMd = path.join(home, root, "skills", "video-canvas-cli", "SKILL.md");
    assert.ok(fs.existsSync(skillMd), `${skillMd} 应该存在`);
  }
  assert.equal(fs.existsSync(path.join(home, ".agents")), false, "没装过的助手不替它建目录");
  assert.match(res.stdout, /Claude Code/);
  assert.match(res.stdout, /Codex/);
});

test("skill install：重装会覆盖旧版本，残留文件不留下", async () => {
  const home = mkdir();
  const dest = path.join(home, ".claude", "skills", "video-canvas-cli");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "stale.md"), "old");
  const res = await runCli(["skill", "install"], { HOME: home, XDG_CONFIG_HOME: tempConfig() });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dest, "SKILL.md")));
  assert.equal(fs.existsSync(path.join(dest, "stale.md")), false);
});

test("skill install --to：只装到指定的技能目录，--json 列出装好的位置", async () => {
  const home = mkdir();
  const custom = path.join(mkdir(), "skills");
  const res = await runCli(["skill", "install", "--to", custom, "--json"], {
    HOME: home,
    XDG_CONFIG_HOME: tempConfig(),
  });
  assert.equal(res.code, 0, res.stderr);
  const body = JSON.parse(res.stdout.trim()) as {
    ok: boolean;
    data: { installed: Array<{ agent: string; path: string }> };
  };
  const dest = path.join(custom, "video-canvas-cli");
  assert.deepEqual(body.data.installed, [{ agent: "custom", path: dest }]);
  assert.ok(fs.existsSync(path.join(dest, "SKILL.md")));
  assert.equal(fs.existsSync(path.join(home, ".claude")), false, "给了 --to 就不再装默认位置");
});

test("skill：没给子命令或写错时报用法错误", async () => {
  const res = await runCli(["skill"], { XDG_CONFIG_HOME: tempConfig() });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /skill path/);
});

test("logout：如实说明只清了本地凭据，服务端登录态不会因此失效", async () => {
  const root = tempConfig({ base: "http://127.0.0.1:1", token: "t" });
  const res = await runCli(["logout"], { XDG_CONFIG_HOME: root });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /只清除了本机凭据/);
  assert.match(res.stdout, /到期或改密码/);
  assert.doesNotMatch(res.stdout, /已吊销|已撤销/);
});
