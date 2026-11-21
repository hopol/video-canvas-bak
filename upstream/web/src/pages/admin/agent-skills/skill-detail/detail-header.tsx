import { Check, Download, Ellipsis, Lightbulb, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import { renameSkill } from "@/api/admin/agent-skill";
import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { CopyButton } from "@/components/admin-ui/copy-button";
import { DialogDescription, DialogTitle } from "@/components/admin-ui/dialog";
import { Tag } from "@/components/admin-ui/tag";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { scopeTags } from "@/utils/admin/agent-skill";

/** 显示名：只读文本 + 铅笔，点开变成输入框；Enter 保存、Esc 取消。内置技能只读 */
function TitleField({
  item,
  onRenamed,
}: {
  item: SkillItem;
  onRenamed: (item: SkillItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const trimmed = draft.trim();

  const save = async () => {
    if (!trimmed || trimmed === item.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      onRenamed(await renameSkill(item.name, trimmed));
      setEditing(false);
    } catch {
      // 失败的全局 toast 已弹，保持编辑状态方便改
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <DialogTitle className="truncate text-xl font-semibold tracking-tight">
          {item.title}
        </DialogTitle>
        {!item.readonly && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="修改显示名"
            onClick={() => {
              setDraft(item.title);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={draft}
        maxLength={64}
        aria-label="显示名"
        disabled={saving}
        className="bg-chrome-hover border-chrome-border h-9 max-w-80 rounded-full"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setEditing(false);
        }}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="保存"
        disabled={saving || !trimmed}
        onClick={() => void save()}
      >
        <Check />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="取消修改"
        disabled={saving}
        onClick={() => setEditing(false)}
      >
        <X />
      </Button>
    </span>
  );
}

/**
 * 详情弹窗的页头：图标、显示名（可改，也是弹窗标题）、技能名（与显示名不同才显示，可复制）、“在用 N 处”、更多操作菜单。
 * 内置技能没有菜单（不能下载、不能删除）。
 * @param item 技能
 * @param onRenamed 显示名改好后
 * @param onDownload 下载生效版本
 * @param onDelete 删除技能
 */
export function DetailHeader({
  item,
  onRenamed,
  onDownload,
  onDelete,
}: {
  item: SkillItem;
  onRenamed: (item: SkillItem) => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const used = scopeTags(item).length;
  return (
    <div data-slot="skill-detail-header" className="grid gap-3">
      <div className="flex items-center gap-3">
        <span className="bg-chrome ring-chrome-border text-muted-foreground grid size-11 shrink-0 place-items-center rounded-2xl ring-1">
          <Lightbulb className="size-5" />
        </span>
        <div className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <TitleField key={item.title} item={item} onRenamed={onRenamed} />
            {item.readonly && <Tag>内置</Tag>}
          </span>
          {item.title !== item.name && (
            <DialogDescription className="flex min-w-0 items-center gap-1 font-mono text-xs">
              <span className="truncate">{item.name}</span>
              <CopyButton text={item.name} iconOnly label="复制技能名" />
            </DialogDescription>
          )}
        </div>
        <Tag tone={used > 0 ? "success" : "neutral"} className="shrink-0 tabular-nums">
          {used > 0 ? `在用 ${used} 处` : "未使用"}
        </Tag>
        {!item.readonly && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  aria-label="更多操作"
                />
              }
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={item.active_version == null} onClick={onDownload}>
                <Download />
                下载生效版本
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                删除技能
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
