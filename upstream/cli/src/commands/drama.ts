// 短剧：只读与任务控制。

import { APIError, request } from "../client.ts";
import { boolFlag, intFlag, stringFlag } from "./args.ts";
import { baseOf, emit, requireToken } from "./shared.ts";
import type { Args, Ctx, DramaJob, DramaSummary, DramaUnit, DramaView, Page } from "../types.ts";

function formatDramaRows(list: DramaSummary[]): string {
  if (!list.length) return "（没有短剧）";
  const lines = ["CODE\tSTATUS\tPHASE\tEPISODES\tLOCKED\tUPDATED\tTITLE"];
  for (const item of list) {
    lines.push(
      `${item.id}\t${item.status}\t${item.phase || "-"}\t${item.episode_count ?? 0}\t${item.locked_count ?? 0}\t${String(
        item.updated_at || "",
      )
        .replace("T", " ")
        .slice(0, 19)}\t${item.title}`,
    );
  }
  return lines.join("\n");
}

/** 集号列表压成一行：96 集全铺开会把表格挤成两屏，超过 6 个就收成区间。 */
function formatEpisodes(list?: number[]): string {
  const episodes = (list || []).slice().sort((a, b) => a - b);
  if (!episodes.length) return "-";
  if (episodes.length <= 6) return episodes.join(",");
  const head = episodes.slice(0, 3).join(",");
  const tail = episodes.slice(-2).join(",");
  return `${head}…${tail}（${episodes.length} 集）`;
}

function formatJobRows(list: DramaJob[]): string {
  if (!list.length) return "（没有任务）";
  const lines = ["JOB\tSTEP\tSTATUS\tPROGRESS\tEPISODES\tLANE\tCREDITS"];
  for (const job of list) {
    lines.push(
      `${job.id}\t${job.step}\t${job.status}\t${job.progress ?? 0}%\t${formatEpisodes(job.episodes)}\t${job.lane || "-"}\t${job.credits ?? 0}`,
    );
  }
  return lines.join("\n");
}

function formatDramaDetail(view: DramaView, episodeLimit = 10): string {
  const lines = [
    `${view.title}（${view.id}）`,
    `状态：${view.status}  阶段：${view.phase || "-"}`,
    `原文：${view.source_chars ?? 0} 字  单元：${view.units_total ?? 0} 个（${view.unit_kind || "-"}）`,
  ];
  if ((view.target_episodes ?? 0) > 0)
    lines.push(
      `目标：${view.target_episodes} 集 × ${view.episode_seconds ?? 0} 秒  画幅：${view.ratio || "-"}`,
    );
  else lines.push(`画幅：${view.ratio || "-"}`);
  lines.push(`画布：${view.canvas_id || "-"}`);
  if (view.pause_reason) lines.push(`暂停原因：${view.pause_reason}（${view.pause_code || "-"}）`);
  const episodes = view.episodes || [];
  if (episodes.length) {
    // 真正跑过的短剧动辄上百集：默认只列前 10 集，把「还有多少」说清楚，
    // 而不是把 96 行刷满终端（实测一个 96 集项目会打出 175 行）。
    const shown = episodeLimit > 0 ? episodes.slice(0, episodeLimit) : episodes;
    lines.push(
      `分集（${episodes.length} 集${shown.length < episodes.length ? `，只列前 ${shown.length}` : ""}）：`,
    );
    for (const ep of shown) {
      lines.push(
        `  第 ${ep.no} 集  ${ep.title || ""}  单元 ${ep.unit_from ?? "-"}–${ep.unit_to ?? "-"}  剧本 ${ep.script_status || "-"}`,
      );
    }
    if (shown.length < episodes.length)
      lines.push(`  …… 还有 ${episodes.length - shown.length} 集；加 --episodes 0 看全部`);
  }
  return lines.join("\n");
}

const pageOf = <T>(res: T[] | Page<T> | null | undefined): Page<T> =>
  Array.isArray(res)
    ? { list: res, total: res.length, page: 1, page_size: res.length }
    : res || { list: [], total: 0 };

export async function dramaList(ctx: Ctx, args: Args): Promise<void> {
  const token = requireToken(ctx);
  const page = pageOf(
    await request<DramaSummary[] | Page<DramaSummary>>({
      base: baseOf(ctx),
      token,
      path: "/dramas",
      query: {
        keyword: typeof args.flags.keyword === "string" ? args.flags.keyword : undefined,
        page: intFlag(args.flags, "page", undefined),
        page_size: intFlag(args.flags, "page-size", undefined, { max: 200 }),
      },
      fetchImpl: ctx.fetchImpl,
    }),
  );
  const list = page.list || [];
  emit(
    ctx,
    { list, total: page.total, page: page.page, page_size: page.page_size },
    `${formatDramaRows(list)}\n共 ${page.total} 部，第 ${page.page} 页`,
  );
}

export async function dramaGet(ctx: Ctx, args: Args): Promise<void> {
  const code = args.positional[0];
  const usage = "drama get <短剧编号> [--episodes 10（0 表示全部）]";
  if (!code) throw new APIError(-1, `用法：${usage}`, 2);
  const episodeLimit = intFlag(args.flags, "episodes", 10, { min: 0, max: 1000 });
  const token = requireToken(ctx);
  const view = await request<DramaView>({
    base: baseOf(ctx),
    token,
    path: `/dramas/${encodeURIComponent(code)}`,
    fetchImpl: ctx.fetchImpl,
  });
  emit(ctx, view, formatDramaDetail(view, episodeLimit));
}

export async function dramaUnits(ctx: Ctx, args: Args): Promise<void> {
  const code = args.positional[0];
  if (!code) throw new APIError(-1, "用法：drama units <短剧编号> [--from 1] [--to 20]", 2);
  const token = requireToken(ctx);
  const from = intFlag(args.flags, "from", undefined, { min: 1 });
  const to = intFlag(args.flags, "to", undefined, { min: 1 });
  const res = await request<DramaUnit[] | { items?: DramaUnit[] }>({
    base: baseOf(ctx),
    token,
    path: `/dramas/${encodeURIComponent(code)}/units`,
    query: { from, to },
    fetchImpl: ctx.fetchImpl,
  });
  // 服务端把列表包在 {items: [...]} 里（不是裸数组）：按裸数组处理会得到「(没有单元)」
  const items = Array.isArray(res) ? res : (res?.items ?? []);
  const lines = items.map(
    (unit) => `${unit.no}\t${unit.title || ""}\t${unit.chars ?? (unit.text || "").length} 字`,
  );
  emit(ctx, items, items.length ? ["NO\tTITLE\tCHARS", ...lines].join("\n") : "（没有单元）");
}

export async function dramaUnit(ctx: Ctx, args: Args): Promise<void> {
  const code = args.positional[0];
  const no = args.positional[1];
  if (!code || !no) throw new APIError(-1, "用法：drama unit <短剧编号> <单元号>", 2);
  const token = requireToken(ctx);
  const unit = await request<DramaUnit>({
    base: baseOf(ctx),
    token,
    path: `/dramas/${encodeURIComponent(code)}/units/${encodeURIComponent(no)}`,
    fetchImpl: ctx.fetchImpl,
  });
  emit(
    ctx,
    unit,
    [
      `第 ${unit.no} 单元  ${unit.title || ""}${unit.chars ? `（${unit.chars} 字）` : ""}`,
      "",
      unit.text || "（正文为空）",
    ].join("\n"),
  );
}

export async function dramaJobs(ctx: Ctx, args: Args): Promise<void> {
  const code = args.positional[0];
  if (!code) throw new APIError(-1, "用法：drama jobs <短剧编号> [--active]", 2);
  const token = requireToken(ctx);
  const res = await request<{ items?: DramaJob[] } | null>({
    base: baseOf(ctx),
    token,
    path: `/dramas/${encodeURIComponent(code)}/jobs`,
    query: boolFlag(args.flags, "active") ? { status: "active" } : undefined,
    fetchImpl: ctx.fetchImpl,
  });
  const items = (res && res.items) || [];
  emit(ctx, { items }, formatJobRows(items));
}

export async function dramaJobCancel(ctx: Ctx, args: Args): Promise<void> {
  const code = args.positional[0];
  const usage = "drama job-cancel <短剧编号> --job <任务id>";
  if (!code || args.flags.job === undefined) throw new APIError(-1, `用法：${usage}`, 2);
  const jobId = stringFlag(args.flags, "job", usage);
  const token = requireToken(ctx);
  const job = await request<DramaJob>({
    base: baseOf(ctx),
    token,
    method: "POST",
    path: `/dramas/${encodeURIComponent(code)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    fetchImpl: ctx.fetchImpl,
  });
  emit(ctx, job, formatJobRows([job]));
}
