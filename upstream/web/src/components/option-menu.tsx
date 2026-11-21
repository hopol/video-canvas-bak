import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/** 下拉列表里的一个选项 */
export type OptionItem = {
  /** 选项值，列表内唯一 */
  value: string;
  /** 显示文案 */
  label: string;
  /** 文案前面的图标 / 头像（如模型厂商 logo） */
  icon?: ReactNode;
  /** 文案下面一行小字（如能力摘要、不可选的原因） */
  note?: string;
  /** 不可选：置灰，点了没反应 */
  disabled?: boolean;
  /** 悬停提示，不可选时写原因 */
  title?: string;
};

/** 一组选项：带标题的组，标题单独占一行；第二组起前面画一条分隔线 */
export type OptionGroup = {
  heading?: string;
  options: OptionItem[];
};

/**
 * 下拉列表里的一行：至少 40px 高，圆角整块悬停高亮；选中的加粗、整块高亮，右边打勾。
 * 放在 Popover / ChipPopover 里用，所有单选下拉（筛选、模型选择…）共用这一种外观。
 * @param active 当前选中
 * @param disabled 不可选
 * @param title 悬停提示
 * @param onClick 点击
 * @param children 行内容：图标、文字、两行文字都行，需要撑满的部分自己加 flex-1
 */
export function OptionRow({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "hover:bg-muted focus-visible:ring-ring/50 flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2",
        "disabled:hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-45",
        active && "bg-muted font-medium",
      )}
    >
      {children}
      {active && <Check className="ml-auto size-4 shrink-0" />}
    </button>
  );
}

/**
 * 单选下拉列表：按组渲染选项，选中项打勾。放进 Popover 面板里用；选完要不要收起由调用方在 onPick 里决定。
 * @param groups 选项分组
 * @param value 当前选中的值
 * @param onPick 点了某个选项
 * @param empty 一个选项都没有时显示的内容
 */
export function OptionList({
  groups,
  value,
  onPick,
  empty,
}: {
  groups: OptionGroup[];
  value: string;
  onPick: (value: string) => void;
  empty?: ReactNode;
}) {
  if (empty && groups.every((group) => group.options.length === 0)) return <>{empty}</>;
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.heading ?? index}>
          {index > 0 && <div role="separator" className="bg-border -mx-1 my-1 h-px" />}
          {group.heading && (
            <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs">{group.heading}</div>
          )}
          {group.options.map((option) => (
            <OptionRow
              key={option.value}
              active={option.value === value}
              disabled={option.disabled}
              title={option.title}
              onClick={() => onPick(option.value)}
            >
              {option.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.note && (
                  <span className="text-muted-foreground block truncate text-[11px] font-normal">
                    {option.note}
                  </span>
                )}
              </span>
            </OptionRow>
          ))}
        </Fragment>
      ))}
    </>
  );
}
