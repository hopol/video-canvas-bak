import { ANIMATED_EDGE_OPTIONS } from "@/constants/canvas";
import type { CanvasEdge, CanvasNode, CanvasNodeData, FlowNode } from "@/types";
import { newNodeLabel } from "@/utils/canvas/node-label";
import { DEFAULT_NODE_ASPECT, nodeFrameSize } from "@/utils/canvas/node-frame";
import { placeInColumn } from "@/utils/canvas/place-beside";

import { formatShotNumber } from "./shots";

/**
 * 给分镜表第 index 行建图片节点：按镜号竖排在分镜表右侧第 index 格，标题「镜头 NN」，从分镜表连线过去。
 * 按行生成和手动上传共用，两种来源的节点位置、命名一致。只算出节点和连线，加到画布上由调用方做。
 * @param input.source 分镜表节点
 * @param input.nodes 画布上现有的节点，用来避让和起不重名的标题
 * @param input.index 第几行，从 0 起
 * @param input.data 节点数据里除 kind、label 以外的部分（提示词、模型或上传的素材）
 */
export function buildShotImageNode(input: {
  source: CanvasNode;
  nodes: FlowNode[];
  index: number;
  data: Omit<CanvasNodeData, "kind" | "label">;
}): { node: CanvasNode; edge: CanvasEdge } {
  const { source, nodes, index, data } = input;
  const id = crypto.randomUUID();
  const node: CanvasNode = {
    id,
    type: "canvas",
    position: placeInColumn({
      source,
      nodes,
      size: nodeFrameSize(DEFAULT_NODE_ASPECT),
      slot: index,
    }),
    data: {
      kind: "image",
      label: newNodeLabel(
        `镜头 ${formatShotNumber(index + 1)}`,
        nodes.map((n) => n.data.label),
      ),
      ...data,
    },
  };
  const edge = {
    id: `xy-edge__${source.id}-${id}`,
    source: source.id,
    target: id,
    ...ANIMATED_EDGE_OPTIONS,
  } as CanvasEdge;
  return { node, edge };
}
