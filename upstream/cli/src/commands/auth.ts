// 登录、退出与身份：设备授权登录（RFC 8628 简化版）。
import os from "node:os";

import { webRoot } from "../base.ts";
import { openBrowser } from "../browser.ts";
import { APIError, errorMessage, request } from "../client.ts";
import { clearCredentials, saveCredentials } from "../config.ts";
import { retryNotice, withRetry } from "../retry.ts";
import { boolFlag } from "./args.ts";
import { baseOf, emit, requireToken, resolveBase, sleep } from "./shared.ts";
import type { Args, Ctx, DevicePoll, DeviceStart, Me } from "../types.ts";

/** 设备授权登录：申请短码 → 用户在网页确认 → 轮询换 JWT。 */
export async function login(ctx: Ctx, args: Args): Promise<void> {
  const base = resolveBase(ctx, args.flags);
  const clientName = String(args.flags.name || `video-canvas-cli@${os.hostname()}`);
  const start = await request<DeviceStart>({
    base,
    method: "POST",
    path: "/auth/cli/device",
    body: { client_name: clientName.slice(0, 64) },
    fetchImpl: ctx.fetchImpl,
  });

  // 授权页在网页那一侧：默认按 API 地址推，API 与网页不同域时用 --web / VC_WEB_URL 指定
  const webFlag = typeof args.flags.web === "string" ? args.flags.web : undefined;
  let site: string;
  try {
    site = webRoot(webFlag || ctx.env.VC_WEB_URL, base);
  } catch (err) {
    throw new APIError(-1, errorMessage(err), 2);
  }
  const url = `${site}${start.verification_uri_complete}`;
  // 授权地址始终写 stderr：--json 时 stdout 只留最终一行 JSON，但脚本/用户必须知道去哪儿点确认，
  // 否则登录会一直等到超时（早期版本就是因为把它关在 !ctx.json 里，--json 登录实际不可用）。
  ctx.stderr(`请在浏览器打开：${url}`);
  ctx.stderr(
    `并核对页面上的用户码与这里一致：${start.user_code}（不是你本人发起的登录，请不要点同意）`,
  );
  if (boolFlag(args.flags, "no-open")) {
    ctx.stderr("（已按 --no-open 跳过自动打开浏览器）");
  } else {
    ctx.stderr("（已尝试自动打开浏览器；打不开就复制上面的地址，或加 --no-open 跳过）");
    openBrowser(url);
  }

  let interval = Math.max(1, Number(start.interval) || 5) * 1000;
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    // 网络抖动、服务端 5xx 不该让已经点了同意的人重来：退避重试到设备码过期为止
    const poll = await withRetry(
      () =>
        request<DevicePoll>({
          base,
          method: "POST",
          path: "/auth/cli/token",
          body: { device_code: start.device_code },
          fetchImpl: ctx.fetchImpl,
        }),
      { deadline, onRetry: (err, n, wait) => ctx.stderr(retryNotice(err, n, wait)) },
    );
    switch (poll.status) {
      case "approved": {
        saveCredentials(
          {
            base,
            token: poll.token,
            expire_at: poll.expire_at,
            role: poll.role,
            client_name: clientName,
          },
          ctx.env,
        );
        emit(
          ctx,
          { base, role: poll.role, expire_at: poll.expire_at },
          `已登录（${poll.role}），凭据保存在 ${ctx.credsPath}`,
        );
        return;
      }
      case "denied":
        throw new APIError(-1, "授权被拒绝", 0);
      case "expired":
        throw new APIError(-1, "授权已过期，请重新执行登录", 0);
      case "consumed":
        throw new APIError(-1, "这个设备码已经被使用，请重新执行登录", 0);
      case "slow_down":
        interval += 5000;
        break;
      default:
        // pending：继续等
        break;
    }
  }
  throw new APIError(-1, "等待授权超时，请重新执行登录", 0);
}

/**
 * 退出登录：只清本地凭据。服务端的登录态是自包含的 JWT，没有吊销接口，
 * 要到期（默认 30 天）或在网页上改密码才会失效——所以输出里必须如实说明，不能让人以为已经「退出」了服务端。
 */
export async function logout(ctx: Ctx): Promise<void> {
  const removed = clearCredentials(ctx.env);
  const note = "注意：这只清除了本机凭据；服务端的登录态要到期或改密码后才会失效。";
  emit(
    ctx,
    { removed, server_session_revoked: false },
    [removed ? `已删除本地凭据（${ctx.credsPath}）` : "本地没有已保存的凭据", note].join("\n"),
  );
}

/** 当前身份：调 /me 验证令牌仍然有效。 */
export async function whoami(ctx: Ctx): Promise<void> {
  const token = requireToken(ctx);
  const base = baseOf(ctx);
  const me = await request<Me>({ base, token, path: "/me", fetchImpl: ctx.fetchImpl });
  const name = me.nickname || me.username;
  emit(
    ctx,
    { user: me, base },
    [`用户：${name}（${me.role}）`, `账号：${me.username}`, `接口：${base}`].join("\n"),
  );
}
