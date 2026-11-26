import { spawn } from "node:child_process";

/**
 * 尽力打开浏览器；任何失败都静默（用户仍能看到打印的地址）。
 *
 * 命令不存在（无头 Linux、容器、SSH 里没有 xdg-open）时，spawn 不会同步抛错，
 * 而是稍后在子进程对象上发 `error` 事件——没人监听就会变成未捕获异常、把整个进程带崩，
 * 所以 error 监听必须挂上。spawnImpl 可注入，方便测试。
 */
export function openBrowser(url: string, spawnImpl: typeof spawn = spawn): void {
  // Windows 不走 cmd /c start：URL 里的 & 会被 cmd 当成命令分隔符；rundll32 不经过 shell 解析
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  try {
    const child = spawnImpl(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      // 无图形环境或没装打开命令：忽略
    });
    child.unref();
  } catch {
    // 同步失败（参数非法等）：同样忽略
  }
}
