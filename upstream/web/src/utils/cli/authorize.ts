import { ApiError } from "@/utils/requests/request";

/** 后端错误码：用户码不对或已过期 */
const CODE_USER_CODE_INVALID = 20013;
/** 后端错误码：设备码无效或已过期 */
const CODE_DEVICE_INVALID = 20010;

/**
 * 把用户输入的用户码规范成库里的写法：去掉连字符与空白，转大写。
 * 与后端 normalizeUserCode 同口径，所以 `abcd efgh`、`ABCD-EFGH` 都算同一个码。
 * @param raw 输入
 */
export function normalizeUserCode(raw: string): string {
  return raw.replace(/[-\s]/g, "").toUpperCase();
}

/**
 * 能否点「同意授权」：用户亲手输入的码必须和这次申请的用户码一致。
 * 防钓鱼的关键一步——带 code 的链接可以被别人发给你，但只有发起命令的人才能在终端里看到码；
 * 期望的码为空（服务端没给）时一律不放行。
 * @param typed 用户输入的码
 * @param expected 这次申请的用户码
 */
export function canApprove(typed: string, expected: string): boolean {
  const want = normalizeUserCode(expected);
  return want !== "" && normalizeUserCode(typed) === want;
}

/** 读取申请失败后页面该怎么走 */
export interface DescribeFailure {
  /** login：登录态失效，跳登录页；code：码不对或过期；other：网络等其它原因 */
  kind: "login" | "code" | "other";
  message: string;
}

/**
 * 区分读取设备申请时的失败：401 要重新登录，码错要重跑命令，其余把真实原因给用户看。
 * @param error 请求层抛出的错误
 */
export function classifyDescribeError(error: unknown): DescribeFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "login", message: "登录已失效，请重新登录" };
    if (error.code === CODE_USER_CODE_INVALID || error.code === CODE_DEVICE_INVALID) {
      return { kind: "code", message: "用户码不对或已过期，请在命令行重新执行登录。" };
    }
    return { kind: "other", message: error.message || "读取授权申请失败，请稍后重试" };
  }
  return { kind: "other", message: "读取授权申请失败，请稍后重试" };
}

/** 授权页的几种画面 */
export type DeviceView = "confirm" | "approved" | "consumed" | "denied" | "expired";

/**
 * 申请状态对应的画面。「已同意」和「已被命令行取走」分开：后者说明令牌已经发出去了，
 * 不能再写成「已授权」让人以为还能撤回；未知状态当作失效，不放行。
 * @param status 后端 status
 */
export function deviceView(status: string): DeviceView {
  switch (status) {
    case "pending":
      return "confirm";
    case "approved":
      return "approved";
    case "consumed":
      return "consumed";
    case "denied":
      return "denied";
    default:
      return "expired";
  }
}
