import { Loader2 } from "lucide-react";

import { ChromeButton, ChromeSeparator } from "@/components/canvas/chrome/chrome";
import { AgentModelPicker } from "@/components/drama/agent-model-picker";
import { useStoryboardSplitUi } from "@/hooks/use-storyboard-split";
import { useStoryboardSplit } from "@/store/storyboard-split";

/**
 * 弹窗标题栏里的「模型 + 从剧本拆分镜」（设计 §6.1），放在清透胶囊里。
 * 模型下拉复用短剧的 Agent 模型下拉，选的模型记在本机，空状态里的按钮也用它；
 * 没连剧本 / 剧本没内容时按钮禁用，悬停说明原因。按钮只有文字，拆分中换成转圈。
 * @param id 分镜表节点 id
 */
export function SplitControls({ id }: { id: string }) {
  const model = useStoryboardSplit((s) => s.model);
  const setModel = useStoryboardSplit((s) => s.setModel);
  const { reason, busy, trigger } = useStoryboardSplitUi(id);

  return (
    <>
      <AgentModelPicker
        value={model}
        variant="chrome"
        onChange={setModel}
        disabledReason={busy ? () => "正在拆分镜" : undefined}
      />
      <ChromeSeparator />
      {/* 禁用的按钮不收鼠标事件，悬停提示挂在外面一层 */}
      <span title={reason || undefined} className="inline-flex">
        <ChromeButton
          onClick={trigger}
          disabled={!!reason}
          aria-busy={busy || undefined}
          aria-label={busy ? "拆分中" : "从剧本拆分镜"}
        >
          {busy && <Loader2 className="animate-spin" />}
          <span className="text-foreground text-sm">{busy ? "拆分中" : "从剧本拆分镜"}</span>
        </ChromeButton>
      </span>
    </>
  );
}
