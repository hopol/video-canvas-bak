import assert from "node:assert/strict";
import test from "node:test";

import { ok, runCli, startSite, tempConfig, type Handler } from "./helpers/site.ts";

const task = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  task_ref: `t${id}`,
  status,
  kind: "image",
  model_id: "m",
  credits: 5,
  progress: status === "running" ? 30 : 100,
  ...extra,
});

const submit =
  (count: number): Handler =>
  (req) => {
    if (req.method === "POST" && req.path === "/api/v1/generation-tasks") {
      return ok(
        {
          items: Array.from({ length: count }, (_, i) => ({
            node_id: "n1",
            task: task(500 + i, "queued"),
          })),
        },
        202,
      );
    }
    return undefined;
  };

test("task wait：服务端 5xx 退避重试，恢复后照常等到终态", async () => {
  let polls = 0;
  const site = await startSite((req) => {
    if (req.path === "/api/v1/generation-tasks/5") {
      polls++;
      if (polls <= 2) return { status: 503, body: { code: 1, msg: "busy" } };
      return ok(task(5, "succeeded"));
    }
    return undefined;
  });
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const res = await runCli(["task", "wait", "5", "--interval", "1", "--timeout", "30"], env);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /重试/);
    assert.equal(polls, 3);
  } finally {
    await site.close();
  }
});

test("task wait：4xx 不重试，立刻失败", async () => {
  let polls = 0;
  const site = await startSite((req) => {
    if (req.path === "/api/v1/generation-tasks/6") {
      polls++;
      return { status: 404, body: { code: 40401, msg: "任务不存在" } };
    }
    return undefined;
  });
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const res = await runCli(["task", "wait", "6", "--interval", "1"], env);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /任务不存在/);
    assert.equal(polls, 1);
  } finally {
    await site.close();
  }
});

test("generate --wait 多任务共享一个总截止时间；超时时 --json 仍列出所有任务 id 与冻结积分", async () => {
  const site = await startSite((req, count) => {
    const posted = submit(2)(req, count);
    if (posted) return posted;
    if (/^\/api\/v1\/generation-tasks\/\d+$/.test(req.path)) {
      return ok(task(Number(req.path.split("/").pop()), "running"));
    }
    return undefined;
  });
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const started = Date.now();
    const res = await runCli(
      [
        "generate",
        "image",
        "--model",
        "m",
        "--prompt",
        "x",
        "--canvas",
        "c1",
        "--node",
        "n1",
        "--count",
        "2",
        "--wait",
        "--timeout",
        "2",
        "--interval",
        "1",
        "--json",
      ],
      env,
    );
    const elapsed = Date.now() - started;
    assert.equal(res.code, 3, res.stderr);
    assert.ok(elapsed < 4500, `总等待应约 2 秒而不是 2×2 秒，实际 ${elapsed}ms`);
    const body = JSON.parse(res.stdout.trim()) as {
      ok: boolean;
      error: { message: string };
      data: { tasks: Array<{ id: number; credits: number }>; idempotency_key: string };
    };
    assert.equal(body.ok, false);
    assert.match(body.error.message, /超时/);
    assert.deepEqual(
      body.data.tasks.map((t) => [t.id, t.credits]),
      [
        [500, 5],
        [501, 5],
      ],
    );
    assert.ok(body.data.idempotency_key);
  } finally {
    await site.close();
  }
});

test("generate：幂等键在发请求前就打印，--idempotency-key 由调用方给，结果里也带上", async () => {
  const site = await startSite(submit(1));
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const generated = await runCli(
      ["generate", "image", "--model", "m", "--prompt", "x", "--json"],
      env,
    );
    assert.equal(generated.code, 0, generated.stderr);
    const sent = site.requests.at(-1)?.headers["idempotency-key"] as string;
    assert.ok(sent);
    assert.match(generated.stderr, new RegExp(sent));
    assert.equal(JSON.parse(generated.stdout).data.idempotency_key, sent);

    const given = await runCli(
      [
        "generate",
        "image",
        "--model",
        "m",
        "--prompt",
        "x",
        "--idempotency-key",
        "my-key-1",
        "--json",
      ],
      env,
    );
    assert.equal(given.code, 0, given.stderr);
    assert.equal(site.requests.at(-1)?.headers["idempotency-key"], "my-key-1");
    assert.equal(JSON.parse(given.stdout).data.idempotency_key, "my-key-1");
  } finally {
    await site.close();
  }
});

test("generate：提交请求失败时，幂等键已经在 stderr 里，方便原样重投", async () => {
  const site = await startSite(() => ({ status: 502, body: { code: 1, msg: "bad gateway" } }));
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const res = await runCli(["generate", "image", "--model", "m", "--prompt", "x"], env);
    assert.equal(res.code, 1);
    const key = site.requests[0]?.headers["idempotency-key"] as string;
    assert.match(res.stderr, new RegExp(key));
  } finally {
    await site.close();
  }
});
