// 随包技能：告诉用户技能目录在哪，或直接装进终端助手的技能目录。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APIError } from "../client.ts";
import { listFlag } from "./args.ts";
import { emit } from "./shared.ts";
import type { Args, Ctx } from "../types.ts";

/** 装进各助手技能目录时用的子目录名：重装只替换它，不碰同级的其它技能。 */
const SKILL_DIR_NAME = "video-canvas-cli";

const USAGE =
  "用法：skill path（打印随包技能目录）| skill install [--to <技能目录>]（装进终端助手）";

/** 随包技能目录：源码在 src/commands/、产物在 dist/commands/，往上两级都是包根（skill/ 就在那里）。 */
function bundledSkillDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "skill");
}

function requireBundledSkill(): string {
  const dir = bundledSkillDir();
  if (!fs.existsSync(path.join(dir, "SKILL.md")))
    throw new APIError(-1, `安装包里没有找到技能目录（${dir}），请重新安装 video-canvas-cli`, 0);
  return dir;
}

interface SkillTarget {
  agent: string;
  /** 助手的技能根目录（例如 ~/.claude/skills），技能装在它下面的 video-canvas-cli/ */
  skillsDir: string;
}

/**
 * 默认装到哪些助手：Claude Code 总是装（最常见，目录不存在就建）；
 * 其余助手只在它的主目录已经存在时才装，不替没装过的助手凭空建目录。
 */
function defaultTargets(home: string): SkillTarget[] {
  const targets: SkillTarget[] = [
    { agent: "Claude Code", skillsDir: path.join(home, ".claude", "skills") },
  ];
  const optional: Array<[string, string]> = [
    ["Codex", ".codex"],
    ["通用 Agent 技能目录", ".agents"],
  ];
  for (const [agent, root] of optional) {
    if (fs.existsSync(path.join(home, root)))
      targets.push({ agent, skillsDir: path.join(home, root, "skills") });
  }
  return targets;
}

/** 整个替换目标目录：升级后旧版本多出来的文件不能留下，否则助手会读到过时的说明。 */
function installTo(source: string, target: SkillTarget): string {
  const dest = path.join(target.skillsDir, SKILL_DIR_NAME);
  fs.mkdirSync(target.skillsDir, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(source, dest, { recursive: true });
  return dest;
}

function skillPath(ctx: Ctx): void {
  const dir = requireBundledSkill();
  emit(
    ctx,
    {
      path: dir,
      install: {
        command: "vc skill install",
        unix: `mkdir -p ~/.claude/skills && cp -R "${dir}" ~/.claude/skills/${SKILL_DIR_NAME}`,
        windows:
          `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.claude\\skills" | Out-Null; ` +
          `Copy-Item -Recurse -Force "${dir}" "$env:USERPROFILE\\.claude\\skills\\${SKILL_DIR_NAME}"`,
      },
    },
    [
      dir,
      "",
      "装进终端助手的技能目录：vc skill install",
      "  默认装进 Claude Code；已装 Codex 的也一并装。其它助手用 --to <它的技能目录>。",
      "升级 CLI 之后重新执行一次，技能内容才会跟着更新。",
    ].join("\n"),
  );
}

function skillInstall(ctx: Ctx, args: Args): void {
  const source = requireBundledSkill();
  const custom = listFlag(args.flags, "to");
  const targets: SkillTarget[] =
    custom.length > 0
      ? custom.map((dir) => ({ agent: "custom", skillsDir: path.resolve(dir) }))
      : defaultTargets(os.homedir());

  const installed = targets.map((target) => ({
    agent: target.agent,
    path: installTo(source, target),
  }));
  emit(
    ctx,
    { installed },
    [
      "技能已装好：",
      ...installed.map(
        (item) => `  ${item.agent === "custom" ? "指定目录" : item.agent}  ${item.path}`,
      ),
      "重开助手的会话后生效；升级 CLI 后再执行一次 vc skill install。",
    ].join("\n"),
  );
}

/**
 * skill path：打印随包技能目录。
 * skill install：把技能装进终端助手（Claude Code / Codex 等）的技能目录，安装脚本最后一步也调它。
 * CLI 是用 `npm i -g` 装的，技能在 npm 的全局目录里，路径不好猜，所以做成命令。
 */
export async function skill(ctx: Ctx, args: Args): Promise<void> {
  const [sub] = args.positional;
  if (sub === "path") return skillPath(ctx);
  if (sub === "install") return skillInstall(ctx, args);
  throw new APIError(-1, USAGE, 2);
}
