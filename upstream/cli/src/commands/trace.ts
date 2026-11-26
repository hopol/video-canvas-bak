// 运行记录：转发到用户明确指定的 agent-trace 脚本。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { APIError } from "../client.ts";
import type { Args, Ctx, Flags } from "../types.ts";

/**
 * 转发到 agent-trace.mjs 的 pull / show / compare。
 * 不复制实现：那份脚本已被 /agent-review skill 和文档引用，保持单一来源。
 *
 * 这个命令会**执行一个脚本**，所以脚本的来源必须由用户明确给出（--script 或 VC_AGENT_TRACE），
 * 并在执行前提示风险。不再从当前目录、仓库相对路径里「顺手找」——
 * 在一个不可信目录里敲 `vc trace`，不能让那个目录里放好的脚本跑起来。
 */
export function trace(ctx: Ctx, args: Args): void {
  const script = resolveTraceScript(ctx, args);
  ctx.stderr(`将执行 ${script}：这个脚本会以你的权限运行，请确认它的来源可信。`);
  const child = spawn(process.execPath, [script, ...args.positional, ...flagsToArgv(args.flags)], {
    stdio: "inherit",
    env: ctx.env,
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 0);
  });
}

/** 定位 agent-trace：只认显式参数（--script）或环境变量（VC_AGENT_TRACE）。 */
function resolveTraceScript(ctx: Ctx, args: Args): string {
  const explicit = args.flags.script ?? ctx.env.VC_AGENT_TRACE;
  if (explicit === undefined)
    throw new APIError(
      -1,
      [
        "找不到 agent-trace：出于安全，trace 不会自动执行当前目录或仓库里的脚本，需要你明确指定。",
        "请用 `vc trace ... --script <仓库>/scripts/agent-trace/agent-trace.mjs`，",
        "或设置环境变量 VC_AGENT_TRACE 指向该文件。",
      ].join("\n"),
      2,
    );
  if (explicit === true || typeof explicit !== "string")
    throw new APIError(-1, "--script 需要 agent-trace.mjs 的路径", 2);
  const target = path.resolve(explicit);
  if (!fs.existsSync(target)) throw new APIError(-1, `找不到 agent-trace：${target}`, 2);
  return target;
}

function flagsToArgv(flags: Flags): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(flags)) {
    // --json / --base / --script 是本 CLI 的选项，agent-trace 不认，不能透传
    if (key === "help" || key === "json" || key === "base" || key === "script") continue;
    if (value === true) out.push(`--${key}`);
    else out.push(`--${key}`, String(value));
  }
  return out;
}
