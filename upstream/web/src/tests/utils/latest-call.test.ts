import { describe, expect, test } from "bun:test";

import { followLatest, type LatestSlot } from "@/utils/latest-call";

/** 可以手动决定何时完成的 Promise */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 每次调用都按顺序取 runs 里的下一个读取，和组件里一样共用一个槽位 */
function reader<T>(runs: { promise: Promise<T> }[]) {
  const slot: LatestSlot<T> = { current: null };
  let n = 0;
  return () => followLatest(slot, runs[n++]!.promise);
}

/** 重复读取同一份数据：被更晚一次读取顶掉的调用拿到最新结果，而不是空值 */
describe("followLatest", () => {
  test("单次调用直接拿到自己的结果", async () => {
    const read = reader([{ promise: Promise.resolve(1) }]);
    expect(await read()).toBe(1);
  });

  test("并发调用都拿到最后一次的结果，先完成的旧调用也一样", async () => {
    const runs = [deferred<string>(), deferred<string>(), deferred<string>()];
    const read = reader(runs);
    const results = [read(), read(), read()];
    runs[0]!.resolve("first");
    runs[2]!.resolve("third");
    runs[1]!.resolve("second");
    expect(await Promise.all(results)).toEqual(["third", "third", "third"]);
  });

  test("旧调用还在等时又来一次新调用，继续跟到更新的那次", async () => {
    const runs = [deferred<string>(), deferred<string>(), deferred<string>()];
    const read = reader(runs);
    const first = read();
    read();
    runs[0]!.resolve("first");
    runs[1]!.resolve("second");
    await Promise.resolve();
    const third = read();
    runs[2]!.resolve("third");
    expect(await first).toBe("third");
    expect(await third).toBe("third");
  });

  test("旧调用失败不影响，跟随最新一次的结果；最新一次失败时都拿到错误", async () => {
    const runs = [deferred<string>(), deferred<string>()];
    const read = reader(runs);
    const results = [read(), read()];
    runs[0]!.reject(new Error("old"));
    runs[1]!.resolve("new");
    expect(await Promise.all(results)).toEqual(["new", "new"]);

    const again = [deferred<string>(), deferred<string>()];
    const fail = reader(again);
    const failed = [fail(), fail()];
    again[0]!.resolve("old");
    again[1]!.reject(new Error("boom"));
    const settled = await Promise.allSettled(failed);
    expect(settled.map((item) => item.status)).toEqual(["rejected", "rejected"]);
    for (const item of settled) {
      if (item.status === "rejected") expect((item.reason as Error).message).toBe("boom");
    }
  });
});
