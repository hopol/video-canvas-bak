import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchLatestVersion,
  INSTALL_COMMAND,
  isNewer,
  PACKAGE_URL,
  upgradeHint,
} from "../src/update.ts";

test("isNewer：只比前三段数字，预发布后缀按同版本处理", () => {
  assert.equal(isNewer("0.7.0", "0.6.3"), true);
  assert.equal(isNewer("1.0.0", "0.9.9"), true);
  assert.equal(isNewer("0.6.3", "0.6.3"), false);
  assert.equal(isNewer("0.6.2", "0.6.3"), false);
  assert.equal(isNewer("0.6.3-beta.1", "0.6.3"), false);
});

test("安装包地址固定指向 GitHub 最新 Release 的附件", () => {
  assert.equal(
    PACKAGE_URL,
    "https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.tgz",
  );
  assert.equal(INSTALL_COMMAND, `npm i -g ${PACKAGE_URL}`);
});

test("upgradeHint：升级从 GitHub Release 装，不再指向 npm 仓库", () => {
  const hint = upgradeHint("0.7.0", "0.6.3");
  assert.ok(hint.includes(INSTALL_COMMAND), hint);
  assert.doesNotMatch(hint, /@latest/);
});

test("fetchLatestVersion：读最新 Release 附带的清单里的版本，失败返回 null", async () => {
  const urls: string[] = [];
  const good = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ name: "video-canvas-cli", version: "0.7.0" }));
  }) as unknown as typeof fetch;
  assert.equal(await fetchLatestVersion(good), "0.7.0");
  assert.equal(
    urls[0],
    "https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.json",
  );

  const bad = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchLatestVersion(bad), null);
  const down = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await fetchLatestVersion(down), null);
});
