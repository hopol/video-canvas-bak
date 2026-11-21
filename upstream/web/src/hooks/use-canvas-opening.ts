import { useCallback, useEffect, useRef, useState } from "react";

import { getCanvas } from "@/api/canvas";
import { draftStore } from "@/utils/canvas/draft-idb";
import {
  loadCanvasForEditing,
  loadCanvasPreview,
  type OpenedCanvas,
} from "@/utils/canvas/open-canvas";
import { getCurrentUserId } from "@/utils/storage/user-id";

import type { CanvasLockStatus } from "./use-canvas-lock";

/**
 * 按编辑锁的结果打开画布：
 * - held：读云端，再和本地草稿对账（和以前一样）
 * - waiting：只读预览，只读云端、不碰草稿
 * - checking：什么都不做，等锁的结果
 *
 * 从只读转成可编辑时要重新拉一份：对方在这期间可能刚存过盘，手上这份已经旧了，
 * 拿旧版本号去保存会直接撞 409。mountSeq 每次加载完加一，页面把它拼进 key 就能强制重挂编辑器。
 */
export function useCanvasOpening(canvasId: string | undefined, status: CanvasLockStatus) {
  const [opened, setOpened] = useState<OpenedCanvas | null>(null);
  const [error, setError] = useState(false);
  const [mountSeq, setMountSeq] = useState(0);
  /** 上一次加载用的是哪种口径；换画布时清空 */
  const loadedRef = useRef<"edit" | "preview" | null>(null);

  useEffect(() => {
    loadedRef.current = null;
    setOpened(null);
    setError(false);
  }, [canvasId]);

  const mode = status === "held" ? "edit" : status === "waiting" ? "preview" : null;

  useEffect(() => {
    if (!canvasId || !mode) return;
    const previous = loadedRef.current;
    if (previous === mode) return;
    // 编辑权被拿走了：眼前这份图留着继续看，不重拉——重拉会把还没存上的改动直接盖掉
    if (previous === "edit" && mode === "preview") return;
    loadedRef.current = mode;
    let active = true;
    const userId = getCurrentUserId();
    const request =
      mode === "edit"
        ? loadCanvasForEditing({
            canvasId,
            userId,
            getCanvas,
            loadDraft: (user, id) => draftStore.load(user, id),
            removeDraft: (id) => (userId ? draftStore.remove(userId, id) : Promise.resolve()),
          })
        : loadCanvasPreview({ canvasId, getCanvas });
    void request
      .then((value) => {
        if (!active) return;
        setOpened(value);
        setMountSeq((seq) => seq + 1);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [canvasId, mode]);

  const replace = useCallback((value: OpenedCanvas) => {
    setOpened(value);
    setMountSeq((seq) => seq + 1);
  }, []);

  return { opened, error, mountSeq, readOnly: status !== "held", replace };
}
