import assert from "node:assert/strict";
import test from "node:test";

import { insecureBaseWarning, isInsecureRemoteBase, sameBase } from "../src/base.ts";
import { ok, runCli, startSite, tempConfig } from "./helpers/site.ts";

const me = ok({ id: 1, username: "u", nickname: "", role: "user" });

test("isInsecureRemoteBase：只有 http 且不是本机才算不安全", () => {
  assert.equal(isInsecureRemoteBase("http://example.com/api/v1"), true);
  assert.equal(isInsecureRemoteBase("http://192.168.1.5:8080/api/v1"), true);
  assert.equal(isInsecureRemoteBase("https://example.com/api/v1"), false);
  assert.equal(isInsecureRemoteBase("http://localhost:8080/api/v1"), false);
  assert.equal(isInsecureRemoteBase("http://127.0.0.1:8080/api/v1"), false);
  assert.equal(isInsecureRemoteBase("http://[::1]:8080/api/v1"), false);
  assert.match(insecureBaseWarning("http://example.com/api/v1"), /明文/);
});

test("sameBase：忽略 /api/v1 后缀、末尾斜杠与大小写", () => {
  assert.equal(sameBase("https://Example.com", "https://example.com/api/v1/"), true);
  assert.equal(sameBase("https://a.com", "https://b.com"), false);
});

test("token 只属于登录时的站点：--base 指向别处就拒绝，且一个请求都不发", async () => {
  const mine = await startSite(() => me);
  const other = await startSite(() => me);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: mine.base, token: "SECRET" }) };
    const viaFlag = await runCli(["whoami", "--base", other.base], env);
    assert.equal(viaFlag.code, 2);
    assert.match(viaFlag.stderr, /login/);
    const viaEnv = await runCli(["canvas", "list"], { ...env, VC_API_BASE: other.base });
    assert.equal(viaEnv.code, 2);
    assert.equal(other.requests.length, 0, "token 不能发给没登录过的站点");
    assert.equal(mine.requests.length, 0);
  } finally {
    await mine.close();
    await other.close();
  }
});

test("同一站点用 --base 重复指定（带不带 /api/v1）照常使用 token", async () => {
  const site = await startSite(() => me);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "SECRET" }) };
    for (const flag of [site.base, `${site.base}/api/v1`]) {
      const res = await runCli(["whoami", "--base", flag], env);
      assert.equal(res.code, 0, res.stderr);
    }
    assert.equal(site.requests.at(-1)?.headers.authorization, "Bearer SECRET");
  } finally {
    await site.close();
  }
});

test("凭据里没有记录登录站点时，换 --base 也拒绝（旧文件不能被当成通行证）", async () => {
  const site = await startSite(() => me);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ token: "SECRET" }) };
    const res = await runCli(["whoami", "--base", site.base], env);
    assert.equal(res.code, 2);
    assert.equal(site.requests.length, 0);
  } finally {
    await site.close();
  }
});
