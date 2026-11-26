import { describe, expect, test } from "bun:test";

import {
  CLI_INSTALL_COMMAND,
  buildCLIAgentPrompt,
  cliInstallCommands,
  copyCLIAgentPrompt,
} from "@/utils/cli/install";

const API_BASE = "https://canvas.example.com/api/v1";

describe("一键安装命令", () => {
  test("手动安装命令：npm 直接装 GitHub 最新 Release 的安装包", () => {
    expect(CLI_INSTALL_COMMAND).toBe(
      "npm i -g https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.tgz",
    );
  });

  test("三个平台的命令都指向后端下发的安装脚本（按接口地址拼）", () => {
    expect(cliInstallCommands(API_BASE)).toEqual({
      unix: "curl -fsSL https://canvas.example.com/api/v1/cli/install.sh | sh",
      powershell: "irm https://canvas.example.com/api/v1/cli/install.ps1 | iex",
      cmd: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://canvas.example.com/api/v1/cli/install.ps1 | iex"',
    });
  });

  test("接口地址末尾的斜杠不会拼出双斜杠", () => {
    expect(cliInstallCommands(`${API_BASE}/`).unix).toBe(
      "curl -fsSL https://canvas.example.com/api/v1/cli/install.sh | sh",
    );
  });
});

describe("给 Agent 的安装提示", () => {
  test("按系统列出三条安装命令，再给本站的登录命令", () => {
    const prompt = buildCLIAgentPrompt(API_BASE);
    const cmds = cliInstallCommands(API_BASE);
    expect(prompt).toContain(`macOS / Linux: ${cmds.unix}`);
    expect(prompt).toContain(`Windows PowerShell: ${cmds.powershell}`);
    expect(prompt).toContain(`Windows CMD: ${cmds.cmd}`);
    expect(prompt).toContain(`vc login --base ${API_BASE}`);
    expect(prompt.indexOf("macOS / Linux")).toBeLessThan(prompt.indexOf("vc login"));
  });

  test("提示要求安装后阅读技能并引导用户完成验证、登录和授权", () => {
    const prompt = buildCLIAgentPrompt(API_BASE);
    expect(prompt).toContain("安装后请阅读 Skill，引导我完成可用性验证、登录和授权。");
  });

  test("复制的是整段提示，成功后提示已复制", async () => {
    const copied: string[] = [];
    const messages: string[] = [];
    const ok = await copyCLIAgentPrompt(API_BASE, {
      copy: async (text) => {
        copied.push(text);
        return true;
      },
      success: (message) => messages.push(`ok:${message}`),
      failure: (message) => messages.push(`fail:${message}`),
    });
    expect(ok).toBe(true);
    expect(copied).toEqual([buildCLIAgentPrompt(API_BASE)]);
    expect(messages).toEqual(["ok:已复制，粘贴给你的 Agent 即可"]);
  });

  test("剪贴板不可用时如实提示失败，并指向安装页", async () => {
    const messages: string[] = [];
    const ok = await copyCLIAgentPrompt(API_BASE, {
      copy: async () => false,
      success: (message) => messages.push(`ok:${message}`),
      failure: (message) => messages.push(`fail:${message}`),
    });
    expect(ok).toBe(false);
    expect(messages).toEqual(["fail:复制失败，请到「命令行（CLI）」页手动复制"]);
  });
});
