import { useCallback, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import { submitNodeWhenReady } from "@/components/canvas-editor/node-actions";
import { useFocusNode } from "@/components/canvas-editor/use-focus-node";
import { ANIMATED_EDGE_OPTIONS } from "@/constants/canvas";
import { useRemoteModels } from "@/hooks/use-models";
import { useModelsStore } from "@/store/models";
import { useSettingsStore } from "@/store/settings";
import { useStoryboardEditor } from "@/store/storyboard-editor";
import { findTask, useTasksStore } from "@/store/tasks";
import type { CanvasEdge, CanvasNode, StoryboardShot } from "@/types";
import { pickDefaultModel } from "@/utils/canvas/default-model";
import { newNodeLabel } from "@/utils/canvas/node-label";
import { DEFAULT_NODE_ASPECT, nodeFrameSize } from "@/utils/canvas/node-frame";
import { placeInColumn } from "@/utils/canvas/place-beside";
import { buildShotImageNode } from "@/utils/storyboard/image-node";
import { shotImagePrompt } from "@/utils/storyboard/prompt";
import { batchImagePlan } from "@/utils/storyboard/shot-image";
import { emptyStoryboard, formatShotNumber, linkShot } from "@/utils/storyboard/shots";
import { buildVideoNodeSeed, type VideoImageSource } from "@/utils/storyboard/video";
import { deriveVideoNodeView } from "@/utils/tasks/node-view";

/** 改完提示词后等一小会儿再提交：节点要重新渲染一次，提交读的才是新的提示词 */
const SETTLE_MS = 60;

/**
 * 分镜表按行生成（PRD 6.5）：
 * - generateImage：这一行还没有图片节点就在分镜表右侧按镜号竖排建一个、从分镜表连线过去，
 *   提示词由这一行拼出来，用设置里的默认图片模型，建好就自动开始生成；
 *   已经有图片节点就复用它（用这一行现在的内容重写提示词再生成），不新建；
 * - planImages / generateImages：批量生成分镜图，只补没图的行（规则见 batchImagePlan），各行同时开始，
 *   没能开始的合成一条提示；
 * - generateVideo：这一行还没有视频节点就按镜号竖排建一个、从分镜表连线（PRD 6.6）：提示词是出图那套模板加对白，
 *   时长取模型支持的最接近值，有分镜图就按模型能力当首帧或参考图。**不自动开始生成**（视频贵，让用户到节点上
 *   确认模型和参数再点）；已经有视频节点就不重复建，行菜单的「重新生成视频」用这一行现在的内容更新它再定位过去；
 * - locate：关掉弹窗，把画布飞到关联节点。
 * 结果不用回填：分镜图格、视频格实时读关联节点。
 * @param storyboardId 分镜表节点 id
 */
export function useStoryboardShotGeneration(storyboardId: string) {
  const { getNode, getNodes, addNodes, addEdges, updateNodeData } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();
  const focusNode = useFocusNode();
  // 让图片模型清单开始加载：新节点要等它才能提交
  useRemoteModels("image");
  /** 正在处理的行：同一行连点只处理一次，免得建出两个节点 */
  const busy = useRef(new Set<string>());

  /**
   * 建或复用这一行的图片节点并提交生成。
   * @returns 没能开始时的镜号和原因；开始了、或这一行被跳过为 null
   */
  const startImage = useCallback(
    async (shotId: string): Promise<{ no: string; reason: string } | null> => {
      if (busy.current.has(shotId)) return null;
      const source = getNode(storyboardId);
      const board = source?.data.storyboard;
      if (!source || !board) return null;
      const index = board.shots.findIndex((s) => s.id === shotId);
      if (index < 0) return null;
      const shot = board.shots[index];
      const no = formatShotNumber(index + 1);
      if (!shot.scene.trim()) {
        toast.error(`先写第 ${no} 镜的画面描述`);
        return null;
      }
      busy.current.add(shotId);
      try {
        const prompt = shotImagePrompt(shot);
        const existing = shot.imageNodeId ? getNode(shot.imageNodeId) : undefined;
        let nodeId = existing?.data.kind === "image" ? existing.id : undefined;
        if (nodeId) {
          // 复用：用这一行现在的内容重写提示词（模型、参数是用户在节点上调过的，不动）
          updateNodeData(nodeId, (node) => ({ prompt, params: { ...node.data.params, prompt } }));
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        } else {
          const model = pickDefaultModel(
            useSettingsStore.getState().defaultModels.image,
            useModelsStore.getState().byKind.image?.models ?? [],
          );
          const { node, edge } = buildShotImageNode({
            source,
            nodes: getNodes(),
            index,
            data: { prompt, params: { prompt }, ...(model ? { model } : {}) },
          });
          addNodes(node);
          addEdges(edge);
          nodeId = node.id;
          updateNodeData(storyboardId, (board) => ({
            storyboard: linkShot(board.data.storyboard ?? emptyStoryboard(), shotId, {
              imageNodeId: node.id,
            }),
          }));
        }
        const reason = await submitNodeWhenReady(nodeId);
        // 没能开始（积分不足、模型不可用……）：节点已经建好，用户可以到节点上处理后再点生成
        return reason ? { no, reason } : null;
      } finally {
        busy.current.delete(shotId);
      }
    },
    [addEdges, addNodes, getNode, getNodes, storyboardId, updateNodeData],
  );

  const generateImage = useCallback(
    async (shotId: string) => {
      const failed = await startImage(shotId);
      if (failed) toast.error(`第 ${failed.no} 镜没能开始生成：${failed.reason}`);
    },
    [startImage],
  );

  /** 按分镜表和关联节点此刻的状态，算出批量生成要处理哪些行 */
  const planImages = useCallback(() => {
    const shots = getNode(storyboardId)?.data.storyboard?.shots ?? [];
    const tasks = useTasksStore.getState().tasks;
    return batchImagePlan(shots, (shot) => {
      if (!shot.imageNodeId) return undefined;
      const node = getNode(shot.imageNodeId);
      if (!node) return { exists: false };
      return {
        exists: true,
        view: deriveVideoNodeView(node.data, findTask(tasks, node.data.taskId), 0),
      };
    });
  }, [getNode, storyboardId]);

  /**
   * 批量生成：各行同时开始。建节点那一段在第一个 await 之前，按调用顺序依次完成，不会互相抢位置。
   * @param shotIds planImages 挑出来的行
   */
  const generateImages = useCallback(
    async (shotIds: string[]) => {
      const failed = (await Promise.all(shotIds.map(startImage))).filter((f) => f !== null);
      if (failed.length === 1) {
        toast.error(`第 ${failed[0].no} 镜没能开始生成：${failed[0].reason}`);
      } else if (failed.length > 1) {
        toast.error(`${failed.length} 镜没能开始生成：${failed[0].reason}`);
      }
    },
    [startImage],
  );

  /**
   * 这一行的分镜图落在哪：关联的图片节点已经出了图就是它（连线进视频节点），否则手传的素材；都没有为 null。
   * 图片节点还在生成中、没有图时不当首帧——连一个没有产物的参考只会让视频节点提交失败。
   */
  const imageSourceOf = useCallback(
    (shot: StoryboardShot): VideoImageSource => {
      const node = shot.imageNodeId ? getNode(shot.imageNodeId) : undefined;
      if (node?.data.kind === "image" && node.data.src && node.data.assetId) {
        return { kind: "node", nodeId: node.id };
      }
      return shot.image
        ? { kind: "asset", assetId: shot.image.assetId, src: shot.image.src }
        : null;
    },
    [getNode],
  );

  const generateVideo = useCallback(
    async (shotId: string, options: { regenerate?: boolean } = {}) => {
      const key = `video:${shotId}`;
      if (busy.current.has(key)) return;
      const source = getNode(storyboardId);
      const board = source?.data.storyboard;
      if (!source || !board) return;
      const index = board.shots.findIndex((s) => s.id === shotId);
      if (index < 0) return;
      const shot = board.shots[index];
      const no = formatShotNumber(index + 1);
      if (!shot.scene.trim()) {
        toast.error(`先写第 ${no} 镜的画面描述`);
        return;
      }
      busy.current.add(key);
      try {
        const models = useModelsStore.getState().byKind.video?.models ?? [];
        const existing = shot.videoNodeId ? getNode(shot.videoNodeId) : undefined;
        const chosen = existing?.data.model ?? useSettingsStore.getState().defaultModels.video;
        const model = models.find((m) => m.key === chosen) ?? models[0];
        const seed = buildVideoNodeSeed({
          shot,
          caps: model?.capabilities,
          image: imageSourceOf(shot),
        });
        if (existing?.data.kind === "video") {
          // 已有视频节点：只有明确「重新生成」才用这一行现在的内容更新它；普通点击就是定位过去
          if (options.regenerate) {
            updateNodeData(existing.id, (node) => ({
              prompt: seed.prompt,
              params: { ...node.data.params, ...seed.params },
              ...(seed.paramAssets
                ? { paramAssets: { ...node.data.paramAssets, ...seed.paramAssets } }
                : {}),
            }));
          }
          return;
        }
        const nodeId = crypto.randomUUID();
        const nodes = getNodes();
        const picked = pickDefaultModel(useSettingsStore.getState().defaultModels.video, models);
        addNodes({
          id: nodeId,
          type: "canvas",
          position: placeInColumn({
            source,
            nodes,
            size: nodeFrameSize(DEFAULT_NODE_ASPECT),
            slot: index,
          }),
          data: {
            kind: "video",
            label: newNodeLabel(
              `镜头 ${no} 视频`,
              nodes.map((n) => n.data.label),
            ),
            prompt: seed.prompt,
            params: seed.params,
            ...(seed.paramAssets ? { paramAssets: seed.paramAssets } : {}),
            ...(picked ? { model: picked } : {}),
          },
        });
        const edges: CanvasEdge[] = [
          {
            id: `xy-edge__${storyboardId}-${nodeId}`,
            source: storyboardId,
            target: nodeId,
            ...ANIMATED_EDGE_OPTIONS,
          } as CanvasEdge,
        ];
        // 分镜图当首帧 / 参考图：从图片节点连线进来（这才是真正的参考输入，分镜表那条线只表示来源）
        if (seed.linkImageNodeId) {
          edges.push({
            id: `xy-edge__${seed.linkImageNodeId}-${nodeId}`,
            source: seed.linkImageNodeId,
            target: nodeId,
            ...ANIMATED_EDGE_OPTIONS,
          } as CanvasEdge);
        }
        addEdges(edges);
        updateNodeData(storyboardId, (node) => ({
          storyboard: linkShot(node.data.storyboard ?? emptyStoryboard(), shotId, {
            videoNodeId: nodeId,
          }),
        }));
        // 不自动开始：视频贵，用户要到节点上确认模型和参数再点生成
      } finally {
        busy.current.delete(key);
      }
    },
    [addEdges, addNodes, getNode, getNodes, imageSourceOf, storyboardId, updateNodeData],
  );

  const locate = useCallback(
    (nodeId: string) => {
      useStoryboardEditor.getState().close();
      focusNode(nodeId);
    },
    [focusNode],
  );

  return { generateImage, planImages, generateImages, generateVideo, locate };
}
