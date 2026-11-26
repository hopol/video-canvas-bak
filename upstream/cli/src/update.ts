/**
 * CLI 只经 GitHub Release 分发：每次站点发版，release-docker.yml 把 `npm pack` 的产物
 * 以固定文件名挂到 Release 上，`releases/latest/download/<文件名>` 永远指向最新一版。
 * 附件有三个：安装包 .tgz、它的 .sha256（安装脚本先校验再装）、清单 .json（这里读版本）。
 */
const RELEASE_BASE = "https://github.com/zaylora/video-canvas/releases/latest/download";

/** 最新安装包：npm 能直接从这个地址全局安装。 */
export const PACKAGE_URL = `${RELEASE_BASE}/video-canvas-cli.tgz`;

/** 清单：{ name, version, sha256 }，版本检查只需要它，不必下载整个包。 */
const MANIFEST_URL = `${RELEASE_BASE}/video-canvas-cli.json`;

/** 手动安装 / 升级命令（一键脚本会额外校验 sha256 并装好技能）。 */
export const INSTALL_COMMAND = `npm i -g ${PACKAGE_URL}`;

/** 语义化版本比较：a 比 b 新返回 true。beta 期间只比前三段数字，预发布后缀按同版本处理。 */
export function isNewer(a: string, b: string): boolean {
  const parse = (value: string): number[] =>
    String(value)
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0);
  }
  return false;
}

/** 升级提示：从 GitHub Release 重新装一次即可，装完记得 vc skill install 更新技能。 */
export function upgradeHint(latest: string, local: string, channel = "beta"): string {
  return `提示：命令行有新版本 ${latest}（当前 ${local}，${channel} 渠道）。升级：${INSTALL_COMMAND} && vc skill install`;
}

/** 读最新 Release 的清单拿版本；超时、离线、被拦截都静默返回 null。 */
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(MANIFEST_URL, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version ? body.version : null;
  } catch {
    return null;
  }
}
