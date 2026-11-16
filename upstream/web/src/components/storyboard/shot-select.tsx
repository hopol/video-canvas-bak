import type { ComponentType } from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Footprints,
  Hand,
  Lock,
  MoveHorizontal,
  Plane,
  RotateCw,
  ScanSearch,
  Wind,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAMERA_MOVES, SHOT_SIZE_ABBR, SHOT_SIZES } from "@/constants/storyboard";
import { cn } from "@/lib/utils";
import type { CameraMove, ShotSize } from "@/types";

/** 运镜选项左侧的图标 */
const CAMERA_ICON: Record<CameraMove, ComponentType<{ className?: string }>> = {
  固定: Lock,
  推: ZoomIn,
  拉: ZoomOut,
  摇: MoveHorizontal,
  移: ArrowRightLeft,
  跟: Footprints,
  升: ArrowUp,
  降: ArrowDown,
  环绕: RotateCw,
  变焦: ScanSearch,
  甩镜: Wind,
  手持: Hand,
  航拍: Plane,
};

/** 景别图示里人形的放大倍数，从大远景到大特写：同一个人在框里越来越大 */
const FRAMING_SCALE: Record<ShotSize, number> = {
  大远景: 0.25,
  远景: 0.4,
  全景: 0.7,
  中景: 1.1,
  中近景: 1.5,
  近景: 1.9,
  特写: 2.6,
  大特写: 3.6,
};

/** 景别图示：16px 取景框，人形按景别放大，出框的部分被框裁掉，一眼看出远近 */
export function FramingIcon({ size, className }: { size: ShotSize; className?: string }) {
  const k = FRAMING_SCALE[size];
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-4 shrink-0", className)}>
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="2" fill="none" stroke="currentColor" />
      <g transform={`translate(8 6) scale(${k}) translate(-8 -6)`} fill="currentColor">
        <circle cx="8" cy="5" r="1.6" />
        <path d="M5.2 11.5c0-1.9 1.25-3.3 2.8-3.3s2.8 1.4 2.8 3.3Z" />
      </g>
    </svg>
  );
}

/** 单元格里的下拉触发器：平时只有文字，悬停 / 聚焦才出底色，50 行时不满屏框框 */
const TRIGGER_CLASS =
  "nodrag hover:bg-chrome-hover focus-visible:bg-background focus-visible:ring-node-ring/60 h-9 w-full border-0 bg-transparent px-2 shadow-none focus-visible:ring-1 dark:bg-transparent dark:hover:bg-chrome-hover";

/** 下拉面板：清透浮层（编码规范 6.1） */
const CONTENT_CLASS =
  "bg-chrome ring-chrome-border min-w-44 rounded-2xl p-1 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150";

/** 下拉选项：行高 36px */
const ITEM_CLASS = "h-9 rounded-xl pl-2";

/** 景别下拉：中文名 + 取景框图示 + 英文缩写，只能从枚举里选 */
export function ShotSizeSelect({
  value,
  onChange,
}: {
  value: ShotSize | "";
  onChange: (value: ShotSize) => void;
}) {
  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(v as ShotSize)}>
      <SelectTrigger aria-label="景别" className={TRIGGER_CLASS}>
        <SelectValue placeholder="景别" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className={CONTENT_CLASS}>
        {SHOT_SIZES.map((size) => (
          <SelectItem key={size} value={size} className={ITEM_CLASS}>
            <FramingIcon size={size} className="text-muted-foreground" />
            <span className="flex-1">{size}</span>
            <span className="text-muted-foreground text-xs">{SHOT_SIZE_ABBR[size]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 运镜下拉：图标 + 中文名，只能从枚举里选 */
export function CameraMoveSelect({
  value,
  onChange,
}: {
  value: CameraMove | "";
  onChange: (value: CameraMove) => void;
}) {
  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(v as CameraMove)}>
      <SelectTrigger aria-label="运镜" className={TRIGGER_CLASS}>
        <SelectValue placeholder="运镜" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className={CONTENT_CLASS}>
        {CAMERA_MOVES.map((move) => {
          const Icon = CAMERA_ICON[move];
          return (
            <SelectItem key={move} value={move} className={ITEM_CLASS}>
              <Icon className="text-muted-foreground" />
              <span className="flex-1">{move}</span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
