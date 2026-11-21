import { Fragment, useState, type ReactNode } from "react";

/**
 * 弹窗内容的「一次打开」：放在 DialogContent / SheetContent 里、包住弹窗正文（coding-standards 6.3）。
 *
 * - 关闭时内容照常挂着，等弹窗外壳的退出动画播完再随外壳一起卸载，不会「一下子没了」。
 *   不要写 `{open && <Body />}`：一关就把正文卸掉，只剩空壳做动画。
 * - 每次打开都重新挂载正文，表单、勾选、请求都从头开始；关闭动画还没播完就再打开，也算新的一次。
 *
 * ```tsx
 * <Dialog open={open} onOpenChange={onOpenChange}>
 *   <DialogContent>
 *     <DialogSession open={open}>
 *       <Body onClose={() => onOpenChange(false)} />
 *     </DialogSession>
 *   </DialogContent>
 * </Dialog>
 * ```
 * @param open 弹窗是否打开，和传给 Dialog 的同一个值
 */
export function DialogSession({ open, children }: { open: boolean; children: ReactNode }) {
  // 每次从关到开记一次，拿它当 key 让正文重新挂载；关闭时不变，正文留给退出动画
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return <Fragment key={session}>{children}</Fragment>;
}
