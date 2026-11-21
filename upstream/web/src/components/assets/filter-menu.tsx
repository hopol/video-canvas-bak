import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { OptionList, type OptionGroup, type OptionItem } from "@/components/option-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 筛选下拉的一个选项 */
export type FilterOption = OptionItem;

/** 一组选项：带标题的组前面会画一条分隔线 */
export type FilterGroup = OptionGroup;

/**
 * 资产页工具条里的筛选下拉（来源 / 时间 / 排序 / 语言 / 人群共用）：单选；偏离默认值时按钮文案换成当前选项并加深，
 * 让人一眼看出筛选在生效。面板用共用的 OptionList（和项目设置里的模型下拉同一种外观），选完自动收起。
 * @param label 默认文案，也是读屏名字，如「来源」
 * @param value 当前选中的值
 * @param defaultValue 默认值：当前值等于它时按钮不高亮
 * @param groups 选项分组
 * @param onChange 选择
 * @param onOpenChange 打开或收起（来源下拉在第一次打开时才去拉画布列表）
 * @param footer 选项后面的说明（加载中、没有画布）
 * @param icon 给了就是纯图标按钮（画布资产库弹框里地方小）：偏离默认值时图标加深并带一个小圆点，名字走 title 与读屏
 */
export function FilterMenu({
  label,
  value,
  defaultValue,
  groups,
  onChange,
  onOpenChange,
  footer,
  icon,
}: {
  label: string;
  value: string;
  defaultValue: string;
  groups: FilterGroup[];
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== defaultValue;
  const current = groups.flatMap((group) => group.options).find((option) => option.value === value);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={label}
        title={icon ? (active && current ? `${label}：${current.label}` : label) : undefined}
        className={cn(
          "text-muted-foreground hover:bg-chrome-hover hover:text-foreground focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1 rounded-full transition-colors outline-none focus-visible:ring-3",
          "data-popup-open:bg-chrome-hover",
          icon ? "relative w-8 justify-center [&_svg]:size-4" : "max-w-40 px-3",
          active && "text-foreground font-medium",
        )}
      >
        {icon ? (
          <>
            {icon}
            {active && (
              <span
                aria-hidden
                data-slot="filter-active-dot"
                className="bg-foreground absolute top-1.5 right-1.5 size-1.5 rounded-full"
              />
            )}
          </>
        ) : (
          <>
            <span className="truncate">{active && current ? current.label : label}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="max-h-80 w-64 gap-1 overflow-y-auto">
        <OptionList
          groups={groups}
          value={value}
          onPick={(next) => {
            setOpen(false);
            onChange(next);
          }}
        />
        {footer}
      </PopoverContent>
    </Popover>
  );
}
