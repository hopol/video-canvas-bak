import { TriangleAlert, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoryboardSplitAction } from "@/hooks/use-storyboard-split";
import { useStoryboardSplit } from "@/store/storyboard-split";

import { SHOT_GRID_CLASS } from "./shot-row";
import { StopDoubleClick } from "./stop-double-click";

/** 拆分进行中的不确定进度条：表头下方 2px，左右往返（设计 §6.3） */
export function SplitProgressBar() {
  return (
    <div
      role="progressbar"
      aria-label="拆分中"
      className="bg-status-running/15 relative h-0.5 shrink-0 overflow-hidden"
    >
      <div className="bg-status-running absolute inset-y-0 w-1/3 animate-[storyboard-split-sweep_1.4s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
    </div>
  );
}

/** 拆分失败的横幅：原因直接用后端文案，带「重试」和关闭（设计 §6.4） */
export function SplitErrorBanner({
  reason,
  onRetry,
  onDismiss,
}: {
  reason: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm"
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={reason}>
        拆分镜失败：{reason}
      </span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        重试
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  );
}

/** 和真实行同高同列宽的骨架行：拆分中告诉用户镜头会出现在哪（设计 §6.3） */
export function SplitSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`${SHOT_GRID_CLASS} min-h-[72px] border-b border-border/60 px-2 py-2.5`}
        >
          <div />
          <Skeleton className="mx-auto mt-8 h-4 w-6" />
          <Skeleton className="h-[81px] w-36 rounded-md" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <Skeleton className="mx-2 mt-1.5 h-5" />
          <div />
        </div>
      ))}
    </div>
  );
}

/**
 * 表里已有镜头时点拆分镜弹出的小确认框（设计 §6.2）：标题直接给现状数字，不加解释；
 * 「追加到末尾」默认聚焦（不丢数据的选项），「覆盖」用红色。常驻挂载，open 来自 store。
 * @param id 分镜表节点 id，只在 store 里的意图是自己时打开
 */
export function SplitOverwriteDialog({ id }: { id: string }) {
  const intent = useStoryboardSplit((s) => s.overwrite);
  const close = useStoryboardSplit((s) => s.closeOverwrite);
  const { run } = useStoryboardSplitAction(id);
  const open = intent?.nodeId === id;
  // 关闭动画期间 intent 已经清空，标题里的数字留着上一次的，不闪成 0
  const choose = (mode: "replace" | "append") => {
    close();
    void run(mode);
  };

  return (
    <StopDoubleClick>
      <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>分镜表里已有 {intent?.existingCount ?? 0} 个镜头</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="outline" autoFocus onClick={() => choose("append")}>
              追加到末尾
            </AlertDialogAction>
            <AlertDialogAction variant="destructive" onClick={() => choose("replace")}>
              覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StopDoubleClick>
  );
}
