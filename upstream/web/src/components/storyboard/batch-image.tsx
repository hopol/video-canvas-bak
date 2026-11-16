import { useState } from "react";
import { toast } from "sonner";

import { ChromeButton } from "@/components/canvas/chrome/chrome";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Plan = { targets: string[]; missingScene: number };

/**
 * 弹窗标题栏里的「批量生成分镜图」（放在清透胶囊里）：只补没图的行，点了先确认要生成几张（会花积分）。
 * 要处理哪些行在点击那一刻现算，不随表格实时订阅；一张都不用生成时不弹确认，只提示一句。
 * @param plan 算出这次要生成的行，以及没写画面描述被跳过的行数
 * @param onConfirm 确认后开始生成这些行
 */
export function BatchImageButton({
  plan,
  onConfirm,
}: {
  plan: () => Plan;
  onConfirm: (shotIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // 关闭动画期间文案还要在，所以计划单独存一份，不随 open 清空
  const [current, setCurrent] = useState<Plan>({ targets: [], missingScene: 0 });

  return (
    <>
      <ChromeButton
        title="批量生成分镜图"
        aria-label="批量生成分镜图"
        onClick={() => {
          const next = plan();
          if (next.targets.length === 0) {
            toast(
              next.missingScene
                ? `还有 ${next.missingScene} 镜没写画面描述，写好再生成`
                : "每一镜都有分镜图了",
            );
            return;
          }
          setCurrent(next);
          setOpen(true);
        }}
      >
        <span className="text-foreground text-sm">批量生成分镜图</span>
      </ChromeButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>生成 {current.targets.length} 张分镜图？</AlertDialogTitle>
            <AlertDialogDescription>
              给还没有分镜图的镜头生成，已有图和正在生成的不动，会消耗积分。
              {current.missingScene > 0 &&
                `另有 ${current.missingScene} 镜没写画面描述，这次先跳过。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              autoFocus
              onClick={() => {
                setOpen(false);
                onConfirm(current.targets);
              }}
            >
              开始生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
