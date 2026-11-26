import { APIError, errorMessage } from "./client.ts";

/**
 * 等待类命令（登录轮询、task wait、--wait、--watch）的重试：
 * 网络不通与服务端 5xx 按退避重试，直到各自的截止时间；4xx 与业务错误立刻抛出，重试只会重复同一个错。
 */

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 首次退避毫秒数。测试可用 VC_RETRY_BASE_MS 缩短；日常不需要改。 */
export function retryBaseMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.VC_RETRY_BASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

/** 第 n 次（从 1 起）失败后的等待：base、2×base、4×base……封顶 15 秒。 */
export function backoffMs(attempt: number, base: number): number {
  return Math.min(base * 2 ** (attempt - 1), 15000);
}

/** 这个错误值得重试吗：只认明确标过 retryable 的 APIError。 */
export function isRetryable(err: unknown): boolean {
  return err instanceof APIError && err.retryable;
}

export interface RetryOptions {
  /** 截止时间（毫秒时间戳）；超过它不再重试，直接抛出最近一次的错误。 */
  deadline: number;
  /** 每次决定重试前的回调，用来在 stderr 提示用户「在重试」。 */
  onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** 执行 fn；遇到可重试错误就退避后再来，直到成功、不可重试错误或到达截止时间。 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    deadline,
    onRetry,
    baseMs = retryBaseMs(),
    sleep = defaultSleep,
    now = Date.now,
  } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      const wait = backoffMs(attempt, baseMs);
      // 等完这一轮就过了截止时间：不再白等，把真实原因抛给调用方
      if (now() + wait >= deadline) throw err;
      onRetry?.(err, attempt, wait);
      await sleep(wait);
    }
  }
}

/** 给 stderr 用的一句重试提示。 */
export function retryNotice(err: unknown, attempt: number, waitMs: number): string {
  return `请求失败（${errorMessage(err)}），${(waitMs / 1000).toFixed(waitMs < 1000 ? 1 : 0)} 秒后第 ${attempt} 次重试`;
}
