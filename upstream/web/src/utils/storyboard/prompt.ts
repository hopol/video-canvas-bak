import type { StoryboardShot } from "@/types";

/** 去掉句末的句号，免得拼接时出现「。。」 */
const trimStop = (text: string) => text.trim().replace(/[。.]+$/, "");

/**
 * 一行镜头拼成分镜图的提示词（PRD 6.5）：`{景别}，{运镜}。{画面描述}。{动作/走位}`。
 * 景别、运镜缺哪个就省哪个，没有动作就不留空句；对白不进图片提示词（图里没有声音）。
 */
export function shotImagePrompt(shot: StoryboardShot): string {
  const sentences = [
    [shot.shot, shot.camera].filter(Boolean).join("，"),
    trimStop(shot.scene),
    trimStop(shot.action),
  ].filter(Boolean);
  return sentences.map((s) => `${s}。`).join("");
}
