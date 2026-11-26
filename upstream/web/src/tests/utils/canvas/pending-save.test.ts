import { describe, expect, test } from "bun:test";

import { trackPendingSave, waitPendingSave } from "@/utils/canvas/pending-save";

/** 画布卸载时补存的那一次：别处读这张画布前先等它落地，读到的才是刚改过的 */

const later = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("pending-save：读画布前等卸载时的补存", () => {
  test("没有在存的：马上返回", async () => {
    let done = false;
    await waitPendingSave("none").then(() => (done = true));
    expect(done).toBe(true);
  });

  test("有在存的：等它落地才返回；别的画布不用等", async () => {
    const save = later<boolean>();
    trackPendingSave("c1", save.promise);
    let waited = false;
    const wait = waitPendingSave("c1").then(() => (waited = true));
    let other = false;
    await waitPendingSave("c2").then(() => (other = true));
    expect(other).toBe(true);
    await Promise.resolve();
    expect(waited).toBe(false);
    save.resolve(true);
    await wait;
    expect(waited).toBe(true);
  });

  test("保存失败也照常放行，不把错误抛给读的一方；落地后登记清掉", async () => {
    const save = later<boolean>();
    trackPendingSave("c3", save.promise);
    const wait = waitPendingSave("c3");
    save.reject(new Error("offline"));
    await wait;
    let done = false;
    await waitPendingSave("c3").then(() => (done = true));
    expect(done).toBe(true);
  });

  test("一直存不完：最多等到上限就放行，读画布不被卡死", async () => {
    trackPendingSave("c4", new Promise<boolean>(() => {}));
    const start = Date.now();
    await waitPendingSave("c4", 30);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
