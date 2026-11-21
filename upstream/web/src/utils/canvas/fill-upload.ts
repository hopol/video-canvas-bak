import type { AssetDto } from "@/api/asset/type";
import type { CanvasNodeData, MediaType, NodeKind } from "@/types";

import { takeUploadFile } from "./media";

/** 能往里放文件的节点种类，和它收的素材种类：角色卡收的是形象图 */
const FILL_MEDIA: Partial<Record<NodeKind, MediaType>> = {
  image: "image",
  video: "video",
  audio: "audio",
  character: "image",
};

const MEDIA_LABEL: Record<MediaType, string> = { image: "图片", video: "视频", audio: "音频" };

/**
 * 节点能不能往里上传文件：只有空节点可以——图片 / 视频 / 音频 / 角色卡，没有素材、没有生成历史、不在生成。
 * 生成失败、还没出过东西的也算空节点。已经生成过的不让上传，免得盖掉生成结果。
 * @param data 节点数据
 */
export function canFillNode(data: CanvasNodeData): boolean {
  if (!FILL_MEDIA[data.kind]) return false;
  if (data.status === "running" || data.uploadProgress !== undefined) return false;
  return !data.src && !data.assetId && !data.outputs?.length;
}

/** 节点文件框的 accept：只列节点收的种类 */
export function fillAccept(kind: NodeKind): string {
  return `${FILL_MEDIA[kind] ?? "image"}/*`;
}

/**
 * 收下要放进某个节点的文件：先按画布上传的规则认种类、卡大小，再看和节点对不对得上。
 * @param kind 节点种类
 * @param file 选中的文件
 */
export function takeFillFile(
  kind: NodeKind,
  file: File,
): { mediaType: MediaType } | { error: string } {
  const want = FILL_MEDIA[kind];
  if (!want) return { error: "这个节点不收文件" };
  if (!file.type.startsWith(`${want}/`)) return { error: `这个节点只收${MEDIA_LABEL[want]}` };
  const taken = takeUploadFile(file);
  return "error" in taken ? { error: taken.error } : { mediaType: taken.mediaType };
}

/** 失败的生成留下的任务字段：变成上传素材后都不该再有 */
const CLEAR_TASK = { error: null, taskId: undefined, pendingTaskIds: undefined } as const;

/**
 * 空的图片 / 视频 / 音频节点开始上传：变成上传素材（不出生成面板），进度交给上传流程写。
 * @param file 文件
 * @param mediaType 认出来的素材种类
 */
export function fillStartPatch(file: File, mediaType: MediaType): Partial<CanvasNodeData> {
  return {
    uploaded: true,
    fileName: file.name,
    mediaType,
    status: "running",
    uploadProgress: 0,
    ...CLEAR_TASK,
  };
}

/**
 * 从素材库选了一个素材放进空的图片 / 视频 / 音频节点：素材已在服务端，直接是完成的上传素材。
 * @param asset 选中的素材
 */
export function fillAssetPatch(asset: AssetDto): Partial<CanvasNodeData> {
  return {
    uploaded: true,
    src: asset.url,
    assetId: asset.id,
    mediaType: asset.kind,
    fileName: asset.fileName ?? undefined,
    status: "done",
    ...CLEAR_TASK,
  };
}

/** 文件拖进来以后怎么落：放进拖到的那个空节点，或者按新建节点处理 */
export type FileDropPlan = { mode: "fill"; id: string } | { mode: "create" };

/**
 * 文件拖到画布 / 资产列表上松手时：只拖了一个文件、正好落在一个空节点上，就放进这个节点；
 * 其余情况（落在空白处、落在已有素材的节点上、一次拖了好几个）都按新建节点处理。
 * @param files 拖进来的文件
 * @param target 松手处的节点，没有就是 null
 */
export function planFileDrop(
  files: readonly File[],
  target: { id: string; data: CanvasNodeData } | null,
): FileDropPlan {
  if (files.length === 1 && target && canFillNode(target.data)) {
    return { mode: "fill", id: target.id };
  }
  return { mode: "create" };
}
