import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CLIDeviceInfo } from "@/api/auth/cli-device";
import { AuthorizeConfirm } from "@/pages/cli/authorize-confirm";

const device: CLIDeviceInfo = {
  user_code: "ABCD-EFGH",
  client_name: "官方客服工具",
  status: "pending",
  created_at: "2026-11-24T08:00:00Z",
  expires_at: "2026-11-24T08:10:00Z",
  client_ip: "203.0.113.7",
};

/** 禁用的按钮会带这个属性；类名里的 `disabled:` 变体不算 */
const DISABLED = ' disabled=""';

const noop = () => {};

const render = (overrides: { typed?: string; info?: CLIDeviceInfo; submitting?: boolean } = {}) =>
  renderToStaticMarkup(
    <AuthorizeConfirm
      device={overrides.info ?? device}
      account="alice"
      typed={overrides.typed ?? ""}
      submitting={overrides.submitting ?? false}
      onTypedChange={noop}
      onApprove={noop}
      onDeny={noop}
    />,
  );

/** 取出某个按钮的开始标签，用来判断它是否被禁用 */
const buttonTag = (html: string, label: string) => {
  const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`));
  return match?.[0] ?? "";
};

describe("授权确认卡片", () => {
  test("展示这次授权的关键信息：账号、发起时间、发起 IP，调用方名称标注为自报", () => {
    const html = render();
    expect(html).toContain("alice");
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("官方客服工具");
    expect(html).toContain("自报");
    expect(html).toContain("发起时间");
  });

  test("后端没给 IP 时显示「未知」，不留空", () => {
    expect(render({ info: { ...device, client_ip: undefined } })).toContain("未知");
  });

  test("不把用户码印在页面上：码只能由终端那边的人读出来再输入", () => {
    expect(render()).not.toContain("ABCD-EFGH");
  });

  test("没输码或输错时「同意授权」不可点，「拒绝」始终可点", () => {
    for (const typed of ["", "ABCD", "ABCD-EFGX"]) {
      const html = render({ typed });
      expect(buttonTag(html, "同意授权")).toContain(DISABLED);
      expect(buttonTag(html, "拒绝")).not.toContain(DISABLED);
    }
  });

  test("输对码（大小写与连字符不敏感）后才能同意", () => {
    expect(buttonTag(render({ typed: "abcdefgh" }), "同意授权")).not.toContain(DISABLED);
  });

  test("提交中两个按钮都不可点", () => {
    const html = render({ typed: "ABCD-EFGH", submitting: true });
    expect(buttonTag(html, "同意授权")).toContain(DISABLED);
    expect(buttonTag(html, "拒绝")).toContain(DISABLED);
  });
});
