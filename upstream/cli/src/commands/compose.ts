// 成片合成。后端接口就绪前入口关闭，实现与推导规则原样保留。

import { APIError, request } from "../client.ts";
import { boolFlag, intFlag, listFlag, stringFlag, toInt } from "./args.ts";
import { fetchCanvas } from "./canvas.ts";
import { baseOf, emit, requireToken, sleep } from "./shared.ts";
import type {
  Args,
  CanvasNode,
  CanvasNodeData,
  ComposeActive,
  ComposeJob,
  ComposeRow,
  Ctx,
  Graph,
} from "../types.ts";

const TERMINAL_COMPOSE_STATUSES = new Set<string>(["succeeded", "failed", "canceled"]);

/**
 * 后端目前没有 /canvas/:id/compose 系列接口（成片合成由另一个 PR 提供），
 * 所以三条命令的入口先关闭：实现与推导规则原样保留，后端就绪后把它改成 true 即可恢复，
 * 同时恢复帮助、README 与 skill 里被移除的说明。
 */
const COMPOSE_SUPPORTED = false;

function assertComposeSupported(): void {
  if (!COMPOSE_SUPPORTED) throw new APIError(-1, "当前服务端暂不支持成片合成", 0);
}

/** 节点当前生效的素材 id：优先 activeOutputId 指向的那一版，老节点只有 assetId。 */
function activeAssetIdOf(data?: CanvasNodeData): string {
  const activeId = data?.activeOutputId;
  const outputs = Array.isArray(data?.outputs) ? data.outputs : [];
  if (activeId !== undefined && activeId !== null) {
    const hit = outputs.find((one) => String(one.id) === String(activeId));
    if (hit?.assetId) return String(hit.assetId);
  }
  return data?.assetId ? String(data.assetId) : "";
}

/**
 * 按成片节点的上游推导素材顺序，规则与画布一致：
 * 先认 data.composeOrder（用户手动调过的段序），其余按画布位置（先上下、再左右）。
 * 只收视频节点；还没出视频的段跳过，并在返回值里报出来。
 */
export function deriveComposeAssets(
  graph: Graph,
  nodeId: string,
): { rows: ComposeRow[]; missing: number[] } {
  const nodes = graph.nodes || [];
  const composeNode = nodes.find((item) => item.id === nodeId);
  if (!composeNode) throw new APIError(-1, `画布里找不到节点 ${nodeId}`, 0);
  if (composeNode.data?.kind !== "compose")
    throw new APIError(
      -1,
      `节点 ${nodeId} 不是成片节点（data.kind=${composeNode.data?.kind || "-"}）`,
      2,
    );
  const order = Array.isArray(composeNode.data.composeOrder) ? composeNode.data.composeOrder : [];
  const rank = new Map(order.map((id, index) => [id, index]));
  const sources = (graph.edges || [])
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((item) => item.id === edge.source))
    .filter((item): item is CanvasNode => Boolean(item) && item?.data?.kind === "video");
  const positionOf = (item: CanvasNode): { x: number; y: number } => ({
    x: Number(item.position?.x ?? 0),
    y: Number(item.position?.y ?? 0),
  });
  const sorted = [...sources].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) {
      const pa = positionOf(a);
      const pb = positionOf(b);
      return pa.y - pb.y || pa.x - pb.x || String(a.id).localeCompare(String(b.id));
    }
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
  const rows: ComposeRow[] = [];
  const missing: number[] = [];
  sorted.forEach((item, seq) => {
    const assetId = activeAssetIdOf(item.data);
    if (!assetId) {
      missing.push(seq);
      rows.push({ seq, node: item.id, label: item.data?.label || "视频", assetId: "" });
      return;
    }
    rows.push({ seq, node: item.id, label: item.data?.label || "视频", assetId });
  });
  return { rows, missing };
}

function formatComposeRows(rows: ComposeRow[]): string {
  if (!rows.length) return "（成片节点上没有连进来的视频）";
  const lines = ["SEQ\tASSET\tNODE\tLABEL"];
  for (const row of rows) {
    lines.push(`${row.seq}\t${row.assetId || "（还没有视频）"}\t${row.node}\t${row.label}`);
  }
  return lines.join("\n");
}

function formatComposeJob(job: ComposeJob): string {
  const lines = [`合成任务：${job.id}`, `状态：${job.status}`];
  if (job.segment_count !== undefined) lines.push(`片段：${job.segment_count}`);
  if (job.duration_ms) lines.push(`时长：${(job.duration_ms / 1000).toFixed(1)} 秒`);
  if (job.result_asset_id) lines.push(`成片素材：${job.result_asset_id}`);
  if (job.result_asset_url) lines.push(`成片地址：${job.result_asset_url}`);
  if (job.error) lines.push(`错误：${job.error}`);
  return lines.join("\n");
}

/**
 * 合成成片：POST /canvas/:id/compose，asset_ids 的顺序就是成片顺序。
 * 不给 --assets 时按画布里的成片节点推导（composeOrder 优先），并把推导结果打出来，
 * 用户能对着看是不是想要的顺序——顺序错了成片就错了，不能猜完不吭声。
 */
export async function canvasCompose(ctx: Ctx, args: Args): Promise<void> {
  assertComposeSupported();
  const code = args.positional[0];
  const usage =
    "canvas compose <画布编号> --node <成片节点id> [--assets 素材id,素材id...] [--seqs 1,2,3] " +
    "[--mode storyboard|compose|selection] [--wait] [--timeout 900] [--interval 5]";
  const node = args.flags.node;
  if (!code || node === undefined) throw new APIError(-1, `用法：${usage}`, 2);
  if (node === true || typeof node !== "string")
    throw new APIError(-1, `--node 需要成片节点 id。用法：${usage}`, 2);

  let rows: ComposeRow[] = [];
  let assetIds = listFlag(args.flags, "assets");
  let derived = false;
  if (!assetIds.length) {
    const canvas = await fetchCanvas(ctx, code);
    const graph: Graph = canvas.payload_json || {};
    const result = deriveComposeAssets(graph, node);
    rows = result.rows;
    assetIds = result.rows.map((row) => row.assetId).filter(Boolean);
    derived = true;
    if (!assetIds.length)
      throw new APIError(
        -1,
        `${formatComposeRows(rows)}\n成片节点 ${node} 的上游还没有可用的视频素材；` +
          "先在画布里生成视频，或用 --assets 显式给素材 id",
        0,
      );
  }

  const body: Record<string, unknown> = { node_id: node, asset_ids: assetIds };
  const seqs = listFlag(args.flags, "seqs").map((raw) => toInt(raw, "seqs", { min: 0 }));
  if (seqs.length) body.seqs = seqs;
  if (typeof args.flags.mode === "string") body.mode = args.flags.mode;

  const token = requireToken(ctx);
  const job = await request<ComposeJob>({
    base: baseOf(ctx),
    token,
    method: "POST",
    path: `/canvas/${encodeURIComponent(code)}/compose`,
    body,
    fetchImpl: ctx.fetchImpl,
  });
  const plan = derived ? formatComposeRows(rows) : `素材顺序：${assetIds.join(" → ")}`;

  if (!boolFlag(args.flags, "wait")) {
    emit(
      ctx,
      { job, assets: assetIds, rows },
      [plan, "", formatComposeJob(job), "", "已提交，加 --wait 可以等它合成完。"].join("\n"),
    );
    return;
  }

  const timeoutSeconds = intFlag(args.flags, "timeout", 900, { max: 86400 });
  const intervalSeconds = intFlag(args.flags, "interval", 5, { max: 3600 });
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = "";
  let final = job;
  while (Date.now() < deadline) {
    final = await request<ComposeJob>({
      base: baseOf(ctx),
      token,
      path: `/canvas/${encodeURIComponent(code)}/compose/${encodeURIComponent(String(job.id))}`,
      fetchImpl: ctx.fetchImpl,
    });
    if (final.status !== last) {
      ctx.stderr(`[${new Date().toISOString().slice(11, 19)}] ${final.status}`);
      last = final.status;
    }
    if (TERMINAL_COMPOSE_STATUSES.has(final.status)) break;
    await sleep(intervalSeconds * 1000);
  }
  if (!TERMINAL_COMPOSE_STATUSES.has(final.status))
    throw new APIError(
      -1,
      `等待超时（${timeoutSeconds}s），合成任务 ${job.id} 仍未结束；可用 canvas compose-status 继续查`,
      0,
      3,
    );

  const human = [plan, "", formatComposeJob(final)].join("\n");
  if (final.status === "succeeded") {
    emit(ctx, { job: final, assets: assetIds, rows }, human);
    return;
  }
  if (ctx.json) {
    ctx.stdout(
      JSON.stringify({
        ok: false,
        error: { code: -1, message: final.error || `合成${final.status}` },
        data: { job: final, assets: assetIds, rows },
      }),
    );
  } else {
    ctx.stdout(human);
  }
  process.exitCode = 1;
}

/** 查合成任务：给 --job 就按任务 id 查，给 --node 就查该节点上最新的任务（含是否已过期）。 */
export async function canvasComposeStatus(ctx: Ctx, args: Args): Promise<void> {
  assertComposeSupported();
  const code = args.positional[0];
  const usage =
    "canvas compose-status <画布编号> [--job <任务id> | --node <成片节点id> [--assets 素材id,...]]";
  if (!code) throw new APIError(-1, `用法：${usage}`, 2);
  const jobId = args.flags.job;
  const node = args.flags.node;
  if (jobId === undefined && node === undefined)
    throw new APIError(-1, `要给 --job 或 --node 其中之一。用法：${usage}`, 2);
  const token = requireToken(ctx);
  if (jobId !== undefined) {
    if (jobId === true || typeof jobId !== "string")
      throw new APIError(-1, `--job 需要任务 id。用法：${usage}`, 2);
    const job = await request<ComposeJob>({
      base: baseOf(ctx),
      token,
      path: `/canvas/${encodeURIComponent(code)}/compose/${encodeURIComponent(jobId)}`,
      fetchImpl: ctx.fetchImpl,
    });
    emit(ctx, job, formatComposeJob(job));
    return;
  }
  if (node === true || typeof node !== "string")
    throw new APIError(-1, `--node 需要成片节点 id。用法：${usage}`, 2);
  const assets = listFlag(args.flags, "assets");
  const res = await request<ComposeActive | null>({
    base: baseOf(ctx),
    token,
    path: `/canvas/${encodeURIComponent(code)}/compose/active`,
    query: { node_id: node, asset_ids: assets.join(",") },
    fetchImpl: ctx.fetchImpl,
  });
  if (!res) {
    emit(ctx, {}, "这个节点上没有进行中的合成任务");
    return;
  }
  const stale = res.stale === undefined ? "" : res.stale ? "（素材已变，成片过期）" : "";
  emit(ctx, res, `${formatComposeJob(res)}${stale}`);
}

/** 取消还没落终态的合成任务。 */
export async function canvasComposeCancel(ctx: Ctx, args: Args): Promise<void> {
  assertComposeSupported();
  const code = args.positional[0];
  const usage = "canvas compose-cancel <画布编号> --job <任务id>";
  if (!code || args.flags.job === undefined) throw new APIError(-1, `用法：${usage}`, 2);
  const jobId = stringFlag(args.flags, "job", usage);
  const token = requireToken(ctx);
  const job = await request<ComposeJob>({
    base: baseOf(ctx),
    token,
    method: "POST",
    path: `/canvas/${encodeURIComponent(code)}/compose/${encodeURIComponent(jobId)}/cancel`,
    fetchImpl: ctx.fetchImpl,
  });
  emit(ctx, job, formatComposeJob(job));
}
