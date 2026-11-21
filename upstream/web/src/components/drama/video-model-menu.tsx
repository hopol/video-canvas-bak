import type { ModelInfo } from "@/api/model/type";
import { ModelLogo } from "@/components/model-logo";
import { OptionRow } from "@/components/option-menu";
import { modelSummary, videoModelSupport } from "@/utils/drama/video-models";

import { ChipPopover } from "./pickers";

/** 模型能不能选：不能选时写原因（置灰显示） */
type Support = (info: ModelInfo) => { ok: boolean; reason: string | null };

/** 都能选 */
const anyModel: Support = () => ({ ok: true, reason: null });

/**
 * 模型选择胶囊（短剧里选视频 / 图片模型共用）：前面是厂商 logo，每项下面一行副文案，
 * 不能选的置灰并写原因。传了 defaultLabel 时列表顶部多一项「不指定」，选它回调空串。
 */
export function ModelMenu({
  models,
  loading,
  model,
  onPick,
  support = anyModel,
  summary,
  kindName,
  variant = "bar",
  size,
  prefix,
  defaultLabel,
  fallback,
  title,
}: {
  models: readonly ModelInfo[];
  loading: boolean;
  /** 当前选中的模型；undefined = 没选（显示 defaultLabel 或「没有可用的…」） */
  model: ModelInfo | undefined;
  onPick: (key: string) => void;
  support?: Support;
  /** 每项的副文案；不传没有 */
  summary?: (info: ModelInfo) => string;
  /** 模型种类名，用于空状态文案，如「视频」「图片」 */
  kindName: string;
  variant?: "chip" | "bar" | "chrome" | "field";
  size?: "default" | "lg";
  /** 胶囊文字前缀，如「人物」 */
  prefix?: string;
  /** 「不指定」项的文案（如「跟随默认」）；不传则没有这一项 */
  defaultLabel?: string;
  /** 没选时胶囊上显示的模型（如「跟随默认」实际会用的那个）；下拉里仍是「跟随默认」打勾 */
  fallback?: ModelInfo;
  title?: string;
}) {
  const shown = model ?? fallback;
  const name =
    shown?.label ??
    (defaultLabel && !loading ? defaultLabel : loading ? "加载模型…" : `没有可用的${kindName}模型`);
  return (
    <ChipPopover
      variant={variant}
      size={size}
      icon={
        shown && (
          <ModelLogo vendor={shown.vendor} name={shown.label} className="size-5 rounded-md" />
        )
      }
      label={prefix ? `${prefix} · ${name}` : name}
      title={title}
      width="w-80"
      contentClassName="max-h-80 overflow-y-auto"
    >
      {(close) => (
        <>
          {defaultLabel && (
            <OptionRow
              active={!model}
              onClick={() => {
                close();
                onPick("");
              }}
            >
              <span className="min-w-0 flex-1 truncate">{defaultLabel}</span>
            </OptionRow>
          )}
          {models.length === 0 && (
            <div className="text-muted-foreground px-2 py-3 text-sm">
              {loading ? "加载中…" : `暂无可用的${kindName}模型`}
            </div>
          )}
          {models.map((info) => {
            const ability = support(info);
            const active = model?.key === info.key;
            const note = ability.ok ? summary?.(info) : ability.reason;
            return (
              <OptionRow
                key={info.key}
                active={active}
                disabled={!ability.ok}
                title={ability.reason ?? undefined}
                onClick={() => {
                  close();
                  onPick(info.key);
                }}
              >
                <ModelLogo vendor={info.vendor} name={info.label} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{info.label}</span>
                  {note && (
                    <span className="text-muted-foreground block truncate text-[11px] font-normal">
                      {note}
                    </span>
                  )}
                </span>
              </OptionRow>
            );
          })}
        </>
      )}
    </ChipPopover>
  );
}

/**
 * 视频模型选择（片场编辑区生成按钮旁，开拍设置里也用）：只有收参考图的模型可选，
 * 不支持的置灰并写原因（片段里的 @ 资产要靠参考图带入）；副文案是能力摘要（含时长上限）。
 */
export function VideoModelMenu({
  models,
  loading,
  model,
  onPick,
  variant = "bar",
  defaultLabel,
  fallback,
}: {
  models: readonly ModelInfo[];
  loading: boolean;
  model: ModelInfo | undefined;
  onPick: (key: string) => void;
  variant?: "chip" | "bar" | "chrome" | "field";
  /** 开拍设置用：多一项「不指定」 */
  defaultLabel?: string;
  /** 没选时胶囊上显示的模型，见 ModelMenu */
  fallback?: ModelInfo;
}) {
  return (
    <ModelMenu
      models={models}
      loading={loading}
      model={model}
      onPick={onPick}
      support={videoModelSupport}
      summary={modelSummary}
      kindName="视频"
      variant={variant}
      size={variant === "bar" ? "lg" : undefined}
      defaultLabel={defaultLabel}
      fallback={fallback}
      title={variant === "bar" ? "生成片段视频用的模型" : undefined}
    />
  );
}
