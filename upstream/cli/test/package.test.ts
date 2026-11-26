import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 打包进 GitHub Release 之前该成立的事：防误发 npm、随包文件齐全、CI 要调用的脚本名都在。

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  repository?: { url?: string };
  homepage?: string;
  keywords?: string[];
  publishConfig?: { access?: string };
  files?: string[];
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: { node?: string };
};

test("package.json：只经 GitHub Release 分发，标成 private 防止误发到 npm", () => {
  assert.equal(pkg.name, "video-canvas-cli");
  assert.equal(pkg.private, true);
  assert.equal(pkg.publishConfig, undefined);
  assert.equal(pkg.scripts?.prepublishOnly, undefined);
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.repository?.url ?? "", /zaylora\/video-canvas/);
  assert.ok(pkg.homepage);
  assert.ok((pkg.keywords ?? []).length > 0);
  assert.match(pkg.engines?.node ?? "", /22\.18/);
});

test("package.json：CI 与发布流程按这些脚本名调用", () => {
  for (const name of ["build", "typecheck", "test", "lint", "format", "format:check"]) {
    assert.ok(pkg.scripts?.[name], `缺少脚本 ${name}`);
  }
});

test("npm pack：随包有 dist、skill（含 .ts 脚本）、README，不带 src 与 test", () => {
  const out = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  const [info] = JSON.parse(out.stdout) as Array<{ files: Array<{ path: string }> }>;
  const files = (info as { files: Array<{ path: string }> }).files.map((f) => f.path);
  for (const must of [
    "package.json",
    "README.md",
    "dist/cli.js",
    "skill/SKILL.md",
    "skill/scripts/node-pick.ts",
  ]) {
    assert.ok(files.includes(must), `安装包里缺 ${must}`);
  }
  assert.ok(!files.some((f) => f.startsWith("src/") || f.startsWith("test/")), "不该带源码和测试");
  assert.ok(!files.some((f) => f.includes("node_modules")));
});

test("bin：两个命令名都指向存在的入口，入口带 shebang", () => {
  for (const target of Object.values(pkg.bin ?? {})) {
    const file = path.join(root, target);
    assert.ok(fs.existsSync(file), `${target} 不存在（先 npm run build）`);
    assert.match(fs.readFileSync(file, "utf8").split("\n")[0] ?? "", /^#!\/usr\/bin\/env node/);
  }
});
