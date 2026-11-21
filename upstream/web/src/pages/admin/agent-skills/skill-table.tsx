import { Lightbulb } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { EmptyState, EmptyStateTitle } from "@/components/admin-ui/empty-state";
import { Tag } from "@/components/admin-ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { SKELETON_DELAY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative, scopeTags, versionBadge } from "@/utils/admin/agent-skill";

/** loading 持续超过 delay 毫秒才返回 true：缓存命中很快返回时不闪灰块 */
function useDelayedFlag(flag: boolean, delay: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [flag, delay]);
  return shown;
}

/** 新导入的行：一层铺满整行的浅紫，从 1 淡到 0（只动 opacity），播完停在透明 */
const FRESH_ROW =
  "relative after:pointer-events-none after:absolute after:inset-0 after:bg-violet-500/14 after:content-[''] after:animate-out after:fade-out-0 after:duration-240 after:fill-mode-forwards motion-reduce:after:duration-150";

/** 名称单元：图标块 + 显示名（内置带标签）；技能名和显示名不同时下面一行等宽小字 */
function NameCell({ item }: { item: SkillItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="bg-chrome ring-chrome-border text-muted-foreground grid size-8 shrink-0 place-items-center rounded-xl ring-1">
        <Lightbulb className="size-4" />
      </span>
      <span className="grid min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{item.title}</span>
          {item.readonly && <Tag className="shrink-0">内置</Tag>}
        </span>
        {item.title !== item.name && (
          <span className="text-muted-foreground truncate font-mono text-xs">{item.name}</span>
        )}
      </span>
    </div>
  );
}

/** 用在哪里：开着的场景按固定顺序排成小标签，悬停看全称；一个都没有时写“未使用” */
function ScopeTags({ item }: { item: SkillItem }) {
  const tags = scopeTags(item);
  if (tags.length === 0) return <span className="text-muted-foreground text-xs">未使用</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((scope) => (
        <Tag
          key={scope.key}
          data-slot="scope-tag"
          tone={scope.group === "canvas" ? "info" : "violet"}
          title={scope.group === "canvas" ? scope.name : `短剧 · ${scope.name}`}
        >
          {scope.short}
        </Tag>
      ))}
    </div>
  );
}

/** 生效版本：v2；有更新版本未生效时右侧琥珀“v3 待生效” */
function VersionCell({ item }: { item: SkillItem }) {
  const badge = versionBadge(item);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-sm tabular-nums">{badge.active}</span>
      {badge.pending && (
        <Tag tone="warning" className="tabular-nums">
          {badge.pending}
        </Tag>
      )}
    </div>
  );
}

/** 更新时间：相对时间，悬停看完整时间；内置技能随版本发布，没有更新时间 */
function UpdatedCell({ item }: { item: SkillItem }) {
  if (item.readonly) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground tabular-nums" title={formatDateTime(item.updated_at)}>
      {formatRelative(item.updated_at)}
    </span>
  );
}

/** 行上 Enter 打开详情 */
const openOnEnter = (event: KeyboardEvent<HTMLElement>, open: () => void) => {
  if (event.key === "Enter" && event.target === event.currentTarget) open();
};

/** ⌘ / Ctrl / 中键点击：在新标签页打开 */
const wantsNewTab = (event: MouseEvent) => event.metaKey || event.ctrlKey || event.button === 1;

/**
 * 技能列表：≥ 768 px 用表格，窄屏变卡片（名称 + 版本 / 说明 / 场景标签）。
 * 点行或在行上按 Enter 打开详情（⌘ / Ctrl 点击新标签页打开）；改使用场景要进详情。
 * 加载超过 150 ms 才显示骨架行；筛选无结果有说明。
 * @param items 已过滤的行
 * @param loading 首次加载中
 * @param freshName 刚导入的技能名，对应行一次性高亮
 * @param onOpen 打开详情；newTab 表示要在新标签页打开
 */
export function SkillTable({
  items,
  loading,
  freshName,
  onOpen,
}: {
  items: SkillItem[];
  loading: boolean;
  freshName: string | null;
  onOpen: (item: SkillItem, newTab?: boolean) => void;
}) {
  const mobile = useIsMobile();
  const showSkeleton = useDelayedFlag(loading, SKELETON_DELAY * 1000);

  if (loading) {
    return (
      <div data-slot="skill-table" aria-busy="true" className="flex flex-col">
        {showSkeleton &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="flex min-h-15 items-center gap-3 border-b px-4 last:border-b-0">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        {!showSkeleton && <div className="min-h-60" />}
      </div>
    );
  }

  const rowProps = (item: SkillItem) => ({
    "data-skill-name": item.name,
    tabIndex: 0,
    onClick: (event: MouseEvent) => onOpen(item, wantsNewTab(event)),
    onAuxClick: (event: MouseEvent) => event.button === 1 && onOpen(item, true),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => openOnEnter(event, () => onOpen(item)),
  });

  return (
    <div data-slot="skill-table" className="flex flex-col">
      {items.length === 0 ? (
        <EmptyState>
          <EmptyStateTitle>没有符合条件的技能</EmptyStateTitle>
        </EmptyState>
      ) : mobile ? (
        <ul className="flex flex-col gap-2.5 p-3">
          {items.map((item) => (
            <li
              key={item.name}
              role="button"
              {...rowProps(item)}
              className={cn(
                "bg-chrome ring-chrome-border ring-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 hover:bg-card focus-visible:ring-ring/50 grid gap-2 rounded-3xl p-4 transition-colors outline-none focus-visible:ring-2",
                item.name === freshName && FRESH_ROW,
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <NameCell item={item} />
                <VersionCell item={item} />
              </div>
              <p className="text-muted-foreground line-clamp-2 text-sm">{item.description}</p>
              <ScopeTags item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[28%] px-4">技能</TableHead>
                <TableHead>说明</TableHead>
                <TableHead className="w-56">用在哪里</TableHead>
                <TableHead className="w-36">版本</TableHead>
                <TableHead className="w-24 px-4">更新</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.name}
                  {...rowProps(item)}
                  className={cn(
                    "focus-visible:ring-ring/50 min-h-15 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    item.name === freshName && FRESH_ROW,
                  )}
                >
                  <TableCell className="px-4 py-3">
                    <NameCell item={item} />
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-0 py-3 whitespace-normal">
                    <span className="line-clamp-2">{item.description}</span>
                  </TableCell>
                  <TableCell className="py-3">
                    <ScopeTags item={item} />
                  </TableCell>
                  <TableCell className="py-3">
                    <VersionCell item={item} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    <UpdatedCell item={item} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
