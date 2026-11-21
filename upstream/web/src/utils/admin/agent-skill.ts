import type {
  DramaStepKey,
  SkillFile,
  SkillImportView,
  SkillIssue,
  SkillIssueLevel,
  SkillItem,
} from "@/api/admin/agent-skill/type.d";

/** 字节数换算成 B / KB / MB，1 位小数 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * 文件清单里的类型标签：说明 / 脚本·语言 / 二进制 / 文档 / 资源 / 其他。
 * 不能按文本预览的非说明文件一律标“二进制”，让管理员一眼知道 Agent 读不到它的内容
 */
export function fileTagLabel(file: SkillFile): string {
  if (file.kind === "skill") return "说明";
  if (file.kind === "script") return file.lang ? `脚本·${file.lang}` : "脚本";
  if (!file.text) return "二进制";
  if (file.kind === "doc") return "文档";
  if (file.kind === "asset") return "资源";
  return "其他";
}

/** 问题级别的中文名：文字和图标一起表达，不只靠颜色 */
export const ISSUE_LEVEL_LABEL: Record<SkillIssueLevel, string> = {
  error: "错误",
  warn: "提示",
  info: "信息",
};

const LEVEL_RANK: Record<SkillIssueLevel, number> = { error: 0, warn: 1, info: 2 };

/** 问题按严重程度排序：错误、提示、信息；同级保持原顺序。返回新数组 */
export function sortIssues(issues: readonly SkillIssue[] | null | undefined): SkillIssue[] {
  return [...(issues ?? [])].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** 各级问题数量；problems 不含信息级（“问题 N”徽标用它） */
export function countIssues(issues: readonly SkillIssue[] | null | undefined) {
  const count = { error: 0, warn: 0, info: 0, problems: 0 };
  for (const item of issues ?? []) count[item.level] += 1;
  count.problems = count.error + count.warn;
  return count;
}

/** 每个文件路径上最严重的问题级别，给文件树画圆点；信息级和整包级问题不标记 */
export function issueLevelByPath(
  issues: readonly SkillIssue[] | null | undefined,
): Map<string, "error" | "warn"> {
  const map = new Map<string, "error" | "warn">();
  for (const item of issues ?? []) {
    if (!item.path || item.level === "info") continue;
    if (map.get(item.path) === "error") continue;
    map.set(item.path, item.level);
  }
  return map;
}

/** 文件树节点 */
export type FileTreeNode = {
  /** 目录或文件 */
  kind: "dir" | "file";
  /** 显示名（路径最后一段） */
  name: string;
  /** 完整路径；目录没有尾部斜杠 */
  path: string;
  /** 子节点，文件为空数组 */
  children: FileTreeNode[];
  /** 文件的清单项，目录没有 */
  file?: SkillFile;
};

const byName = (a: FileTreeNode, b: FileTreeNode) => a.name.localeCompare(b.name);

function sortNodes(nodes: FileTreeNode[], root: boolean) {
  const dirs = nodes.filter((n) => n.kind === "dir").sort(byName);
  const files = nodes.filter((n) => n.kind === "file").sort(byName);
  if (root) {
    const index = files.findIndex((n) => n.name.toLowerCase() === "skill.md");
    if (index > 0) files.unshift(...files.splice(index, 1));
  }
  for (const dir of dirs) dir.children = sortNodes(dir.children, false);
  return [...dirs, ...files];
}

/** 把扁平的文件清单整理成树：目录在前、文件在后；根下 SKILL.md 排在文件最前 */
export function buildFileTree(files: readonly SkillFile[] | null | undefined): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirs = new Map<string, FileTreeNode>();
  for (const file of files ?? []) {
    const parts = file.path.split("/");
    let level = root;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let dir = dirs.get(acc);
      if (!dir) {
        dir = { kind: "dir", name: parts[i], path: acc, children: [] };
        dirs.set(acc, dir);
        level.push(dir);
      }
      level = dir.children;
    }
    level.push({
      kind: "file",
      name: parts[parts.length - 1],
      path: file.path,
      children: [],
      file,
    });
  }
  return sortNodes(root, true);
}

/** 展开后看得见的行（带缩进层级），文件树渲染和 ↑↓ 切换文件都用它 */
export function visibleTreeRows(
  tree: readonly FileTreeNode[],
  collapsed: ReadonlySet<string>,
): { node: FileTreeNode; depth: number }[] {
  const rows: { node: FileTreeNode; depth: number }[] = [];
  const walk = (nodes: readonly FileTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.kind === "dir" && !collapsed.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

/** 在文本里找第一次出现 needle 的行号（从 1 起）；MISSING_REF 靠它定位到引用处 */
export function locateLine(text: string, needle: string): number | null {
  if (!needle) return null;
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  return index < 0 ? null : index + 1;
}

/** 预检横幅的色调：有错误或不能确认为红，仅提示为黄，其余为绿 */
export function bannerTone(view: SkillImportView): "ok" | "warn" | "bad" {
  const count = countIssues(view.issues);
  if (count.error > 0 || !view.can_confirm) return "bad";
  return count.warn > 0 ? "warn" : "ok";
}

/** 确认按钮被禁用的原因；可以确认时为 null */
export function confirmBlockReason(view: SkillImportView): string | null {
  if (view.can_confirm) return null;
  const errors = countIssues(view.issues).error;
  return errors > 0 ? `有 ${errors} 个错误需要先处理` : "预检未通过，不能导入";
}

/** “将要发生什么”的一句话：被拦住时直接用后端给出的第一条错误说明 */
export function planSummary(view: SkillImportView): string {
  const { plan, name } = view;
  if (plan.action === "create") return `将创建技能 ${name}，v${plan.version ?? 1}`;
  if (plan.action === "new_version") {
    const active = plan.active_version == null ? "" : `；当前生效版本仍是 v${plan.active_version}`;
    return `将为 ${name} 新增 v${plan.version ?? ""}${active}，需要你在详情里手动切换`;
  }
  return sortIssues(view.issues).find((i) => i.level === "error")?.message ?? "存在错误，无法导入";
}

/** 列表的筛选项（后端按使用场景过滤） */
export type SkillListFilter = "all" | "agent" | "drama" | "unused" | "builtin";

/** 技能的使用场景：画布 Agent（enabled）或一个短剧环节（drama_steps 里的一项） */
export type SkillScopeKey = "agent" | DramaStepKey;

/** 六个使用场景，顺序即界面顺序；name 是详情里的全称，short 是列表标签 */
export const SKILL_SCOPES: {
  key: SkillScopeKey;
  name: string;
  short: string;
  group: "canvas" | "drama";
}[] = [
  { key: "agent", name: "画布 Agent", short: "画布 Agent", group: "canvas" },
  { key: "plan", name: "分集规划", short: "规划", group: "drama" },
  { key: "scripts", name: "分集剧本", short: "剧本", group: "drama" },
  { key: "assets", name: "资产拆解", short: "拆解", group: "drama" },
  { key: "asset_prompts", name: "资产图提示词", short: "资产图", group: "drama" },
  { key: "video", name: "视频提示词", short: "视频", group: "drama" },
];

/** 场景是否开着 */
export function scopeOn(item: SkillItem, scope: SkillScopeKey): boolean {
  return scope === "agent" ? item.enabled : item.drama_steps.includes(scope);
}

/** 开着的场景，按固定顺序（列表标签、“在用 N 处”用它） */
export function scopeTags(item: SkillItem) {
  return SKILL_SCOPES.filter((scope) => scopeOn(item, scope.key));
}

/** 改一个场景后的技能视图（乐观更新用）：短剧环节按固定顺序，in_use 同步；不改原对象 */
export function withScope(item: SkillItem, scope: SkillScopeKey, on: boolean): SkillItem {
  const enabled = scope === "agent" ? on : item.enabled;
  const drama_steps =
    scope === "agent"
      ? item.drama_steps
      : SKILL_SCOPES.flatMap(({ key }) =>
          key !== "agent" && (key === scope ? on : item.drama_steps.includes(key)) ? [key] : [],
        );
  return { ...item, enabled, drama_steps, in_use: enabled || drama_steps.length > 0 };
}

/** 场景开关被禁用的原因；可用时为 null。没有生效版本时不能打开，但已开的可以关 */
export function scopeBlockReason(item: SkillItem, scope: SkillScopeKey): string | null {
  if (item.readonly) return "内置技能随版本发布，不能修改";
  if (!scopeOn(item, scope) && item.active_version == null) return "没有生效版本，无法启用";
  return null;
}

/** 生效版本列的内容：内置显示“—”；有更新版本未生效时附带“vN 待生效” */
export function versionBadge(item: SkillItem): { active: string; pending: string | null } {
  if (item.source === "builtin" || item.active_version == null) {
    return { active: "—", pending: null };
  }
  return {
    active: `v${item.active_version}`,
    pending: item.pending_version ? `v${item.latest_version} 待生效` : null,
  };
}

/** 删除技能被禁用的原因；可删除时为 null */
export function deleteBlockReason(item: SkillItem): string | null {
  if (item.readonly) return "内置技能不能删除";
  if (item.enabled || item.drama_steps.length > 0) return "请先关闭所有使用场景";
  return null;
}

/**
 * 去掉文件开头的 frontmatter 块（--- … ---），渲染态只显示正文，头部字段另用卡片展示。
 * @returns 正文，以及被去掉的行数（源码行号对照用）
 */
export function stripFrontmatter(text: string): { body: string; skippedLines: number } {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*\r?\n/.test(normalized)) return { body: text, skippedLines: 0 };
  const lines = normalized.split(/\r?\n/);
  const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
  if (end < 0) return { body: text, skippedLines: 0 };
  return {
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\n+/, ""),
    skippedLines: end + 1,
  };
}

/**
 * 导入成功后的 toast 文案：新技能写明用在几处；同名技能新增版本但生效版本不变
 * @param scopeCount 新技能确认时打开的场景数
 */
export function importedMessage(view: SkillImportView, scopeCount: number): string {
  if (view.plan.action === "new_version") {
    return `已为「${view.name}」新增 v${view.plan.version ?? ""}，生效版本不变，需要在详情里手动切换`;
  }
  return scopeCount > 0
    ? `已导入「${view.name}」，用在 ${scopeCount} 处`
    : `已导入「${view.name}」，暂未使用`;
}

/** 列表“更新”列：一分钟内“刚刚”，一小时内按分钟，一天内按小时，一周内按天，更早给日期；解析不了原样返回 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 60 / 24)} 天前`;
  return formatDateTime(iso).slice(0, 10);
}

/** 后端给的 ISO 时间显示成“2026-10-07 12:30”；解析不了原样返回 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 版本在时间线上的状态：生效中、比生效版本新的待生效、更早的历史版本 */
export function versionState(
  version: number,
  activeVersion: number | null,
): "active" | "pending" | "history" {
  if (version === activeVersion) return "active";
  return activeVersion != null && version > activeVersion ? "pending" : "history";
}
