/** 连进来只表示「它是这个节点的来源」、下游不读它的内容的上游种类：分镜表（按行生成的图片、视频节点由它的镜头而来） */
const PROVENANCE_KINDS: ReadonlySet<string> = new Set(["storyboard"]);

/**
 * 生成节点读上游时，把只表示来源的节点连同它们的线去掉：它们没有可当提示词或参考素材的内容，
 * 留在引用条里只会显示成一个「用不上」的灰条。没有要去掉的就原样返回同一个引用。
 * @param connections 接进这个节点的连线，source 是上游节点 id
 * @param nodes 这些连线的上游节点
 */
export function withoutProvenanceSources<
  T extends { source: string },
  N extends { id: string; data: { kind: string } },
>(connections: T[], nodes: N[]): { connections: T[]; nodes: N[] } {
  const skip = new Set(nodes.filter((n) => PROVENANCE_KINDS.has(n.data.kind)).map((n) => n.id));
  if (skip.size === 0) return { connections, nodes };
  return {
    connections: connections.filter((c) => !skip.has(c.source)),
    nodes: nodes.filter((n) => !skip.has(n.id)),
  };
}
