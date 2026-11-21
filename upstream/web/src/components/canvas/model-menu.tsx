import { ChevronDown } from "lucide-react";

import { VendorAvatar } from "@/components/admin-ui/vendor-avatar";
import { ModelLogo } from "@/components/model-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { NodeModelOption } from "./node-prompt-input";

/**
 * 选模型的下拉：按钮是品牌 logo + 模型名 + 小箭头，菜单里每行厂商头像、名字、标签、说明和价格。
 * 画布生成面板和角色详情的音频模型共用，两边长得一样。
 * @param models 可选模型
 * @param model 当前选中的模型，清单为空时是 undefined
 * @param onModelChange 选了别的模型
 * @param label 按钮上显示的字，覆盖模型名
 * @param invalid 当前模型有问题：按钮用警示色、不放 logo
 * @param placeholder 还没有模型时按钮上的字
 * @param disabled 不能换模型（比如正在生成）
 * @param className 按钮样式（生成面板传 PANEL_CHIP_CLASS）
 */
export function ModelMenu({
  models,
  model,
  onModelChange,
  label,
  invalid,
  placeholder = "加载模型…",
  disabled,
  className,
}: {
  models: readonly NodeModelOption[];
  model: NodeModelOption | undefined;
  onModelChange: (id: string) => void;
  label?: string;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(className, invalid && "text-destructive")}
        aria-label="选择模型"
      >
        {/* 当前模型的品牌 logo；模型有问题（警示色）时不放，免得看着像正常可用 */}
        {model && !invalid && (
          <ModelLogo vendor={model.vendor} name={model.label} className="size-4 rounded-[5px]" />
        )}
        <span className="min-w-0 truncate">{label ?? model?.label ?? placeholder}</span>
        <ChevronDown className="opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 w-72 overflow-y-auto" align="start" sideOffset={8}>
        <DropdownMenuGroup>
          {/* GroupLabel 必须待在 Group 里，否则 Base UI 会抛 MenuGroupContext 缺失 */}
          <DropdownMenuLabel>选择模型</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={model?.id ?? ""}
            onValueChange={(next) => onModelChange(next as string)}
          >
            {models.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                <VendorAvatar
                  vendor={item.vendor}
                  name={item.label}
                  seed={item.id}
                  className="size-7 rounded-md text-xs"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{item.label}</span>
                    {item.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="bg-muted text-muted-foreground shrink-0 rounded px-1 py-px text-[10px] leading-4"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                  {item.hint && (
                    <span className="text-muted-foreground truncate text-xs">{item.hint}</span>
                  )}
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {item.priceLabel ?? `${item.credits} 积分`}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
