/** 存放最近一次发起的读取 */
export type LatestSlot<T> = { current: Promise<T> | null };

/**
 * 「只认最新一次」的异步读取：把刚发起的 mine 记为最新，返回的 Promise 最终给出此刻最新那次读取的结果（或错误）。
 * 被更晚的读取顶掉时继续等新的那次，不会拿到过期数据，也不会空手而归。
 * @param slot 同一类读取共用的槽位（组件里用 useRef）
 * @param mine 刚发起的读取
 * @returns 跟随到最新一次读取的结果
 */
export function followLatest<T>(slot: LatestSlot<T>, mine: Promise<T>): Promise<T> {
  slot.current = mine;
  const settle = (run: Promise<T>): Promise<T> =>
    run.then(
      (value) => (slot.current === run || !slot.current ? value : settle(slot.current)),
      (error: unknown) =>
        slot.current === run || !slot.current ? Promise.reject(error) : settle(slot.current),
    );
  return settle(mine);
}
