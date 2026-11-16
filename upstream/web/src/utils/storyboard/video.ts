import type { Capabilities, GenerationOp, ParamField } from "@/api/model/type";
import type { StoryboardShot } from "@/types";

import { shotImagePrompt } from "./prompt";

/** 整数秒，至少 1 */
const wholeSeconds = (seconds: number) => Math.max(1, Math.round(seconds));

/**
 * 视频时长取模型支持的最接近值（PRD 6.6）。参数名固定叫 duration：
 * - 枚举：取最接近的可选值，一样近取小的（少花积分）；
 * - 数字范围：取整后夹进 min–max，再按步长从 min 起对齐；
 * - 模型没声明（没有这个参数、枚举没有选项、数字缺范围）：直接用行时长，取整。
 * @param seconds 这一行的时长
 * @param field 模型 capabilities.params.duration
 */
export function pickVideoDuration(seconds: number, field: ParamField | undefined): number {
  const target = wholeSeconds(seconds);
  if (field?.type === "enum") {
    const options = (field.options ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (options.length === 0) return target;
    return options.reduce((best, n) => {
      const d = Math.abs(n - seconds);
      const bd = Math.abs(best - seconds);
      return d < bd || (d === bd && n < best) ? n : best;
    });
  }
  if (field?.type === "number" && field.min !== undefined && field.max !== undefined) {
    const step = field.step && field.step > 0 ? field.step : 1;
    const clamped = Math.min(field.max, Math.max(field.min, target));
    const aligned = field.min + Math.round((clamped - field.min) / step) * step;
    return Math.min(field.max, Math.max(field.min, aligned));
  }
  return target;
}

/** 模型支持的时长说明：枚举列出可选值，数字范围写区间；没声明时为空串 */
function supportedDurations(field: ParamField | undefined): string {
  if (field?.type === "enum") {
    const options = (field.options ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    return options.map((n) => `${n}s`).join(" / ");
  }
  if (field?.type === "number" && field.min !== undefined && field.max !== undefined) {
    return `${field.min}–${field.max}s`;
  }
  return "";
}

/**
 * 行时长格下面「实际 Ns」的提示（设计 §6.7）：已建视频节点、节点当前时长和这一行的时长不一样才出现。
 * 行时长带小数时按取整后的值比（4.6 秒和 5 秒视为一样，别为 0.4 秒打扰用户）。
 * @param rowSeconds 这一行的时长
 * @param nodeSeconds 视频节点当前的时长；还没建节点或节点没有时长为 undefined
 * @param field 模型 capabilities.params.duration，只用来写悬停说明
 */
export function actualDurationHint(
  rowSeconds: number,
  nodeSeconds: number | undefined,
  field: ParamField | undefined,
): { actual: number; title: string } | null {
  if (nodeSeconds === undefined || nodeSeconds === wholeSeconds(rowSeconds)) return null;
  const supported = supportedDurations(field);
  return {
    actual: nodeSeconds,
    title: supported ? `所选视频模型只支持 ${supported}` : "视频时长和这一行的时长不一样",
  };
}

/**
 * 一行镜头拼成视频提示词（PRD 6.6）：出图那套模板，再加上对白。
 * 对白放在最后，写成「对白：……」，句号收尾；没有对白就和分镜图提示词一样。
 */
export function shotVideoPrompt(shot: StoryboardShot): string {
  const base = shotImagePrompt(shot);
  const dialogue = shot.dialogue.trim().replace(/[。.]+$/, "");
  return dialogue ? `${base}对白：${dialogue}。` : base;
}

/** 分镜图在视频里的用法 */
export type VideoImageRole = {
  /** first-frame 连成首帧；reference 连成参考图 */
  role: "first-frame" | "reference";
  /** 视频节点要用的生成方式 */
  op: GenerationOp;
};

/**
 * 分镜图当首帧还是参考图，按所选视频模型的能力定（PRD 6.6，复用现有的连线能力判断：图片参考要开着）：
 * 支持图生视频就是首帧（分镜图就是这一镜的第一个画面），其次支持全能参考就是参考图；
 * 这一行没有分镜图、模型不收图片参考、两种方式都不支持时返回 null，只写提示词。
 * @param hasImage 这一行有没有分镜图（手传的或关联图片节点已生成的）
 */
export function videoImageRole(
  caps: Capabilities | undefined,
  hasImage: boolean,
): VideoImageRole | null {
  if (!hasImage || !caps?.refs?.image?.on) return null;
  const ops = caps.ops ?? [];
  if (ops.includes("i2v")) return { role: "first-frame", op: "i2v" };
  if (ops.includes("omni")) return { role: "reference", op: "omni" };
  return null;
}

/** 这一行的分镜图落在哪：关联的图片节点（已有成图），或手传的素材 */
export type VideoImageSource =
  | { kind: "node"; nodeId: string }
  | { kind: "asset"; assetId: string; src: string }
  | null;

/** 新建视频节点要带的内容 */
export type VideoNodeSeed = {
  /** 提示词 */
  prompt: string;
  /** 写进节点 params 的内容：prompt，加上 op、duration、手动参考图（有才写） */
  params: Record<string, unknown>;
  /** params.images 里手动参考图的展示信息，和 params.images 配套 */
  paramAssets?: Record<string, { url: string; mediaType: "image" }>;
  /** 要从这个图片节点连一根线进视频节点（分镜图当首帧 / 参考图）；不用连线为 null */
  linkImageNodeId: string | null;
};

/**
 * 按行建视频节点时节点该是什么样（PRD 6.6）：
 * - 提示词用出图那套模板加对白；
 * - 时长取模型支持的最接近值，模型没有时长参数就不写，让节点用模型默认；
 * - 分镜图怎么用看模型能力（见 videoImageRole）：关联图片节点的图连线进来，手传的图写成手动参考素材；
 *   模型不收图片参考或两种方式都不支持时只写提示词。
 */
export function buildVideoNodeSeed(input: {
  shot: StoryboardShot;
  caps: Capabilities | undefined;
  image: VideoImageSource;
}): VideoNodeSeed {
  const { shot, caps, image } = input;
  const prompt = shotVideoPrompt(shot);
  const params: Record<string, unknown> = { prompt };
  const durationField = caps?.params?.duration;
  if (durationField) params.duration = pickVideoDuration(shot.duration, durationField);
  const role = videoImageRole(caps, image !== null);
  if (!role || !image) return { prompt, params, linkImageNodeId: null };
  params.op = role.op;
  if (image.kind === "node") return { prompt, params, linkImageNodeId: image.nodeId };
  params.images = [image.assetId];
  return {
    prompt,
    params,
    paramAssets: { [image.assetId]: { url: image.src, mediaType: "image" } },
    linkImageNodeId: null,
  };
}
