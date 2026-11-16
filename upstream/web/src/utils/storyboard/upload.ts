import { takeUploadFile } from "@/utils/canvas/media";

/** 分镜图上传前的检查结果 */
export type ShotImageCheck = { ok: true } | { ok: false; reason: string };

/**
 * 分镜图只收图片，并按上传大小上限卡一遍。
 * 不是图片时给分镜图专属的说法（复用的文件检查给的是「只收图片、视频和音频」，对这里没有意义）。
 */
export function takeShotImageFile(file: File): ShotImageCheck {
  if (!file.type.startsWith("image/")) return { ok: false, reason: "分镜图只能上传图片" };
  const taken = takeUploadFile(file);
  return "error" in taken ? { ok: false, reason: taken.error } : { ok: true };
}

/** 拖进来的一批文件里取第一张图片，别的忽略；没有图片返回 null（非图片拖进来时格子不该有任何反应） */
export function firstImageFile(files: Iterable<File>): File | null {
  for (const file of files) if (file.type.startsWith("image/")) return file;
  return null;
}
