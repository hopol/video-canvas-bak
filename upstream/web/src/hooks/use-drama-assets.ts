import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCanvas } from "@/api/canvas";
import type { CanvasGraphDto } from "@/api/canvas/type";
import { useTasksStore } from "@/store/tasks";
import { subscribeCanvasPatch } from "@/utils/agent/patch-bus";
import { waitPendingSave } from "@/utils/canvas/pending-save";
import type { TaskMap } from "@/utils/tasks/merge";
import { boardsFromGraph, type BoardNode } from "@/utils/drama/board";
import { assetsFromGraph, type RefAsset } from "@/utils/drama/segment-assets";
import { followLatest } from "@/utils/latest-call";
import { reconcileTaskIds } from "@/utils/ws/task-events";

export type DramaAssetsState = {
  assets: RefAsset[];
  status: "loading" | "ready" | "error";
  /** 重新读一次画布；返回最新的资产（同时多次调用都拿最后一次的结果），读取失败为 null */
  reload: () => Promise<RefAsset[] | null>;
  /** 画布上的故事板节点，按片段 id（和资产同一次读取） */
  boards: ReadonlyMap<string, BoardNode>;
  /** 最近一次读到的故事板：reload 之后立刻取，不用等重新渲染 */
  boardsNow: () => ReadonlyMap<string, BoardNode>;
  /** 换上一份刚存下的画布节点（片场里的画布编辑器存盘后交过来），不再读一次；还在路上的旧读取作废 */
  applyGraph: (nodes: CanvasGraphDto["nodes"]) => void;
};

const NONE: RefAsset[] = [];
const NO_BOARDS: ReadonlyMap<string, BoardNode> = new Map();

/** 声音任务状态随任务快照更新，失败任务不妨碍继续使用先前已绑定的音色。 */
const withVoiceTasks = (assets: RefAsset[], tasks: TaskMap): RefAsset[] =>
  assets.map((asset) =>
    asset.voiceTaskId ? { ...asset, voiceTaskStatus: tasks[asset.voiceTaskId]?.status } : asset,
  );

/**
 * 短剧画布上的资产节点（角色 / 场景 / 道具）：分集卡片计数、片段工作区资产库和 @ 候选都读它；
 * 顺带取出故事板节点（生视频时作为第一张参考图）。
 * 只读画布，不占编辑锁；角色卡节点的形象、声音就在节点数据里，读到什么就是什么。
 * 页面回到前台时重新读一次，资产页里新生成的形象能跟上；reloadKey 变化也重读（拆解 / 写提示词任务收尾）；
 * 后端改了这张画布（片场生成的故事板写节点、出图回写）推 canvas.patch 时也重读；
 * 片场里挂着的画布编辑器自己存盘（在画布里点生成、隐藏着的画布回填出图）不推 canvas.patch，由调用方用 applyGraph 交过来。
 */
export function useDramaAssets(canvasId: string, reloadKey = 0): DramaAssetsState {
  const shared = useSharedWorkspace();
  const [assets, setAssets] = useState<RefAsset[]>(NONE);
  const [status, setStatus] = useState<DramaAssetsState["status"]>("loading");
  const [boards, setBoards] = useState<ReadonlyMap<string, BoardNode>>(NO_BOARDS);
  const boardsRef = useRef<ReadonlyMap<string, BoardNode>>(NO_BOARDS);
  const seq = useRef(0);
  const tasks = useTasksStore((state) => state.tasks);
  const current = useMemo(() => withVoiceTasks(assets, tasks), [assets, tasks]);

  /** 用一份画布节点更新资产和故事板；mine 不是最新一次（被更晚的读取 / 存盘顶掉）就作废，返回 null */
  const ingest = useCallback(
    async (nodes: CanvasGraphDto["nodes"], mine: number): Promise<RefAsset[] | null> => {
      const next = assetsFromGraph(nodes);
      const voiceIds = [
        ...new Set(next.flatMap((asset) => (asset.voiceTaskId ? [asset.voiceTaskId] : []))),
      ];
      if (!shared && voiceIds.length) await reconcileTaskIds(voiceIds);
      if (mine !== seq.current) return null;
      setAssets(next);
      const nextBoards = boardsFromGraph(nodes);
      boardsRef.current = nextBoards;
      setBoards(nextBoards);
      setStatus("ready");
      return withVoiceTasks(next, useTasksStore.getState().tasks);
    },
    [shared],
  );

  const load = useCallback(async (): Promise<RefAsset[] | null> => {
    const mine = ++seq.current;
    try {
      // 刚卸载的画布编辑器（资产管理里改完马上切到片场）还在补存：等它落地再读，不读到旧图谱
      await waitPendingSave(canvasId);
      if (mine !== seq.current) return null;
      const canvas = shared?.canvas ?? (await getCanvas(canvasId));
      if (mine !== seq.current) return null;
      return await ingest(canvas.graph.nodes, mine);
    } catch {
      if (mine === seq.current) setStatus((prev) => (prev === "ready" ? prev : "error"));
      return null;
    }
  }, [canvasId, ingest, shared]);
  const applyGraph = useCallback(
    (nodes: CanvasGraphDto["nodes"]) => {
      // 故事板状态同步先换上，声音任务对账在后面慢慢补
      const mine = ++seq.current;
      const nextBoards = boardsFromGraph(nodes);
      boardsRef.current = nextBoards;
      setBoards(nextBoards);
      void ingest(nodes, mine).catch(() => undefined);
    },
    [ingest],
  );
  // 被更晚一次读取顶掉的调用改等最新结果：批量提交时多个片段同时重读，不能有人空手而归
  const latest = useRef<Promise<RefAsset[] | null>>(null);
  const reload = useCallback(() => followLatest(latest, load()), [load]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  useEffect(() => subscribeCanvasPatch(canvasId, () => void reload()), [canvasId, reload]);

  const boardsNow = useCallback(() => boardsRef.current, []);
  return { assets: current, status, reload, boards, boardsNow, applyGraph };
}
