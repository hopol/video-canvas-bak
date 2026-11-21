import { FolderOpen, Upload } from "lucide-react";

import type { FillUploadActions } from "@/hooks/use-fill-upload";
import { useCanvasReadOnly } from "@/utils/canvas/read-only";

/** 分段胶囊里的一段（同 ChromeSegment）；nodrag 让按下时不带走节点 */
const SEGMENT_CLASS =
  "nodrag hover:bg-chrome-hover text-foreground focus-visible:ring-ring/60 inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs transition-colors duration-150 outline-none focus-visible:ring-2 [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * 空节点占位里的「上传」「素材库」：一条半透明分段胶囊（coding-standards 6.1），选好的素材放进这个节点，节点变成上传素材。
 * @param id 节点 id
 * @param actions 画布的放素材动作
 */
export function NodeFillActions({ id, actions }: { id: string; actions: FillUploadActions }) {
  // 只读预览里不摆：上传和素材库都要写节点
  const readOnly = useCanvasReadOnly();
  if (readOnly) return null;
  return (
    <div className="bg-chrome ring-chrome-border flex items-center gap-0.5 rounded-full p-1 shadow-sm ring-1 backdrop-blur-xl backdrop-saturate-150">
      <button type="button" className={SEGMENT_CLASS} onClick={() => actions.pickFile(id)}>
        <Upload />
        上传
      </button>
      <span aria-hidden className="bg-chrome-border h-4 w-px shrink-0" />
      <button type="button" className={SEGMENT_CLASS} onClick={() => actions.pickAsset(id)}>
        <FolderOpen />
        素材库
      </button>
    </div>
  );
}
