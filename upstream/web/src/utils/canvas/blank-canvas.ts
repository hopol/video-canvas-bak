/**
 * 不算空白的画布元素：节点、节点功能区、连线、角落面板。
 * node-toolbar 得单列：它的 class 是 react-flow__node-toolbar，和 react-flow__node 是两个不同的 class，
 * closest 认不出亲戚关系，漏了它双击输入框就会当成双击空白、平白弹出建节点菜单
 */
const NOT_BLANK =
  ".react-flow__node, .react-flow__node-toolbar, .react-flow__edge, .react-flow__panel";

/**
 * 事件是不是落在画布的空白处（双击弹添加菜单、按下开始框选都靠它）。
 * 先看目标在不在画布元素里面：节点里弹出的弹框 portal 到了页面最外层，
 * 但 React 事件仍沿组件树冒泡到画布，不排除的话在弹框里双击也会弹出添加菜单。
 * @param target 事件目标
 * @param root 挂处理函数的画布元素（event.currentTarget）
 */
export function isBlankCanvas(target: Element, root: Element): boolean {
  return root.contains(target) && !target.closest(NOT_BLANK);
}
