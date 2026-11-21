import { useState } from "react";
import { AudioLines } from "lucide-react";

import { AudioPlayer } from "@/components/canvas/audio-player";
import { DialogSession } from "@/components/dialog-session";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { VOICE_LANG_OPTIONS, voiceGroupLabel, voiceLangOf } from "@/utils/assets/official-voices";

import type { AssetPreviewEntry } from "./asset-preview";

/** 头像下面的分类小标签：语言、人群；普通音频没有分类就不出 */
function voiceTags(entry: AssetPreviewEntry): string[] {
  const { asset } = entry;
  const lang = voiceLangOf(asset);
  const langLabel = VOICE_LANG_OPTIONS.find((option) => option.value === lang)?.label;
  return [langLabel, voiceGroupLabel(asset)].filter((tag): tag is string => !!tag);
}

/** 播放卡正文：人物头像 + 名字 + 标签 + 波形播放器；头像的颜色晕在整张卡的背景上 */
function AudioPreviewBody({ entry }: { entry: AssetPreviewEntry }) {
  const [playing, setPlaying] = useState(false);
  const { asset } = entry;
  const tags = voiceTags(entry);
  return (
    <div
      data-slot="audio-preview"
      className="relative isolate flex flex-col items-center overflow-hidden px-7 pt-11 pb-7 text-center"
    >
      {asset.thumbnailUrl && (
        <img
          alt=""
          aria-hidden
          src={asset.thumbnailUrl}
          className="absolute inset-0 -z-20 size-full scale-150 object-cover opacity-45 blur-3xl saturate-150"
        />
      )}
      <div
        aria-hidden
        className="to-popover via-popover/70 absolute inset-0 -z-10 bg-linear-to-b from-transparent"
      />
      <div
        data-slot="audio-preview-avatar"
        data-playing={playing}
        className={cn(
          "relative grid size-32 place-items-center rounded-full",
          "bg-chrome-hover ring-chrome-border shadow-2xl ring-1 transition-transform duration-300",
          playing && "scale-105",
        )}
      >
        {playing && (
          <span
            aria-hidden
            className="ring-foreground/25 absolute -inset-2 rounded-full ring-2 motion-safe:animate-ping motion-reduce:hidden"
          />
        )}
        {asset.thumbnailUrl ? (
          <img
            alt=""
            src={asset.thumbnailUrl}
            draggable={false}
            className="size-full rounded-full object-cover"
          />
        ) : (
          <AudioLines className="text-muted-foreground size-12" />
        )}
      </div>
      <DialogTitle className="mt-5 max-w-full truncate text-xl font-semibold tracking-tight">
        {entry.label}
      </DialogTitle>
      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="bg-chrome-hover ring-chrome-border text-muted-foreground rounded-full px-2.5 py-0.5 text-xs ring-1"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="bg-chrome-hover ring-chrome-border mt-6 h-36 w-full rounded-2xl ring-1 [corner-shape:squircle]">
        <AudioPlayer src={asset.url} autoPlay onPlayingChange={setPlaying} />
      </div>
    </div>
  );
}

/**
 * 音频预览弹窗：音色（和普通音频）点开后的播放卡，复用画布的 AudioPlayer（波形、拖进度、播放暂停）。
 * 有头像的音色把头像放大居中，并把它的颜色晕成整张卡的背景；没有头像的音频用图标占位。
 * 弹窗常驻挂载，关闭时留着最后一条内容播完退出动画（coding-standards 6.3），每次打开重新挂载、重新自动播放。
 * @param entry 正在看的音频；undefined 表示关着
 * @param onClose 关闭
 */
export function AudioPreviewDialog({
  entry,
  onClose,
}: {
  entry: AssetPreviewEntry | undefined;
  onClose: () => void;
}) {
  // 关闭时 entry 已经变成 undefined：记下最后一条，退出动画期间正文才有东西可显示
  const [last, setLast] = useState(entry);
  if (entry && entry !== last) setLast(entry);
  const open = entry !== undefined;
  const shown = entry ?? last;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[min(92vw,400px)] gap-0 overflow-hidden rounded-3xl p-0 [corner-shape:squircle] sm:max-w-100">
        <DialogSession open={open}>{shown && <AudioPreviewBody entry={shown} />}</DialogSession>
      </DialogContent>
    </Dialog>
  );
}
