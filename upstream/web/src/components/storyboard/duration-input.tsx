import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { commitDuration, stepDuration } from "@/utils/storyboard/shots";

/** 修正提示的黄框停留多久（毫秒） */
const FLASH_MS = 300;

/**
 * 时长单元格（设计 §3.4）：输入时允许暂时越界，失焦或回车才修正到 1–60 秒、1 位小数，
 * 修正了就闪一下黄框；空或不是数字的恢复原值。↑↓ 每次 ±0.5 秒并立即提交。
 */
export function DurationInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 外面改了时长（撤销等）时跟着变；正在输入时不会有外部改动
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (next: number, corrected: boolean) => {
    setText(String(next));
    if (next !== value) onChange(next);
    if (!corrected) return;
    setFlash(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(false), FLASH_MS);
  };

  return (
    <label
      title="时长范围 1–60 秒"
      className={cn(
        "hover:bg-chrome-hover focus-within:bg-background focus-within:ring-node-ring/60 flex h-9 items-center gap-0.5 rounded-lg px-2 transition-shadow focus-within:ring-1",
        flash && "ring-1 ring-amber-500/60 focus-within:ring-amber-500/60",
      )}
    >
      <input
        aria-label="时长（秒）"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const { value: next, corrected } = commitDuration(text, value);
          commit(next, corrected);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = commitDuration(text, value).value;
            commit(stepDuration(base, e.key === "ArrowUp" ? 1 : -1), false);
          }
        }}
        className="nodrag w-full min-w-0 bg-transparent text-right text-sm tabular-nums outline-none"
      />
      <span className="text-muted-foreground text-xs">s</span>
    </label>
  );
}
