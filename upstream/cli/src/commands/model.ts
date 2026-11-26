// 模型与积分：提交生成之前先看清「有哪些模型」「要多少积分」。

import { APIError, request } from "../client.ts";
import { baseOf, emit, requireToken } from "./shared.ts";
import type { Args, Ctx, Model, ModelParamField } from "../types.ts";

function formatModelRows(list: Model[]): string {
  if (!list.length) return "（没有可用模型）";
  const lines = ["KEY\tKIND\tLABEL\tHINT"];
  for (const item of list) {
    lines.push(`${item.key}\t${item.kind}\t${item.label || ""}\t${item.hint || ""}`);
  }
  return lines.join("\n");
}

/** 可用的模型清单（已上架、渠道与插件都就绪的）。 */
export async function modelList(ctx: Ctx, args: Args): Promise<void> {
  const token = requireToken(ctx);
  const kind = args.flags.kind;
  if (kind !== undefined && (kind === true || typeof kind !== "string"))
    throw new APIError(-1, "用法：model list [--kind image|video|audio|text]", 2);
  const models =
    (await request<Model[]>({
      base: baseOf(ctx),
      token,
      path: "/models",
      query: { kind },
      fetchImpl: ctx.fetchImpl,
    })) || [];
  emit(ctx, models, formatModelRows(models));
}

/** 一行参数说明：范围 / 默认值 / 是否在画布上隐藏。 */
function formatParamLine(name: string, field: ModelParamField): string {
  const range =
    field.type === "enum"
      ? `可选 ${(field.options || []).join(" / ")}`
      : field.type === "number"
        ? `${field.min ?? "-"}–${field.max ?? "-"}${field.unit ? ` ${field.unit}` : ""}`
        : "布尔";
  const fallback = field.open === false ? "，画布上不显示、按默认发送" : "";
  const preset = field.default !== undefined ? `，默认 ${JSON.stringify(field.default)}` : "";
  return `参数 ${name}：${field.label || name}（${range}${preset}${fallback}）`;
}

/**
 * 单个模型的细节：生成方式、参数（--param 能填什么）、参考素材上限、计价。
 * 这些正是提交生成时最容易猜错的部分，所以单独一条命令，而不是让用户翻后台。
 */
export async function modelShow(ctx: Ctx, args: Args): Promise<void> {
  const key = args.positional[0];
  if (!key) throw new APIError(-1, "用法：model show <模型 key>", 2);
  const token = requireToken(ctx);
  const models =
    (await request<Model[]>({
      base: baseOf(ctx),
      token,
      path: "/models",
      fetchImpl: ctx.fetchImpl,
    })) || [];
  const model = models.find((item) => item.key === key);
  if (!model) {
    const near = models
      .filter((item) => String(item.key).includes(key) || String(item.label || "").includes(key))
      .map((item) => item.key);
    throw new APIError(
      -1,
      `找不到模型 ${key}${near.length ? `；相近的有：${near.join("、")}` : ""}。用 model list 看全部`,
      0,
    );
  }
  const caps = model.capabilities || {};
  const lines = [
    `${model.label || model.key}（${model.key}）`,
    `种类：${model.kind}${model.vendor ? `  厂商：${model.vendor}` : ""}`,
    `生成方式：${(caps.ops || []).join(" / ") || "-"}`,
  ];
  // capabilities.params 在接口里是「名字 -> 字段」的对象（键序就是画布参数面板的顺序），不是数组
  const params: Array<[string, ModelParamField]> =
    caps.params && typeof caps.params === "object" ? Object.entries(caps.params) : [];
  for (const [name, field] of params) lines.push(formatParamLine(name, field));
  if (caps.prompt?.max) lines.push(`提示词上限：${caps.prompt.max} 字`);
  for (const [type, spec] of Object.entries(caps.refs || {})) {
    if (!spec?.on) continue;
    lines.push(
      `参考素材：${type} 最多 ${spec.max ?? "-"} 个${spec.max_mb ? `，单个不超过 ${spec.max_mb} MB` : ""}`,
    );
  }
  if (model.pricing) lines.push(`计价：${JSON.stringify(model.pricing)}`);
  emit(ctx, model, lines.join("\n"));
}

/** 当前积分：余额、冻结中、可用。 */
export async function credits(ctx: Ctx): Promise<void> {
  const token = requireToken(ctx);
  const data = await request<{ balance: number; frozen: number; available: number }>({
    base: baseOf(ctx),
    token,
    path: "/credits",
    fetchImpl: ctx.fetchImpl,
  });
  emit(ctx, data, `积分：余额 ${data.balance}  冻结 ${data.frozen}  可用 ${data.available}`);
}
