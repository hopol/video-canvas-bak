import { describe, expect, test } from "bun:test";

import { ApiError } from "@/utils/requests/request";
import {
  canApprove,
  classifyDescribeError,
  deviceView,
  normalizeUserCode,
} from "@/utils/cli/authorize";

describe("授权页：用户码输入闸门", () => {
  test("规范化：去掉连字符与空格并转大写，与后端口径一致", () => {
    expect(normalizeUserCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeUserCode("ab cd\tef-gh")).toBe("ABCDEFGH");
  });

  test("输入与终端上的码一致才允许同意，大小写与连字符不敏感", () => {
    expect(canApprove("abcd efgh", "ABCD-EFGH")).toBe(true);
    expect(canApprove("ABCDEFGH", "ABCD-EFGH")).toBe(true);
  });

  test("没输、少输、输错都不允许同意", () => {
    expect(canApprove("", "ABCD-EFGH")).toBe(false);
    expect(canApprove("ABCD", "ABCD-EFGH")).toBe(false);
    expect(canApprove("ABCD-EFGX", "ABCD-EFGH")).toBe(false);
  });

  test("服务端没给码时不放行：两边都是空也不算一致", () => {
    expect(canApprove("", "")).toBe(false);
    expect(canApprove("-", "")).toBe(false);
  });
});

describe("授权页：读取失败要分清原因", () => {
  test("401：登录态没了，走登录跳转，不能说成用户码不对", () => {
    expect(classifyDescribeError(new ApiError("未登录", "HTTP_401", 401)).kind).toBe("login");
  });

  test("用户码不对或已过期（20013）与设备码无效（20010）：提示重新执行登录", () => {
    for (const code of [20013, 20010]) {
      const out = classifyDescribeError(new ApiError("用户码不对或已过期", code, 400));
      expect(out.kind).toBe("code");
      expect(out.message).toContain("重新执行登录");
    }
  });

  test("网络异常、超时、服务端错误：显示真实原因，不当成码错", () => {
    const network = classifyDescribeError(
      new ApiError("网络异常，请检查后端服务", "NETWORK_ERROR", 0),
    );
    expect(network).toEqual({ kind: "other", message: "网络异常，请检查后端服务" });
    const server = classifyDescribeError(new ApiError("服务器开小差了", "HTTP_500", 500));
    expect(server).toEqual({ kind: "other", message: "服务器开小差了" });
  });

  test("不是 ApiError 的异常也有兜底文案", () => {
    expect(classifyDescribeError(new Error("boom"))).toEqual({
      kind: "other",
      message: "读取授权申请失败，请稍后重试",
    });
    expect(classifyDescribeError("x").kind).toBe("other");
  });
});

describe("授权页：申请状态对应的页面", () => {
  test("待确认进确认卡片", () => {
    expect(deviceView("pending")).toBe("confirm");
  });

  test("已同意与已被命令行取走是两回事，文案不能混", () => {
    expect(deviceView("approved")).toBe("approved");
    expect(deviceView("consumed")).toBe("consumed");
  });

  test("已拒绝、已过期各走各的；未知状态当作失效而不是放行", () => {
    expect(deviceView("denied")).toBe("denied");
    expect(deviceView("expired")).toBe("expired");
    expect(deviceView("whatever")).toBe("expired");
  });
});
