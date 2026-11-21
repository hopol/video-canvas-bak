import { Fragment } from "react";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import { ReasonTooltip } from "@/components/admin-ui/reason-tooltip";
import { Tag } from "@/components/admin-ui/tag";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  SKILL_SCOPES,
  scopeBlockReason,
  scopeOn,
  type SkillScopeKey,
} from "@/utils/admin/agent-skill";

const GROUP_LABEL = { canvas: "画布", drama: "短剧工作室" } as const;

/**
 * 技能详情右侧「用在哪里」：画布 Agent 与短剧五个环节，六个平级开关，点了即生效（由 onToggle 提交），没有保存按钮。
 * 整行可点；不可用的开关置灰，悬停写原因；正在提交的那一行禁用，其他行照常可点。
 * @param item 技能
 * @param busy 正在提交的场景
 * @param onToggle 切换一个场景，next 是目标状态
 */
export function ScopeCard({
  item,
  busy,
  onToggle,
}: {
  item: SkillItem;
  busy: ReadonlySet<SkillScopeKey>;
  onToggle: (scope: SkillScopeKey, next: boolean) => void;
}) {
  return (
    <section
      data-slot="scope-card"
      aria-label="用在哪里"
      className="ring-chrome-border rounded-2xl pb-2 ring-1"
    >
      <h2 className="px-4 pt-4 text-sm font-semibold">用在哪里</h2>
      {SKILL_SCOPES.map((scope, index) => {
        const on = scopeOn(item, scope.key);
        const reason = scopeBlockReason(item, scope.key);
        const disabled = !!reason || busy.has(scope.key);
        const toggle = () => !disabled && onToggle(scope.key, !on);
        const firstOfGroup = SKILL_SCOPES[index - 1]?.group !== scope.group;
        return (
          <Fragment key={scope.key}>
            {firstOfGroup && (
              <div className="text-muted-foreground flex items-center gap-2 px-4 pt-3 pb-1 text-xs">
                {GROUP_LABEL[scope.group]}
                {scope.group === "drama" && item.has_scripts && (
                  <Tag title="短剧只注入正文，不执行脚本">仅用正文</Tag>
                )}
              </div>
            )}
            <div
              data-scope={scope.key}
              onClick={toggle}
              className={cn(
                "flex min-h-11 items-center gap-3 px-4 text-sm",
                disabled ? "cursor-not-allowed" : "hover:bg-chrome-hover cursor-pointer",
                reason && "text-muted-foreground",
              )}
            >
              <span className="min-w-0 flex-1">{scope.name}</span>
              <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
                <ReasonTooltip reason={reason}>
                  <Switch
                    checked={on}
                    disabled={disabled}
                    aria-label={scope.name}
                    onCheckedChange={(next) => onToggle(scope.key, next)}
                  />
                </ReasonTooltip>
              </span>
            </div>
          </Fragment>
        );
      })}
    </section>
  );
}
