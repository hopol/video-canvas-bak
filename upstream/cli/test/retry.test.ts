import assert from "node:assert/strict";
import test from "node:test";

import { APIError, request } from "../src/client.ts";
import { backoffMs, isRetryable, withRetry } from "../src/retry.ts";

const flaky = (times: number, err: APIError): (() => Promise<string>) => {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= times) throw err;
    return `ok@${calls}`;
  };
};

test("request：网络不通与 5xx 标记为可重试，4xx 不可重试", async () => {
  const down = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  await assert.rejects(
    request({ base: "http://x/api/v1", path: "/a", fetchImpl: down }),
    (err: unknown) => err instanceof APIError && err.retryable,
  );
  const reply = (status: number): typeof fetch =>
    (async () =>
      new Response(JSON.stringify({ code: 1, msg: "bad" }), { status })) as unknown as typeof fetch;
  await assert.rejects(
    request({ base: "http://x/api/v1", path: "/a", fetchImpl: reply(503) }),
    (err: unknown) => err instanceof APIError && err.retryable,
  );
  await assert.rejects(
    request({ base: "http://x/api/v1", path: "/a", fetchImpl: reply(404) }),
    (err: unknown) => err instanceof APIError && !err.retryable,
  );
});

test("withRetry：可重试错误按退避重试直到成功", async () => {
  const waits: number[] = [];
  const out = await withRetry(flaky(2, new APIError(-1, "boom", 0, undefined, true)), {
    deadline: Date.now() + 60_000,
    baseMs: 100,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(out, "ok@3");
  assert.deepEqual(waits, [100, 200]);
});

test("withRetry：4xx 与业务错误立刻抛出，不重试", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new APIError(-1, "参数错", 400);
      },
      { deadline: Date.now() + 60_000, baseMs: 1, sleep: async () => {} },
    ),
    /参数错/,
  );
  assert.equal(calls, 1);
});

test("withRetry：等不起下一次退避就抛出最近的真实错误", async () => {
  let clock = 0;
  await assert.rejects(
    withRetry(
      async () => {
        throw new APIError(-1, "一直连不上", 0, undefined, true);
      },
      {
        deadline: 1000,
        baseMs: 400,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    ),
    /一直连不上/,
  );
});

test("backoffMs：指数增长并封顶 15 秒；isRetryable 只认标记过的 APIError", () => {
  assert.equal(backoffMs(1, 1000), 1000);
  assert.equal(backoffMs(3, 1000), 4000);
  assert.equal(backoffMs(10, 1000), 15000);
  assert.equal(isRetryable(new Error("x")), false);
  assert.equal(isRetryable(new APIError(-1, "x", 0)), false);
});
