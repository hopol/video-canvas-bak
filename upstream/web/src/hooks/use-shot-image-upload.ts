import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import { uploadAsset } from "@/api/asset";
import type { AssetDto } from "@/api/asset/type";
import type { CanvasEdge, CanvasNode, CanvasNodeData } from "@/types";
import { appendOutput, isGenerating } from "@/utils/canvas/outputs";
import { buildShotImageNode } from "@/utils/storyboard/image-node";
import { emptyStoryboard, linkShot, removeShotImage } from "@/utils/storyboard/shots";
import { firstImageFile, takeShotImageFile } from "@/utils/storyboard/upload";

/** 上传中的各行：行 id -> 传了多少（0–100） */
export type ShotUploads = Record<string, number>;

/**
 * 分镜图的手动上传（PRD 6.5、AC9）：点击选文件和拖入共用一条路径，上传中显示进度，传完落到图片节点上——
 * 这一行还没有图片节点就按镜号在分镜表右侧建一个（和按行生成同一个位置）、连线并关联；已经有了就把上传的图
 * 作为这个节点的新一版，旧版留在节点历史里。上传的图不自动提交生成。
 * 失败（格式、大小、网络）这一格回到原状，toast 说明原因。关联的节点正在生成时不收，免得生成结果回来把它盖掉。
 * 各行各传、互不阻塞；同一行正在传时再来一张直接忽略。上传期间这一行被删了不写回。
 * @param storyboardId 分镜表节点 id
 */
export function useShotImageUpload(storyboardId: string) {
  const { getNode, getNodes, addNodes, addEdges, updateNodeData } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();
  const [uploads, setUploads] = useState<ShotUploads>({});
  // 上传是异步的：用 ref 挡住同一行的并发，state 只管显示
  const running = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** 这一行关联的、还在画布上的图片节点 */
  const linkedImageNode = useCallback(
    (shotId: string) => {
      const shot = getNode(storyboardId)?.data.storyboard?.shots.find((s) => s.id === shotId);
      const node = shot?.imageNodeId ? getNode(shot.imageNodeId) : undefined;
      return node?.data.kind === "image" ? node : undefined;
    },
    [getNode, storyboardId],
  );

  /** 传好的素材落到这一行的图片节点上：复用关联的节点，没有就新建并关联 */
  const placeAsset = useCallback(
    (shotId: string, asset: AssetDto, file: File) => {
      const source = getNode(storyboardId);
      const index = source?.data.storyboard?.shots.findIndex((s) => s.id === shotId) ?? -1;
      if (!source || index < 0) return;
      const uploaded: Partial<CanvasNodeData> = {
        status: "done",
        error: null,
        uploaded: true,
        fileName: file.name,
        ...(asset.width && asset.height ? { mediaAspect: asset.width / asset.height } : {}),
      };
      const linked = linkedImageNode(shotId);
      if (linked) {
        updateNodeData(linked.id, (node) => ({
          ...uploaded,
          ...appendOutput(node.data, {
            id: asset.id,
            src: asset.url,
            mediaType: "image",
            assetId: asset.id,
            createdAt: Date.now(),
          }),
        }));
        return;
      }
      const { node, edge } = buildShotImageNode({
        source,
        nodes: getNodes(),
        index,
        data: { ...uploaded, src: asset.url, assetId: asset.id, mediaType: "image" },
      });
      addNodes(node);
      addEdges(edge);
      updateNodeData(storyboardId, (board) => ({
        storyboard: linkShot(board.data.storyboard ?? emptyStoryboard(), shotId, {
          imageNodeId: node.id,
        }),
      }));
    },
    [addEdges, addNodes, getNode, getNodes, linkedImageNode, storyboardId, updateNodeData],
  );

  const uploadFile = useCallback(
    async (shotId: string, file: File) => {
      if (running.current.has(shotId)) return;
      const check = takeShotImageFile(file);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      const linked = linkedImageNode(shotId);
      if (linked && isGenerating(linked.data)) {
        toast.error("这一镜的分镜图正在生成，生成完再上传");
        return;
      }
      running.current.add(shotId);
      const setProgress = (progress: number) =>
        setUploads((current) => ({ ...current, [shotId]: progress }));
      setProgress(0);
      try {
        const asset = await uploadAsset(file, {
          onProgress: (progress) => {
            if (mounted.current) setProgress(progress);
          },
        });
        placeAsset(shotId, asset, file);
      } catch {
        // 上传失败的全局提示由请求层统一弹，这一格回到原状
      } finally {
        running.current.delete(shotId);
        if (mounted.current) setUploads(({ [shotId]: _done, ...rest }) => rest);
      }
    },
    [linkedImageNode, placeAsset],
  );

  /** 点「上传分镜图」：临时建一个文件输入框选图，选完上传（不挂进页面，不用持有元素的 ref） */
  const pickFile = useCallback(
    (shotId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) void uploadFile(shotId, file);
      };
      input.click();
    },
    [uploadFile],
  );

  /** 拖进来的一批文件：取第一张图片上传，没有图片就不理 */
  const dropFiles = useCallback(
    (shotId: string, files: Iterable<File>) => {
      const file = firstImageFile(files);
      if (file) void uploadFile(shotId, file);
    },
    [uploadFile],
  );

  /** 移除旧数据里手传的图（新上传的都落成图片节点，删节点即可） */
  const removeImage = useCallback(
    (shotId: string) =>
      updateNodeData(storyboardId, (node) => ({
        storyboard: removeShotImage(node.data.storyboard ?? emptyStoryboard(), shotId),
      })),
    [storyboardId, updateNodeData],
  );

  return { uploads, pickFile, dropFiles, removeImage };
}
