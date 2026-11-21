import type { ReactNode } from "react";
import { X } from "lucide-react";

import { DialogSession } from "@/components/dialog-session";
import { ChromeButton } from "@/components/canvas/chrome/chrome";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePromptEditor } from "@/store/prompt-editor";

/** 弹框里生成面板的宽度：比画布里节点下方的面板宽，底栏的模型名、参数摘要和两个发送键一行放得下 */
const PANEL_WIDTH = 720;

/**
 * 弹框外壳：半透明清透面板（coding-standards 6.1），覆盖 DialogContent 的实心底和小圆角；
 * 宽度跟着里面的生成面板走
 */
const CONTENT_CLASS =
  "bg-chrome ring-chrome-border w-auto gap-0 overflow-hidden rounded-2xl p-0 [corner-shape:squircle] shadow-2xl backdrop-blur-2xl backdrop-saturate-150 sm:max-w-none";

/** 标题行右侧附加操作的样式：半透明胶囊，和关闭按钮同高 */
export const PROMPT_DIALOG_ACTION_CLASS =
  "bg-chrome ring-chrome-border hover:bg-chrome-hover text-foreground focus-visible:ring-ring/60 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs ring-1 transition-colors duration-150 outline-none focus-visible:ring-2 [&_svg]:size-3.5";

/**
 * 在弹框里编辑节点的生成设置（提示词、模型、参数、参考），给编辑器之外的页面用（短剧资产列表的卡片）。
 * 挂在节点组件里：生成面板的状态都在节点的 hook 上，弹框直接复用同一份，不另起一套。
 * 节点订阅 usePromptEditor 看是不是在叫自己。
 * 标题行：左边标题和一行说明，右边附加操作和关闭；下面一条细线隔开生成面板。
 */
export function PromptEditDialog({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** 标题行右侧的附加按钮（角色卡放「角色详情」），用 PROMPT_DIALOG_ACTION_CLASS */
  actions?: ReactNode;
  /** 生成面板，拿到弹框给的宽度 */
  children: (width: number) => ReactNode;
}) {
  const open = usePromptEditor((state) => state.nodeId === id);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && usePromptEditor.getState().close()}>
      <DialogContent
        // 弹框渲染在节点组件里，React 事件会沿组件树冒泡到节点和画布：
        // 拦下单击（免得在列表后面把节点选中，Delete 误删）和双击（免得被当成双击空白画布）
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        showCloseButton={false}
        className={CONTENT_CLASS}
      >
        <DialogSession open={open}>
          <DialogHeader className="border-chrome-border flex-row items-center gap-3 border-b py-3.5 pr-4 pl-5">
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogTitle className="truncate text-[15px] leading-5 font-semibold">
                {title}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs leading-4">
                提示词与生成设置
              </DialogDescription>
            </div>
            {actions}
            <DialogClose
              render={
                <ChromeButton aria-label="关闭" className="ring-chrome-border bg-chrome ring-1" />
              }
            >
              <X />
            </DialogClose>
          </DialogHeader>
          <div className="p-2">
            <PanelSlot>{children}</PanelSlot>
          </div>
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}

/** 弹框里的生成面板：组件形式，弹框真打开（挂载）了才去量宽度、建面板；窄屏收窄到不超出屏幕 */
function PanelSlot({ children }: { children: (width: number) => ReactNode }) {
  return children(Math.min(PANEL_WIDTH, window.innerWidth - 48));
}

/** 弹框里的面板不再需要浮层自己的底、描边和阴影 */
export const PROMPT_DIALOG_PANEL_CLASS = "bg-transparent shadow-none ring-0";
