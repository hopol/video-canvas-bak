import { useState } from "react";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { Tag } from "@/components/admin-ui/tag";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime, formatSize } from "@/utils/admin/agent-skill";

/** 说明超过这么多字才给“展开”（大约四行） */
const LONG_DESCRIPTION = 80;

/**
 * 技能详情右侧「信息」：说明（长的折叠成四行）、生效版本、内容、更新时间、未支持的头部字段（有才显示）。
 * @param item 技能
 */
export function InfoCard({ item }: { item: SkillItem }) {
  const [expanded, setExpanded] = useState(false);
  const long = item.description.length > LONG_DESCRIPTION;
  return (
    <section
      data-slot="skill-info"
      aria-label="信息"
      className="ring-chrome-border rounded-2xl p-4 ring-1"
    >
      <h2 className="text-sm font-semibold">信息</h2>
      <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">说明</dt>
        <dd className="min-w-0 break-words">
          <p className={cn(long && !expanded && "line-clamp-4")}>{item.description}</p>
          {long && (
            <Button
              variant="link"
              size="xs"
              className="px-0"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : "展开"}
            </Button>
          )}
        </dd>
        <dt className="text-muted-foreground">生效版本</dt>
        <dd className="tabular-nums">
          {item.active_version == null ? (
            "—"
          ) : (
            <>
              <span className="font-mono">v{item.active_version}</span> · 共 {item.version_count}{" "}
              个版本
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">内容</dt>
        <dd className="tabular-nums">
          {item.file_count} 个文件 · {formatSize(item.total_bytes)}
        </dd>
        <dt className="text-muted-foreground">更新时间</dt>
        <dd className="tabular-nums">{formatDateTime(item.updated_at)}</dd>
        {item.unsupported_fields.length > 0 && (
          <>
            <dt className="text-muted-foreground">未支持</dt>
            <dd className="flex flex-wrap gap-1">
              {item.unsupported_fields.map((field) => (
                <Tag key={field} tone="warning" mono>
                  {field}
                </Tag>
              ))}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
