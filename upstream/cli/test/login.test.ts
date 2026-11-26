import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { openBrowser } from "../src/browser.ts";
import {
  ok,
  runCli,
  startSite,
  tempConfig,
  type Handler,
  type Reply,
  type Site,
} from "./helpers/site.ts";

const START = ok({
  device_code: "dc-secret",
  user_code: "ABCD-EFGH",
  verification_uri: "/cli/authorize",
  verification_uri_complete: "/cli/authorize?code=ABCD-EFGH",
  expires_in: 30,
  interval: 1,
});
const APPROVED = ok({
  status: "approved",
  token: "JWT-TOKEN",
  expire_at: 2000000000,
  role: "user",
});

/** 设备授权的假站点：轮询按 polls 依次回复，用完后一直回最后一项。 */
function deviceSite(polls: Reply[]): Promise<Site> {
  let n = 0;
  const handler: Handler = (req) => {
    if (req.method === "POST" && req.path === "/api/v1/auth/cli/device") return START;
    if (req.method === "POST" && req.path === "/api/v1/auth/cli/token") {
      return polls[Math.min(n++, polls.length - 1)];
    }
    return undefined;
  };
  return startSite(handler);
}

test("login：授权地址与用户码始终打印，凭据绑定登录站点，stdout 里没有令牌", async () => {
  const site = await deviceSite([APPROVED]);
  try {
    const root = tempConfig();
    const res = await runCli(["login", "--base", site.base, "--no-open", "--json"], {
      XDG_CONFIG_HOME: root,
    });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, new RegExp(`${site.base}/cli/authorize\\?code=ABCD-EFGH`));
    assert.match(res.stderr, /ABCD-EFGH/);
    assert.doesNotMatch(res.stdout, /JWT-TOKEN/);
    const saved = JSON.parse(
      fs.readFileSync(path.join(root, "video-canvas", "credentials.json"), "utf8"),
    ) as { base: string; token: string };
    assert.equal(saved.token, "JWT-TOKEN");
    assert.equal(saved.base, `${site.base}/api/v1`);
  } finally {
    await site.close();
  }
});

test("login：--web 覆盖授权页所在站点；轮询遇到 5xx 会退避重试而不是退出", async () => {
  const site = await deviceSite([{ status: 503, body: { code: 1, msg: "busy" } }, APPROVED]);
  try {
    const res = await runCli(
      ["login", "--base", site.base, "--web", "https://app.example.com/", "--no-open"],
      { XDG_CONFIG_HOME: tempConfig() },
    );
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /https:\/\/app\.example\.com\/cli\/authorize\?code=ABCD-EFGH/);
    assert.match(res.stderr, /重试/);
    const polls = site.requests.filter((r) => r.path.endsWith("/auth/cli/token"));
    assert.equal(polls.length, 2);
  } finally {
    await site.close();
  }
});

test("login：VC_WEB_URL 与 --web 等价；4xx 不重试，直接失败", async () => {
  const site = await deviceSite([{ status: 400, body: { code: 40001, msg: "设备码无效" } }]);
  try {
    const res = await runCli(["login", "--base", site.base, "--no-open"], {
      XDG_CONFIG_HOME: tempConfig(),
      VC_WEB_URL: "https://web.example.org",
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /https:\/\/web\.example\.org\/cli\/authorize/);
    assert.match(res.stderr, /设备码无效/);
    const polls = site.requests.filter((r) => r.path.endsWith("/auth/cli/token"));
    assert.equal(polls.length, 1);
  } finally {
    await site.close();
  }
});

test("login：授权被拒绝时报错且不写凭据", async () => {
  const site = await deviceSite([ok({ status: "denied" })]);
  try {
    const root = tempConfig();
    const res = await runCli(["login", "--base", site.base, "--no-open"], {
      XDG_CONFIG_HOME: root,
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /拒绝/);
    assert.equal(fs.existsSync(path.join(root, "video-canvas", "credentials.json")), false);
  } finally {
    await site.close();
  }
});

test("openBrowser：命令不存在（异步 error 事件）时静默，不抛未捕获异常", () => {
  const child = Object.assign(new EventEmitter(), { unref: () => {} });
  const fakeSpawn = (() => child) as unknown as typeof import("node:child_process").spawn;
  openBrowser("https://x", fakeSpawn);
  assert.doesNotThrow(() => child.emit("error", new Error("spawn xdg-open ENOENT")));
});

test("openBrowser：同步抛错也静默", () => {
  const fakeSpawn = (() => {
    throw new Error("boom");
  }) as unknown as typeof import("node:child_process").spawn;
  assert.doesNotThrow(() => openBrowser("https://x", fakeSpawn));
});
