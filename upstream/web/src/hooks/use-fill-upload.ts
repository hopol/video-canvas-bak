import { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";

import { uploadAsset } from "@/api/asset";
import type { AssetDto } from "@/api/asset/type";
import { UPLOAD_STACK_COLUMNS, UPLOAD_STACK_GAP } from "@/constants/canvas";
import type { CanvasEdge, CanvasNodeData, FlowNode, MediaType, NodeKind } from "@/types";
import {
  canFillNode,
  fillAccept,
  fillAssetPatch,
  fillStartPatch,
  takeFillFile,
} from "@/utils/canvas/fill-upload";
import { isGroupNode } from "@/utils/canvas/group";
import { uploadRunner } from "@/utils/canvas/upload-runner";
import { applyPickedAssets } from "@/utils/characters/node-character";

/** 往空节点里放素材的动作：节点空状态、短剧资产列表、文件拖放共用；引用稳定 */
export type FillUploadActions = {
  /** 把一个本地文件放进空节点；节点不空或文件种类不对时提示并作罢 */
  fillFile: (id: string, file: File) => void;
  /** 弹系统文件框给这个空节点选文件 */
  pickFile: (id: string) => void;
  /** 打开素材库给这个空节点选一个素材 */
  pickAsset: (id: string) => void;
  /** 把素材库里选好的素材放进空节点 */
  fillAsset: (id: string, asset: AssetDto) => void;
  /** 每个文件新建一个指定种类的节点并放进去，从视口中心起按网格排开；返回建出的节点 id */
  createFilled: (kind: NodeKind, files: File[]) => string[];
};

const FillUploadContext = createContext<FillUploadActions | null>(null);

export const FillUploadProvider = FillUploadContext.Provider;

/** 取往空节点里放素材的动作；不在画布编辑器里时为 null（节点组件单独渲染的场景） */
export function useFillUploadActions(): FillUploadActions | null {
  return useContext(FillUploadContext);
}

/** 不合规时给的话，同一句不叠着弹 */
const warn = (text: string) => toast.error(text, { id: "fill-upload" });

/**
 * 往空节点里放素材：图片 / 视频 / 音频节点变成上传素材（uploaded，不出生成面板，接进来的线一并去掉），
 * 角色卡把素材当形象主图（仍是角色卡，能生成、能设音色）。已经有素材或生成过的节点不收。
 * 媒体节点的上传走画布共用的 uploadRunner（进度、失败重试、删节点中止都现成）；
 * 角色卡上传期间只在节点上记进度（uploadProgress），传完写主图。
 */
export function useFillUpload({
  getNode,
  patchNode,
  setEdges,
  addNodeAt,
  origin,
  openAssetPicker,
}: {
  getNode: (id: string) => FlowNode | undefined;
  /** 改一个节点的数据；节点已经被删了就什么也不做 */
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  setEdges: (update: (edges: CanvasEdge[]) => CanvasEdge[]) => void;
  /** 在画布坐标处建节点，返回节点 id */
  addNodeAt: (
    kind: NodeKind,
    flow: { x: number; y: number },
    extra?: Partial<CanvasNodeData>,
  ) => string;
  /** 批量新建时第一个节点的落点（画布坐标） */
  origin: () => { x: number; y: number };
  /** 打开锁定种类、单选的素材库弹框，选好后交回 fillAsset */
  openAssetPicker: (id: string, kind: MediaType) => void;
}): FillUploadActions {
  /** 上传素材不生成，接进来的线没有用处 */
  const dropIncoming = useCallback(
    (id: string) => setEdges((edges) => edges.filter((edge) => edge.target !== id)),
    [setEdges],
  );

  /** 角色卡：传文件期间记进度，传完把素材写成主图 */
  const uploadCharacter = useCallback(
    async (id: string, file: File) => {
      try {
        const asset = await uploadAsset(file, {
          onProgress: (percent) => patchNode(id, { uploadProgress: percent }),
        });
        const current = getNode(id);
        if (!current || isGroupNode(current)) return;
        const { patch } = applyPickedAssets(current.data, [asset], "main", "upload");
        patchNode(id, { ...patch, uploadProgress: undefined });
      } catch {
        // 失败提示由请求层统一弹出，这里只撤掉进度，卡片回到空状态可以再传
        patchNode(id, { uploadProgress: undefined });
      }
    },
    [getNode, patchNode],
  );

  /** 已确认节点是空的、文件种类对得上之后开始放 */
  const startFill = useCallback(
    (id: string, kind: NodeKind, file: File, mediaType: MediaType) => {
      if (kind === "character") {
        patchNode(id, { uploadProgress: 0 });
        void uploadCharacter(id, file);
        return;
      }
      dropIncoming(id);
      patchNode(id, fillStartPatch(file, mediaType));
      void uploadRunner.start(id, file, patchNode);
    },
    [dropIncoming, patchNode, uploadCharacter],
  );

  /** 节点还在、是空的；否则提示并返回 null */
  const emptyNode = useCallback(
    (id: string) => {
      const node = getNode(id);
      if (!node || isGroupNode(node)) return null;
      if (!canFillNode(node.data)) {
        warn("只有空节点能上传");
        return null;
      }
      return node;
    },
    [getNode],
  );

  const fillFile = useCallback(
    (id: string, file: File) => {
      const node = emptyNode(id);
      if (!node) return;
      const taken = takeFillFile(node.data.kind, file);
      if ("error" in taken) return warn(taken.error);
      startFill(id, node.data.kind, file, taken.mediaType);
    },
    [emptyNode, startFill],
  );

  const pickFile = useCallback(
    (id: string) => {
      const node = emptyNode(id);
      if (!node) return;
      // 每次临时建一个 input，不挂进页面；同一个文件连选两次也有反应
      const input = document.createElement("input");
      input.type = "file";
      input.accept = fillAccept(node.data.kind);
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) fillFile(id, file);
      };
      input.click();
    },
    [emptyNode, fillFile],
  );

  const pickAsset = useCallback(
    (id: string) => {
      const node = emptyNode(id);
      if (!node) return;
      openAssetPicker(id, node.data.kind === "character" ? "image" : (node.data.kind as MediaType));
    },
    [emptyNode, openAssetPicker],
  );

  const fillAsset = useCallback(
    (id: string, asset: AssetDto) => {
      const node = emptyNode(id);
      if (!node) return;
      if (node.data.kind === "character") {
        const { patch } = applyPickedAssets(node.data, [asset], "main", "library");
        patchNode(id, patch);
        return;
      }
      if (asset.kind !== node.data.kind) return warn("素材种类和节点对不上");
      dropIncoming(id);
      patchNode(id, fillAssetPatch(asset));
    },
    [dropIncoming, emptyNode, patchNode],
  );

  const createFilled = useCallback(
    (kind: NodeKind, files: File[]) => {
      const start = origin();
      const ids: string[] = [];
      const rejected: string[] = [];
      for (const file of files) {
        const taken = takeFillFile(kind, file);
        if ("error" in taken) {
          rejected.push(taken.error);
          continue;
        }
        const index = ids.length;
        const flow = {
          x: start.x + (index % UPLOAD_STACK_COLUMNS) * UPLOAD_STACK_GAP.x,
          y: start.y + Math.floor(index / UPLOAD_STACK_COLUMNS) * UPLOAD_STACK_GAP.y,
        };
        // 刚建的节点还没进 xyflow 的节点表，直接带着上传前的数据建出来，不再按 id 查
        const id = addNodeAt(
          kind,
          flow,
          kind === "character" ? { uploadProgress: 0 } : fillStartPatch(file, taken.mediaType),
        );
        ids.push(id);
        if (kind === "character") void uploadCharacter(id, file);
        else void uploadRunner.start(id, file, patchNode);
      }
      if (rejected.length) {
        warn(
          rejected.length === 1 ? rejected[0] : `${rejected.length} 个文件没收下：${rejected[0]}`,
        );
      }
      return ids;
    },
    [addNodeAt, origin, patchNode, uploadCharacter],
  );

  return useMemo(
    () => ({ fillFile, pickFile, pickAsset, fillAsset, createFilled }),
    [createFilled, fillAsset, fillFile, pickAsset, pickFile],
  );
}
