#!/usr/bin/env node
// 约束「改功能的人在 CHANGELOG.md 的 [Unreleased] 里写日志」。只用 Node 内置模块，兼容 Node 16。
//
// 用法：
//   node scripts/changelog-check.mjs commit-msg <消息文件>  # pre-commit 的 commit-msg 钩子
//   node scripts/changelog-check.mjs pr <基准分支>          # CI：检查 PR 相对基准分支的改动
//   node scripts/changelog-check.mjs lint                   # 只检查 Unreleased 的格式
//
// 规则：feat / fix / perf 和破坏性变更（type! 或 BREAKING CHANGE:）要在 [Unreleased] 新增条目；
// 提交正文写 `Changelog: skip`、或 PR 打 skip-changelog 标签（CI 传 CHANGELOG_SKIP=1）可豁免。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = "CHANGELOG.md";
const SECTIONS = ["新增", "改进", "修复", "废弃", "破坏性变更", "文档"];
const NEEDS_TYPES = new Set(["feat", "fix", "perf"]);

const HOW_TO = [
  `在 ${FILE} 的 ## [Unreleased] 下对应小节（${SECTIONS.join(" / ")}）加一条面向用户的中文描述，例如：`,
  "",
  "  ## [Unreleased]",
  "",
  "  ### 新增",
  "",
  "  - 画布支持节点分组。",
  "",
  "确实没有用户可感知的变化时：提交正文加一行 `Changelog: skip`，PR 则打 skip-changelog 标签。",
].join("\n");

/** 提交信息是否要求写日志；会去掉 git 的 # 注释行。 */
export function needsChangelog(message) {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const subject = (lines[0] || "").trim();
  if (/^(Merge |Revert |fixup! |squash! |amend! )/.test(subject)) return false;
  if (lines.some((line) => /^changelog:\s*skip\s*$/i.test(line.trim()))) return false;
  const match = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
  if (match && match[3]) return true;
  if (lines.some((line) => /^BREAKING[ -]CHANGE:/.test(line))) return true;
  return Boolean(match) && NEEDS_TYPES.has(match[1].toLowerCase());
}

/** [Unreleased] 标题之后、下一个二级标题之前的行；没有该标题时返回 null。 */
function unreleasedLines(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^## \[Unreleased\]\s*$/i.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** newText 的 [Unreleased] 里有、oldText 里没有的条目。 */
export function newUnreleasedEntries(oldText, newText) {
  const entries = (text) => (unreleasedLines(text) || []).filter((line) => line.startsWith("- ")).map((line) => line.trim());
  const old = new Set(entries(oldText));
  return entries(newText).filter((entry) => !old.has(entry));
}

/** [Unreleased] 的格式问题：只允许约定的小节名，条目写在小节下、以 "- " 开头，续行缩进。 */
export function lintUnreleased(text) {
  const lines = unreleasedLines(text);
  if (lines === null) return [`${FILE} 缺少 "## [Unreleased]" 标题，发版后也要在顶部保留它`];
  const errors = [];
  let section = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      if (!SECTIONS.includes(section)) errors.push(`[Unreleased] 里的小节「${section}」不在约定范围内：${SECTIONS.join(" / ")}`);
    } else if (line.startsWith("- ")) {
      if (section === null) errors.push(`条目要写在「### 小节」下面：${line}`);
    } else if (!/^\s+\S/.test(line)) {
      errors.push(`[Unreleased] 里只能有「### 小节」和以 "- " 开头的条目：${line}`);
    }
  }
  return errors;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function gitShow(rev) {
  try {
    return git("show", `${rev}:${FILE}`);
  } catch {
    return "";
  }
}

function fail(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

function checkCommitMsg(messageFile) {
  const message = readFileSync(messageFile, "utf8");
  if (!needsChangelog(message)) return;
  const staged = gitShow("");
  const subject = message.split("\n")[0].trim();
  // git commit --amend 时 HEAD 就是被修改的提交，日志可能已经在里面，此时和它的父提交比
  let base = "HEAD";
  try {
    if (git("log", "-1", "--format=%s", "HEAD").trim() === subject) base = "HEAD~1";
  } catch {
    // 仓库第一个提交，没有 HEAD
  }
  if (newUnreleasedEntries(gitShow(base), staged).length === 0) {
    fail([`✗ 「${subject}」是用户可感知的变更，但这次提交没有在 ${FILE} 的 [Unreleased] 新增条目。`, "", HOW_TO]);
  }
  const errors = lintUnreleased(staged);
  if (errors.length > 0) fail(["✗ CHANGELOG 格式问题：", ...errors.map((e) => `  - ${e}`)]);
}

function checkPullRequest(baseRef) {
  const errors = lintUnreleased(readFileSync(FILE, "utf8"));
  if (errors.length > 0) fail(["✗ CHANGELOG 格式问题：", ...errors.map((e) => `  - ${e}`)]);
  if (process.env.CHANGELOG_SKIP === "1") {
    console.log("PR 带 skip-changelog 标签，跳过 [Unreleased] 新增条目检查。");
    return;
  }
  const base = git("merge-base", baseRef, "HEAD").trim();
  const hashes = git("rev-list", "--no-merges", `${base}..HEAD`).split("\n").filter(Boolean);
  const needing = hashes
    .map((hash) => git("log", "-1", "--format=%B", hash))
    .filter(needsChangelog)
    .map((message) => message.split("\n")[0]);
  if (needing.length === 0) {
    console.log("PR 里没有 feat / fix / perf / 破坏性变更提交，无需新增日志。");
    return;
  }
  const added = newUnreleasedEntries(gitShow(base), readFileSync(FILE, "utf8"));
  if (added.length === 0) {
    fail([`✗ PR 里有用户可感知的提交，但 ${FILE} 的 [Unreleased] 没有新增条目：`, ...needing.map((s) => `  - ${s}`), "", HOW_TO]);
  }
  console.log(`[Unreleased] 新增 ${added.length} 条：\n${added.map((e) => `  ${e}`).join("\n")}`);
}

function main([mode, arg]) {
  if (mode === "commit-msg" && arg) return checkCommitMsg(arg);
  if (mode === "pr" && arg) return checkPullRequest(arg);
  if (mode === "lint") {
    const errors = lintUnreleased(readFileSync(FILE, "utf8"));
    if (errors.length > 0) fail(["✗ CHANGELOG 格式问题：", ...errors.map((e) => `  - ${e}`)]);
    return console.log("CHANGELOG [Unreleased] 格式正确。");
  }
  fail(["用法：changelog-check.mjs commit-msg <消息文件> | pr <基准分支> | lint"]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
