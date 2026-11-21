import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 技能详情 / 文件预览里的加载：居中一个转圈，不用骨架屏。
 * @param className 外层尺寸，默认撑满父容器
 */
export function SkillLoading({ className }: { className?: string }) {
  return (
    <div
      data-slot="skill-loading"
      aria-busy="true"
      className={cn("grid min-h-40 flex-1 place-items-center", className)}
    >
      <Loader2 aria-label="加载中" className="text-muted-foreground size-5 animate-spin" />
    </div>
  );
}
