import type { CanvasEdge, CanvasNode } from "@/types";

/** 上游剧本节点连到分镜表时能拼出来的正文；没连或都没内容时返回空串 */
export type UpstreamScripts = {
  /** 按连线顺序拼起来的剧本正文；多段之间空行分隔 */
  script: string;
  /** 参与拼接的剧本节点数（有内容的） */
  count: number;
  /** 连了剧本节点（不论有没有内容） */
  hasScript: boolean;
};

/**
 * 读分镜表上游的剧本节点：按连线 id 顺序，拼接每个剧本节点的正文（去首尾空白）。
 * 连了但正文都是空的，hasScript 为 true、script 为空；没连剧本时 hasScript 为 false。
 * 「连线顺序」就是 edges 数组的顺序：新连的线追加在末尾，存档读档不改顺序；
 * 不能按边 id 排序，xyflow 生成的 id 是 xy-edge__源-目标，Agent 建的是随机串，字典序和先后无关。
 */
export function upstreamScripts(
  nodeId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): UpstreamScripts {
  // 先挑出连进来的线再找源节点：订阅它的组件每次画布变化都会算一遍，不能为此给全部节点建索引
  const connected = edges
    .filter((e) => e.target === nodeId)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is CanvasNode => n?.data.kind === "script");
  const parts = connected.map((n) => (n.data.text ?? "").trim()).filter(Boolean);
  return { script: parts.join("\n\n"), count: parts.length, hasScript: connected.length > 0 };
}
