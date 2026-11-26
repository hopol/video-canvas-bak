import { normalizeBase } from "./client.ts";

/** 本机地址：明文 http 只在这里是可以接受的（调试用）。 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** http:// 且不是本机：令牌与请求内容会在网络上明文传输。 */
export function isInsecureRemoteBase(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  return url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/** 给 stderr 的警告句子。 */
export function insecureBaseWarning(base: string): string {
  return `警告：${base} 不是 https，令牌与请求内容会明文经过网络；只有本机（localhost / 127.0.0.1）调试才建议这样用。`;
}

/** 两个 API 地址是不是同一个站点：先各自规范化（补 /api/v1、去尾斜杠），再忽略大小写比较。 */
export function sameBase(a: string, b: string): boolean {
  return normalizeBase(a).toLowerCase() === normalizeBase(b).toLowerCase();
}

/**
 * 授权页所在的站点根：--web / VC_WEB_URL 优先，否则由 API 地址推出
 * （API 与网页不在同一个域名下时，推出来的地址打不开，需要用 --web 指定）。
 */
export function webRoot(explicit: string | undefined, apiBase: string): string {
  const raw = (explicit || "").trim().replace(/\/+$/, "");
  if (!raw) return apiBase.replace(/\/api\/v1$/i, "");
  if (!/^https?:\/\//i.test(raw)) throw new Error(`--web 必须以 http:// 或 https:// 开头：${raw}`);
  return raw;
}
