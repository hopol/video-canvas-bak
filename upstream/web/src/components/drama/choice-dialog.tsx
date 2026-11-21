import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/admin-ui/alert-dialog";
import { cn } from "@/lib/utils";
import { openDialog, type DialogControl } from "@/store/dialog";

export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  /** 主操作：高亮，建议排第一 */
  primary?: boolean;
  /** 选它会处理几个，显示在行尾 */
  count?: number;
};

export type ChoiceOptions<T extends string> = {
  title: string;
  description?: ReactNode;
  /** 标题下的统计小标签 */
  stats?: { label: string; value: number }[];
  /** 需要提醒的后果（如会覆盖手改内容），琥珀色显示 */
  note?: string;
  /** 除「取消」之外的选项，按显示顺序竖排 */
  options: ChoiceOption<T>[];
};

function ChoiceDialog<T extends string>({
  title,
  description,
  stats,
  note,
  options,
  resolve,
  open,
  onClose,
  onExited,
}: ChoiceOptions<T> & DialogControl & { resolve: (value: T | null) => void }) {
  const done = (value: T | null) => {
    resolve(value);
    onClose();
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && done(null)}
      onOpenChangeComplete={(next) => !next && onExited?.()}
    >
      <AlertDialogContent className="data-[size=default]:sm:max-w-sm">
        <AlertDialogHeader className="gap-2.5">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {(description || (stats && stats.length > 0) || note) && (
            <AlertDialogDescription render={<div />} className="grid gap-2">
              {description}
              {stats && stats.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {stats.map((item) => (
                    <span
                      key={item.label}
                      className="bg-chrome-hover ring-chrome-border inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs ring-1"
                    >
                      {item.label}
                      <span className="text-foreground tabular-nums">{item.value}</span>
                    </span>
                  ))}
                </div>
              )}
              {note && <p className="text-xs text-amber-400">{note}</p>}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => done(option.value)}
              className={cn(
                "flex h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                option.primary
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "hover:bg-chrome-hover ring-chrome-border text-foreground ring-1",
              )}
            >
              <span className="font-medium">{option.label}</span>
              {option.count !== undefined && (
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    option.primary ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {option.count} 个
                </span>
              )}
            </button>
          ))}
        </div>
        <AlertDialogFooter className="border-t-0 pt-0 sm:justify-center">
          <AlertDialogCancel variant="ghost" className="text-muted-foreground">
            取消
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 多选一的确认框（「取消」之外有两个以上去向时用，两个去向用 confirm）：选项竖排成整行按钮，主操作高亮。
 * @returns 选中的 value；取消或关掉为 null
 */
export function choose<T extends string>(options: ChoiceOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    openDialog(ChoiceDialog<T>, { ...options, resolve });
  });
}
