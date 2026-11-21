import { Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { TakeoverState } from "@/hooks/use-canvas-lock";

/** 按钮上的字：点一次请对方让位，对方没响应时按钮变成「强制接管」，再点一次才是抢 */
const LABEL: Record<TakeoverState, string> = {
  idle: "接管编辑",
  asking: "等对方存盘",
  "no-response": "强制接管",
};

/**
 * 只读预览的常驻提示条：画布能看、能平移缩放，但改不了。
 * 另一标签页关闭后会自动转成可编辑（这里随之消失），也可以直接点「接管编辑」把它请走。
 *
 * 摆底部居中：顶部居中是全站提示（sonner）的位置，摆上面会被「Agent 暂不可用」这类
 * 常驻提示压住，连按钮都点不到。只读时底栏工具条整条收起，这块本来就是空的。
 */
export function ReadOnlyBanner({
  takeoverState,
  onTakeover,
}: {
  takeoverState: TakeoverState;
  onTakeover?: () => void;
}) {
  const asking = takeoverState === "asking";
  // 强夺是不可逆的：对方没存上的改动会直接丢。第一次点只把按钮换成确认，
  // 再点一次才真抢——与 issue 里「弹二次确认」是同一件事，只是不弹窗。
  const [confirmSteal, setConfirmSteal] = useState(false);
  useEffect(() => {
    if (takeoverState !== "no-response") setConfirmSteal(false);
  }, [takeoverState]);
  const stealing = takeoverState === "no-response";
  const label = stealing && confirmSteal ? "确认接管" : LABEL[takeoverState];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3.5 z-50 flex justify-center px-3">
      <div
        role="status"
        className="bg-chrome text-foreground ring-chrome-border pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-xs shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        <Eye className="size-3.5 shrink-0 opacity-60" />
        <span className="font-medium whitespace-nowrap">只读预览</span>
        <span
          className={cn(
            "hidden truncate sm:inline",
            confirmSteal ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {confirmSteal ? "对方未保存的改动会丢" : "另一标签页正在编辑；关闭那边后会自动接管。"}
        </span>
        {onTakeover && (
          <button
            type="button"
            onClick={() => {
              // 强夺要两下：第一下只是把话说明白，第二下才动手
              if (stealing && !confirmSteal) {
                setConfirmSteal(true);
                return;
              }
              setConfirmSteal(false);
              onTakeover();
            }}
            disabled={asking}
            title={
              stealing
                ? confirmSteal
                  ? "对方没存上的改动会丢掉，点这里确认接管"
                  : "对方没有响应（页签可能被冻结或停在断点）。点一下会先请你确认。"
                : asking
                  ? "已请对方先存盘，稍等一下"
                  : "请另一个标签页存盘并让出编辑权"
            }
            className={cn(
              "focus-visible:ring-ring/60 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2",
              stealing
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-foreground text-background hover:bg-foreground/90",
              asking && "opacity-70",
            )}
          >
            {asking && <Loader2 className="size-3 animate-spin" />}
            {label}
          </button>
        )}
      </div>
    </div>
  );
}
