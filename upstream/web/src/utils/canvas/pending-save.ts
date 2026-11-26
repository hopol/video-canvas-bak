/**
 * 画布编辑器卸载时补存的那一次，按画布 id 登记在这里：
 * 同一页面里切工序（资产管理的画布卸载、片场挂上）时，片场读画布和补存是同时发出的，
 * 不等补存落地就可能读到旧图谱（刚点的生成看不见）。读画布的一方先 waitPendingSave 再读。
 */
const pending = new Map<string, Promise<unknown>>();

/** 等补存最多这么久：网络卡住时不能让读画布一直挂着，超时就按当时服务端的内容读 */
const MAX_WAIT_MS = 3000;

/**
 * 登记一次补存；落地（成功或失败）后自动清掉
 * @param canvasId 画布 id
 * @param save 保存的 Promise
 */
export function trackPendingSave(canvasId: string, save: Promise<unknown>) {
  const settled = save.then(
    () => undefined,
    () => undefined,
  );
  pending.set(canvasId, settled);
  void settled.then(() => {
    if (pending.get(canvasId) === settled) pending.delete(canvasId);
  });
}

/**
 * 等这张画布在存的补存落地；没有就马上返回，保存失败也放行，最多等 maxMs
 * @param canvasId 画布 id
 * @param maxMs 最多等多久（毫秒）
 */
export function waitPendingSave(canvasId: string, maxMs = MAX_WAIT_MS): Promise<void> {
  const save = pending.get(canvasId);
  if (!save) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxMs);
  });
  return Promise.race([save.then(() => undefined), timeout]).finally(() => clearTimeout(timer));
}
