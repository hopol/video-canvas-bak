import type { ReactNode } from "react";

/**
 * 挡住双击冒泡。弹窗、下拉、覆盖确认框都经 portal 渲染到 body，但 React 的合成事件仍沿组件树往上冒，
 * 会一路冒到画布的 onDoubleClick，在弹窗里双击就弹出了只该在画布空白处双击才有的「添加节点」菜单。
 * 包在一组弹窗外面，里面所有 portal 内容的双击就都到此为止（`contents` 不产生盒子，不影响节点布局）。
 */
export function StopDoubleClick({ children }: { children: ReactNode }) {
  return (
    <div className="contents" onDoubleClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}
